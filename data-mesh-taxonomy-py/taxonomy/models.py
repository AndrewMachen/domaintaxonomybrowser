"""SQLAlchemy ORM models.

Hardening features baked into the schema:

* **Soft delete** — ``deleted_at`` / ``deleted_by`` columns; rows are never
  physically removed by the app, so deletes are recoverable and auditable.
* **Optimistic locking** — a ``version`` column wired as SQLAlchemy's
  ``version_id_col`` so concurrent writers can't silently clobber each other.
* **DB-level uniqueness** — a partial unique index on (parent, lower(name))
  ``WHERE deleted_at IS NULL`` enforces sibling-name uniqueness in the database
  itself (not just the app layer), closing the create/create race.

Every row serializes to the camelCase JSON the API and React client expect.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    literal_column,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class Base(DeclarativeBase):
    pass


class NodeMixin:
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    business_owner: Mapped[str] = mapped_column(String, nullable=False)
    technical_owner: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    deleted_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    level: str = ""
    parent_attr: str | None = None
    parent_column: str | None = None  # python/db column name of the parent FK

    # Wire the integer version column as the optimistic-lock token.
    @declared_attr.directive
    def __mapper_args__(cls):  # noqa: N805
        return {"version_id_col": cls.__table__.c.version}

    def base_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "businessOwner": self.business_owner,
            "technicalOwner": self.technical_owner,
            "sortOrder": self.sort_order,
            "version": self.version,
            "deletedAt": _iso(self.deleted_at),
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
            "level": self.level,
        }

    def to_dict(self) -> dict:
        data = self.base_dict()
        if self.parent_attr:
            data[self.parent_attr] = getattr(self, self.parent_column)
        return data


def _partial_unique(index_name: str, *cols: str):
    """A unique index over the given columns, scoped to non-deleted rows."""
    expr = [literal_column(c) if c != "name" else func.lower(literal_column("name")) for c in cols]
    return Index(
        index_name,
        *expr,
        unique=True,
        sqlite_where=text("deleted_at IS NULL"),
        postgresql_where=text("deleted_at IS NULL"),
    )


class DomainGroup(NodeMixin, Base):
    __tablename__ = "domain_groups"
    level = "DomainGroup"
    parent_attr = None
    parent_column = None
    __table_args__ = (_partial_unique("uq_domain_groups_name", "name"),)


class Domain(NodeMixin, Base):
    __tablename__ = "domains"
    level = "Domain"
    parent_attr = "domainGroupId"
    parent_column = "domain_group_id"
    domain_group_id: Mapped[str] = mapped_column(
        String, ForeignKey("domain_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    __table_args__ = (_partial_unique("uq_domains_parent_name", "domain_group_id", "name"),)


class Subdomain(NodeMixin, Base):
    __tablename__ = "subdomains"
    level = "Subdomain"
    parent_attr = "domainId"
    parent_column = "domain_id"
    domain_id: Mapped[str] = mapped_column(
        String, ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    __table_args__ = (_partial_unique("uq_subdomains_parent_name", "domain_id", "name"),)


class DataProduct(NodeMixin, Base):
    __tablename__ = "data_products"
    level = "DataProduct"
    parent_attr = "subdomainId"
    parent_column = "subdomain_id"
    subdomain_id: Mapped[str] = mapped_column(
        String, ForeignKey("subdomains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    __table_args__ = (_partial_unique("uq_data_products_parent_name", "subdomain_id", "name"),)


class AuditLog(Base):
    """Append-only record of every taxonomy mutation."""

    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    level: Mapped[str | None] = mapped_column(String, nullable=True)
    node_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    node_name: Mapped[str | None] = mapped_column(String, nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "createdAt": _iso(self.created_at),
            "actor": self.actor,
            "action": self.action,
            "level": self.level,
            "nodeId": self.node_id,
            "nodeName": self.node_name,
            "details": self.details,
        }


class RoleAssignment(Base):
    """Global role for a user (admin / editor / viewer), keyed by email."""

    __tablename__ = "role_assignments"

    email: Mapped[str] = mapped_column(String, primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    updated_by: Mapped[str | None] = mapped_column(String, nullable=True)

    def to_dict(self) -> dict:
        return {
            "email": self.email,
            "role": self.role,
            "updatedAt": _iso(self.updated_at),
            "updatedBy": self.updated_by,
        }


class DomainGrant(Base):
    """Per-domain-group editor grant: scoped write access to one subtree."""

    __tablename__ = "domain_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    domain_group_id: Mapped[str] = mapped_column(
        String, ForeignKey("domain_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False, default="editor")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (UniqueConstraint("email", "domain_group_id", name="uq_domain_grant"),)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "domainGroupId": self.domain_group_id,
            "role": self.role,
            "createdAt": _iso(self.created_at),
            "createdBy": self.created_by,
        }
