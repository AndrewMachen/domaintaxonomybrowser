"""Audit logging: an append-only trail of who changed what."""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .models import AuditLog


def record(
    session: Session,
    actor: str,
    action: str,
    level: Optional[str] = None,
    node_id: Optional[str] = None,
    node_name: Optional[str] = None,
    details: Optional[dict] = None,
) -> None:
    session.add(
        AuditLog(
            actor=actor or "system",
            action=action,
            level=level,
            node_id=node_id,
            node_name=node_name,
            details=json.dumps(details, default=str) if details else None,
        )
    )


def list_entries(session: Session, limit: int = 200, node_id: Optional[str] = None) -> list[dict]:
    stmt = select(AuditLog).order_by(desc(AuditLog.created_at))
    if node_id:
        stmt = stmt.where(AuditLog.node_id == node_id)
    stmt = stmt.limit(max(1, min(int(limit), 1000)))
    return [row.to_dict() for row in session.execute(stmt).scalars()]
