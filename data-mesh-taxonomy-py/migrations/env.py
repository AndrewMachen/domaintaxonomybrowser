"""Alembic environment.

The database URL is resolved from the environment via the app's own helpers, so
migrations target whatever the app targets (SQLite locally, Lakebase Postgres on
Databricks). When the app runs migrations on startup it passes its live engine
connection in through ``config.attributes['connection']`` so the same Lakebase
OAuth token hook is reused.
"""
from __future__ import annotations

from alembic import context

from taxonomy.db import create_db_engine, resolve_database_url
from taxonomy.models import Base

config = context.config
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=resolve_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=True,
        )
        context.run_migrations()
        return

    engine = create_db_engine(create_tables=False)
    with engine.connect() as conn:
        context.configure(
            connection=conn,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
