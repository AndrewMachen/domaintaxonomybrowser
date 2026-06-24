"""Database engine and session management.

Persistence is driven by the environment so the same code runs on local SQLite
and on Databricks Lakebase (PostgreSQL):

* Local / tests:  ``sqlite:///taxonomy.db`` (default) or ``sqlite://`` in-memory.
* Databricks:     ``DATABASE_URL`` if set, otherwise a URL assembled from the
  ``PGHOST`` / ``PGDATABASE`` / ``PGUSER`` (and optional ``PGPASSWORD``) vars a
  bound Lakebase resource injects.

**Lakebase token refresh.** Lakebase OAuth tokens used as the Postgres password
expire after ~60 minutes, and a long-lived pooled connection would eventually
fail authentication. When a Lakebase instance name is configured, a SQLAlchemy
``do_connect`` hook injects a freshly generated OAuth token (via the Databricks
SDK) into every new DBAPI connection, and the pool is set to recycle
connections well within the token lifetime. No static password is stored.
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from .models import Base

# Refresh Lakebase tokens before the ~60 min expiry; recycle connections under it.
_TOKEN_TTL_SECONDS = 3600
_TOKEN_REFRESH_MARGIN = 300
_POOL_RECYCLE_SECONDS = 1800


def resolve_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://") :]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        return url

    host = os.environ.get("PGHOST")
    if host:
        user = os.environ.get("PGUSER", "")
        password = os.environ.get("PGPASSWORD", "")
        db = os.environ.get("PGDATABASE", "databricks_postgres")
        port = os.environ.get("PGPORT", "5432")
        # Omit the password when none is provided: the token hook supplies it.
        auth = user if not password else f"{user}:{password}"
        sslmode = os.environ.get("PGSSLMODE", "require")
        return f"postgresql+psycopg://{auth}@{host}:{port}/{db}?sslmode={sslmode}"

    return "sqlite:///taxonomy.db"


def _lakebase_instance() -> str | None:
    return (
        os.environ.get("LAKEBASE_INSTANCE_NAME")
        or os.environ.get("DATABASE_INSTANCE_NAME")
        or os.environ.get("PGINSTANCE")
    )


def _install_lakebase_token_refresh(engine: Engine) -> bool:
    """Inject a fresh Lakebase OAuth token as the password on each new connection."""
    instance = _lakebase_instance()
    if not instance:
        return False
    try:
        from databricks.sdk import WorkspaceClient
    except Exception:  # pragma: no cover - SDK not installed locally
        return False

    client = WorkspaceClient()
    lock = threading.Lock()
    cache: dict[str, float | str | None] = {"token": None, "expires": 0.0}

    def current_token() -> str:
        with lock:
            now = time.time()
            if cache["token"] and now < float(cache["expires"]) - _TOKEN_REFRESH_MARGIN:
                return str(cache["token"])
            cred = client.database.generate_database_credential(
                request_id=str(uuid.uuid4()), instance_names=[instance]
            )
            cache["token"] = cred.token
            cache["expires"] = now + _TOKEN_TTL_SECONDS
            return str(cred.token)

    @event.listens_for(engine, "do_connect")
    def _provide_token(_dialect, _conn_rec, _cargs, cparams):  # noqa: ANN001
        cparams["password"] = current_token()
        return None

    return True


def create_db_engine(url: str | None = None, create_tables: bool = True) -> Engine:
    url = url or resolve_database_url()
    parsed = make_url(url)
    is_sqlite = parsed.get_backend_name() == "sqlite"

    connect_args: dict = {}
    engine_kwargs: dict = {"future": True}
    if is_sqlite:
        connect_args["check_same_thread"] = False
    else:
        engine_kwargs["pool_pre_ping"] = True
        engine_kwargs["pool_recycle"] = _POOL_RECYCLE_SECONDS

    engine = create_engine(url, connect_args=connect_args, **engine_kwargs)

    if is_sqlite:
        @event.listens_for(engine, "connect")
        def _enable_sqlite_fk(dbapi_connection, _record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
    else:
        _install_lakebase_token_refresh(engine)

    if create_tables:
        Base.metadata.create_all(engine)
    return engine


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    """Transactional scope: commit on success, roll back on any exception."""
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
