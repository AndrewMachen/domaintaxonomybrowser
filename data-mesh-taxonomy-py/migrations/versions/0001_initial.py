"""initial schema

Baseline migration. Creates the full schema (the four taxonomy tables with
soft-delete + version columns and partial unique indexes, plus the audit log,
role assignments, and domain grants) from the model metadata, which keeps it in
exact sync with the ORM. Subsequent schema changes use explicit, hand-written
migrations.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op

from taxonomy.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
