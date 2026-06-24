"""Authentication and role-based authorization.

Identity comes from the headers Databricks Apps injects for the signed-in user
(``X-Forwarded-Email`` / ``X-Forwarded-User``). Three global roles exist —
``admin`` > ``editor`` > ``viewer`` — plus per-domain-group *grants* that give a
user editor rights over a single subtree without making them a global editor.

Bootstrapping: emails listed in the ``ADMIN_EMAILS`` env var are always admins,
so the first administrator exists before any role rows do. For local
development and tests, ``AUTH_DISABLED=true`` resolves every request to a
synthetic admin so the app is usable without the Databricks proxy.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import IntEnum

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import DomainGrant, RoleAssignment
from .validation import ForbiddenError, UnauthorizedError


class Role(IntEnum):
    VIEWER = 1
    EDITOR = 2
    ADMIN = 3

    @classmethod
    def parse(cls, value: str | None) -> "Role":
        if not value:
            raise ValueError("empty role")
        return cls[value.strip().upper()]

    @property
    def label(self) -> str:
        return self.name.lower()


VALID_ROLE_NAMES = {r.label for r in Role}


def _env_admins() -> set[str]:
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _default_role() -> Role:
    try:
        return Role.parse(os.environ.get("DEFAULT_ROLE", "viewer"))
    except (KeyError, ValueError):
        return Role.VIEWER


def _auth_disabled() -> bool:
    return os.environ.get("AUTH_DISABLED", "").lower() == "true"


@dataclass
class Principal:
    email: str
    role: Role
    editor_domain_groups: set[str] = field(default_factory=set)

    @property
    def is_admin(self) -> bool:
        return self.role >= Role.ADMIN

    @property
    def is_global_editor(self) -> bool:
        return self.role >= Role.EDITOR

    def can_edit_domain_group(self, domain_group_id: str | None) -> bool:
        if self.is_global_editor:
            return True
        return domain_group_id is not None and domain_group_id in self.editor_domain_groups

    def to_dict(self) -> dict:
        return {
            "email": self.email,
            "role": self.role.label,
            "editorDomainGroups": sorted(self.editor_domain_groups),
            "isAdmin": self.is_admin,
        }


class AuthService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def resolve(self, headers) -> Principal:  # noqa: ANN001
        if _auth_disabled():
            return Principal(email="dev@local", role=Role.ADMIN)

        email = (
            headers.get("x-forwarded-email")
            or headers.get("x-forwarded-preferred-username")
            or headers.get("x-forwarded-user")
        )
        if not email:
            raise UnauthorizedError("No authenticated user. This app must run behind Databricks Apps SSO.")
        email = email.strip().lower()

        if email in _env_admins():
            role = Role.ADMIN
        else:
            assigned = self.session.get(RoleAssignment, email)
            try:
                role = Role.parse(assigned.role) if assigned else _default_role()
            except (KeyError, ValueError):
                role = _default_role()

        grants = {
            g.domain_group_id
            for g in self.session.execute(
                select(DomainGrant).where(DomainGrant.email == email)
            ).scalars()
        }
        return Principal(email=email, role=role, editor_domain_groups=grants)

    # -- role/grant administration (admin only) --------------------------
    def list_roles(self) -> list[dict]:
        rows = self.session.execute(select(RoleAssignment)).scalars()
        return [r.to_dict() for r in rows]

    def set_role(self, actor: str, email: str, role_name: str) -> dict:
        email = (email or "").strip().lower()
        if not email:
            raise ForbiddenError("An email is required")
        try:
            role = Role.parse(role_name)
        except (KeyError, ValueError):
            raise ForbiddenError(f"Unknown role '{role_name}'. Use one of: {', '.join(sorted(VALID_ROLE_NAMES))}")
        row = self.session.get(RoleAssignment, email)
        if row is None:
            row = RoleAssignment(email=email, role=role.label, updated_by=actor)
            self.session.add(row)
        else:
            row.role = role.label
            row.updated_by = actor
        self.session.flush()
        return row.to_dict()

    def remove_role(self, email: str) -> None:
        row = self.session.get(RoleAssignment, (email or "").strip().lower())
        if row is not None:
            self.session.delete(row)
            self.session.flush()

    def list_grants(self) -> list[dict]:
        rows = self.session.execute(select(DomainGrant)).scalars()
        return [g.to_dict() for g in rows]

    def grant_domain(self, actor: str, email: str, domain_group_id: str) -> dict:
        email = (email or "").strip().lower()
        existing = self.session.execute(
            select(DomainGrant).where(
                DomainGrant.email == email, DomainGrant.domain_group_id == domain_group_id
            )
        ).scalar_one_or_none()
        if existing:
            return existing.to_dict()
        grant = DomainGrant(email=email, domain_group_id=domain_group_id, created_by=actor)
        self.session.add(grant)
        self.session.flush()
        return grant.to_dict()

    def revoke_domain(self, email: str, domain_group_id: str) -> None:
        grant = self.session.execute(
            select(DomainGrant).where(
                DomainGrant.email == (email or "").strip().lower(),
                DomainGrant.domain_group_id == domain_group_id,
            )
        ).scalar_one_or_none()
        if grant:
            self.session.delete(grant)
            self.session.flush()


def require_authenticated(principal: Principal) -> None:
    # Resolution already guarantees a principal; viewers may read.
    return None


def require_admin(principal: Principal) -> None:
    if not principal.is_admin:
        raise ForbiddenError("Administrator access required")


def require_editor(principal: Principal, domain_group_id: str | None) -> None:
    """Editor rights globally, or via a grant on the given domain group."""
    if not principal.can_edit_domain_group(domain_group_id):
        raise ForbiddenError("You don't have edit access to this part of the taxonomy")
