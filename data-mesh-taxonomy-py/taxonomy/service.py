"""Core taxonomy business logic.

A :class:`TaxonomyService` wraps a single SQLAlchemy ``Session`` (one unit of
work). Mutating methods flush so subsequent reads see pending changes; the
caller (an HTTP route or the Excel importer) owns the final commit/rollback,
which gives the Excel import its all-or-nothing behavior.

Hardening:
* deletes are **soft** (recoverable) and recorded in the audit log;
* every mutation is **audited** with the acting user;
* updates honor **optimistic locking** via the row ``version``;
* sibling-name uniqueness is enforced in the DB (partial unique index) as well
  as here, so concurrent creates can't both win.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Type

from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from . import audit
from .models import DataProduct, Domain, DomainGroup, NodeMixin, Subdomain, utcnow
from .types import Level, LEVEL_LABEL, PARENT_LEVEL
from .validation import (
    ConflictError,
    NotFoundError,
    ValidationError,
    same_name,
    validate_create,
    validate_update,
)


@dataclass(frozen=True)
class LevelCfg:
    model: Type[NodeMixin]
    parent_column: Optional[str]
    child_level: Optional[Level]


CONFIG: dict[Level, LevelCfg] = {
    Level.DOMAIN_GROUP: LevelCfg(DomainGroup, None, Level.DOMAIN),
    Level.DOMAIN: LevelCfg(Domain, "domain_group_id", Level.SUBDOMAIN),
    Level.SUBDOMAIN: LevelCfg(Subdomain, "domain_id", Level.DATA_PRODUCT),
    Level.DATA_PRODUCT: LevelCfg(DataProduct, "subdomain_id", None),
}


class TaxonomyService:
    def __init__(self, session: Session) -> None:
        self.session = session

    # -- helpers ---------------------------------------------------------
    def _cfg(self, level: Level) -> LevelCfg:
        return CONFIG[level]

    def _parent_attr(self, level: Level) -> Optional[InstrumentedAttribute]:
        col = self._cfg(level).parent_column
        return None if col is None else getattr(self._cfg(level).model, col)

    def _active(self, model):  # noqa: ANN001
        return model.deleted_at.is_(None)

    def _siblings(self, level: Level, parent_id: Optional[str]) -> list[NodeMixin]:
        cfg = self._cfg(level)
        stmt = select(cfg.model).where(self._active(cfg.model))
        attr = self._parent_attr(level)
        if attr is not None:
            stmt = stmt.where(attr == parent_id)
        stmt = stmt.order_by(cfg.model.sort_order, cfg.model.created_at)
        return list(self.session.execute(stmt).scalars())

    def _children_of(self, level: Level, node_id: str) -> list[NodeMixin]:
        child_level = self._cfg(level).child_level
        if child_level is None:
            return []
        child_cfg = self._cfg(child_level)
        attr = getattr(child_cfg.model, child_cfg.parent_column)
        stmt = (
            select(child_cfg.model)
            .where(attr == node_id, self._active(child_cfg.model))
            .order_by(child_cfg.model.sort_order)
        )
        return list(self.session.execute(stmt).scalars())

    def _require_parent(self, level: Level, parent_id: Optional[str]) -> None:
        parent_level = PARENT_LEVEL[level]
        if parent_level is None:
            return
        if not parent_id:
            raise ValidationError({"parentId": f"{LEVEL_LABEL[parent_level]} is required"})
        parent = self.session.get(self._cfg(parent_level).model, parent_id)
        if parent is None or parent.deleted_at is not None:
            raise NotFoundError(f"{LEVEL_LABEL[parent_level]} {parent_id} not found")

    def _assert_unique_name(
        self, level: Level, parent_id: Optional[str], name: str, exclude_id: Optional[str] = None
    ) -> None:
        for sibling in self._siblings(level, parent_id):
            if sibling.id == exclude_id:
                continue
            if same_name(sibling.name, name):
                raise ConflictError(
                    f'A {LEVEL_LABEL[level]} named "{name.strip()}" already exists here'
                )

    def _next_sort_order(self, level: Level, parent_id: Optional[str]) -> int:
        cfg = self._cfg(level)
        stmt = select(func.max(cfg.model.sort_order)).where(self._active(cfg.model))
        attr = self._parent_attr(level)
        if attr is not None:
            stmt = stmt.where(attr == parent_id)
        current = self.session.execute(stmt).scalar()
        return 0 if current is None else int(current) + 1

    def _get_row(self, level: Level, node_id: str, include_deleted: bool = False) -> NodeMixin:
        row = self.session.get(self._cfg(level).model, node_id)
        if row is None or (row.deleted_at is not None and not include_deleted):
            raise NotFoundError(f"{LEVEL_LABEL[level]} {node_id} not found")
        return row

    def _parent_id_of(self, level: Level, row: NodeMixin) -> Optional[str]:
        col = self._cfg(level).parent_column
        return None if col is None else getattr(row, col)

    def _check_version(self, row: NodeMixin, expected_version: Optional[int]) -> None:
        if expected_version is not None and row.version != expected_version:
            raise ConflictError(
                "This item was changed by someone else. Reload and try again."
            )

    # -- reads -----------------------------------------------------------
    def get(self, level: Level, node_id: str) -> dict:
        return self._get_row(level, node_id).to_dict()

    def list(self, level: Level, parent_id: Optional[str]) -> list[dict]:
        return [row.to_dict() for row in self._siblings(level, parent_id)]

    def root_domain_group_id(self, level: Level, node_id: str) -> Optional[str]:
        """Walk up to the owning Domain Group id (for authorization checks)."""
        cur_level = level
        row = self._get_row(cur_level, node_id, include_deleted=True)
        while PARENT_LEVEL[cur_level] is not None:
            parent_id = getattr(row, self._cfg(cur_level).parent_column)
            cur_level = PARENT_LEVEL[cur_level]
            row = self.session.get(self._cfg(cur_level).model, parent_id)
            if row is None:
                return None
        return row.id

    # -- writes ----------------------------------------------------------
    def create(
        self, level: Level, parent_id: Optional[str], data: dict, actor: str = "system"
    ) -> dict:
        self._require_parent(level, parent_id)
        clean = validate_create(level, data)
        self._assert_unique_name(level, parent_id, clean["name"])

        cfg = self._cfg(level)
        row = cfg.model(
            name=clean["name"],
            description=clean["description"],
            business_owner=clean["businessOwner"],
            technical_owner=clean["technicalOwner"],
            sort_order=self._next_sort_order(level, parent_id),
        )
        if cfg.parent_column is not None:
            setattr(row, cfg.parent_column, parent_id)
        self.session.add(row)
        self.session.flush()
        audit.record(self.session, actor, "create", level.value, row.id, row.name)
        return row.to_dict()

    def update(
        self,
        level: Level,
        node_id: str,
        patch: dict,
        actor: str = "system",
        expected_version: Optional[int] = None,
    ) -> dict:
        row = self._get_row(level, node_id)
        self._check_version(row, expected_version)

        def pick(key: str, current):
            if key not in patch:
                return current
            value = patch[key]
            if key == "technicalOwner":
                return value
            return current if value is None else value

        merged = {
            "name": pick("name", row.name),
            "description": pick("description", row.description),
            "businessOwner": pick("businessOwner", row.business_owner),
            "technicalOwner": pick("technicalOwner", row.technical_owner),
        }
        clean = validate_update(level, merged)

        before = {
            "name": row.name,
            "description": row.description,
            "businessOwner": row.business_owner,
            "technicalOwner": row.technical_owner,
        }
        if row.name != clean["name"]:
            self._assert_unique_name(
                level, self._parent_id_of(level, row), clean["name"], exclude_id=row.id
            )

        row.name = clean["name"]
        row.description = clean["description"]
        row.business_owner = clean["businessOwner"]
        row.technical_owner = clean["technicalOwner"]
        self.session.flush()

        changes = {
            k: {"from": before[k], "to": clean[k]}
            for k in before
            if before[k] != clean[k]
        }
        audit.record(self.session, actor, "update", level.value, row.id, row.name, changes or None)
        return row.to_dict()

    def rename(
        self, level: Level, node_id: str, name: str, actor: str = "system",
        expected_version: Optional[int] = None,
    ) -> dict:
        return self.update(level, node_id, {"name": name}, actor=actor, expected_version=expected_version)

    def count_descendants(self, level: Level, node_id: str) -> int:
        child_level = self._cfg(level).child_level
        if child_level is None:
            return 0
        total = 0
        for child in self._children_of(level, node_id):
            total += 1 + self.count_descendants(child_level, child.id)
        return total

    def _collect_subtree(self, level: Level, node_id: str) -> list[tuple[Level, NodeMixin]]:
        """The node plus all its active descendants, depth-first."""
        row = self._get_row(level, node_id)
        collected: list[tuple[Level, NodeMixin]] = [(level, row)]
        child_level = self._cfg(level).child_level
        if child_level is not None:
            for child in self._children_of(level, node_id):
                collected.extend(self._collect_subtree(child_level, child.id))
        return collected

    def remove(
        self, level: Level, node_id: str, actor: str = "system",
        expected_version: Optional[int] = None,
    ) -> dict:
        row = self._get_row(level, node_id)
        self._check_version(row, expected_version)
        parent_id = self._parent_id_of(level, row)
        name = row.name

        subtree = self._collect_subtree(level, node_id)
        stamp = utcnow()
        for _lvl, node in subtree:
            node.deleted_at = stamp
            node.deleted_by = actor
        self.session.flush()

        # Compact remaining (active) siblings so order stays 0..n-1.
        self._reindex(level, parent_id)
        self.session.flush()

        descendants = len(subtree) - 1
        audit.record(
            self.session, actor, "delete", level.value, node_id, name,
            {"descendantsRemoved": descendants},
        )
        return {"descendantsRemoved": descendants}

    def restore(self, level: Level, node_id: str, actor: str = "system") -> dict:
        row = self._get_row(level, node_id, include_deleted=True)
        if row.deleted_at is None:
            return row.to_dict()

        parent_id = self._parent_id_of(level, row)
        # Parent must be present and active to receive the restored subtree.
        parent_level = PARENT_LEVEL[level]
        if parent_level is not None:
            parent = self.session.get(self._cfg(parent_level).model, parent_id)
            if parent is None or parent.deleted_at is not None:
                raise ValidationError(
                    {"parentId": f"Restore the parent {LEVEL_LABEL[parent_level]} first"}
                )
        self._assert_unique_name(level, parent_id, row.name, exclude_id=row.id)

        # Restore this node and every still-deleted descendant beneath it.
        restored = self._restore_cascade(level, row)
        row.sort_order = self._next_sort_order(level, parent_id)
        self.session.flush()
        audit.record(
            self.session, actor, "restore", level.value, row.id, row.name,
            {"restored": restored},
        )
        return row.to_dict()

    def _restore_cascade(self, level: Level, row: NodeMixin) -> int:
        row.deleted_at = None
        row.deleted_by = None
        count = 1
        child_level = self._cfg(level).child_level
        if child_level is not None:
            child_cfg = self._cfg(child_level)
            attr = getattr(child_cfg.model, child_cfg.parent_column)
            deleted_children = self.session.execute(
                select(child_cfg.model).where(
                    attr == row.id, child_cfg.model.deleted_at.is_not(None)
                )
            ).scalars()
            for child in deleted_children:
                count += self._restore_cascade(child_level, child)
        return count

    def list_deleted(self) -> list[dict]:
        """Recycle bin: all soft-deleted nodes across every level."""
        out: list[dict] = []
        for level in (Level.DOMAIN_GROUP, Level.DOMAIN, Level.SUBDOMAIN, Level.DATA_PRODUCT):
            model = self._cfg(level).model
            rows = self.session.execute(
                select(model).where(model.deleted_at.is_not(None)).order_by(model.deleted_at.desc())
            ).scalars()
            for row in rows:
                data = row.to_dict()
                data["deletedBy"] = row.deleted_by
                out.append(data)
        return out

    def _reindex(self, level: Level, parent_id: Optional[str]) -> None:
        for index, sibling in enumerate(self._siblings(level, parent_id)):
            if sibling.sort_order != index:
                sibling.sort_order = index

    def reorder(
        self, level: Level, parent_id: Optional[str], ordered_ids: list[str], actor: str = "system"
    ) -> list[dict]:
        siblings = {row.id: row for row in self._siblings(level, parent_id)}
        if set(ordered_ids) != set(siblings.keys()):
            raise ValidationError(
                {"orderedIds": "orderedIds must list exactly the children of this parent"}
            )
        for index, node_id in enumerate(ordered_ids):
            siblings[node_id].sort_order = index
        self.session.flush()
        audit.record(
            self.session, actor, "reorder", level.value, parent_id, None,
            {"orderedIds": ordered_ids},
        )
        return [siblings[node_id].to_dict() for node_id in ordered_ids]

    def move(
        self,
        level: Level,
        node_id: str,
        new_parent_id: str,
        new_index: Optional[int] = None,
        actor: str = "system",
        expected_version: Optional[int] = None,
    ) -> dict:
        if PARENT_LEVEL[level] is None:
            raise ValidationError({"level": "Domain groups cannot be moved under a parent"})

        row = self._get_row(level, node_id)
        self._check_version(row, expected_version)
        source_parent_id = self._parent_id_of(level, row)
        self._require_parent(level, new_parent_id)
        self._assert_unique_name(level, new_parent_id, row.name, exclude_id=row.id)

        setattr(row, self._cfg(level).parent_column, new_parent_id)
        self.session.flush()

        dest = [s for s in self._siblings(level, new_parent_id) if s.id != row.id]
        idx = len(dest) if new_index is None else max(0, min(int(new_index), len(dest)))
        dest.insert(idx, row)
        for index, sibling in enumerate(dest):
            sibling.sort_order = index

        if source_parent_id != new_parent_id:
            self._reindex(level, source_parent_id)
        self.session.flush()
        audit.record(
            self.session, actor, "move", level.value, row.id, row.name,
            {"from": source_parent_id, "to": new_parent_id, "index": idx},
        )
        return row.to_dict()

    # -- tree ------------------------------------------------------------
    def get_tree(self) -> list[dict]:
        result = []
        for group in self._siblings(Level.DOMAIN_GROUP, None):
            g = group.to_dict()
            domains = []
            for domain in self._children_of(Level.DOMAIN_GROUP, group.id):
                d = domain.to_dict()
                subs = []
                for sub in self._children_of(Level.DOMAIN, domain.id):
                    s = sub.to_dict()
                    s["children"] = [p.to_dict() for p in self._children_of(Level.SUBDOMAIN, sub.id)]
                    subs.append(s)
                d["children"] = subs
                domains.append(d)
            g["children"] = domains
            result.append(g)
        return result
