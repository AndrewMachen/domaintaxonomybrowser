"""Application entrypoint for Databricks Apps (and local development).

Run locally:      python app.py
Databricks Apps:  the command in app.yaml runs this module; it binds to
                  0.0.0.0 on $DATABRICKS_APP_PORT.

One FastAPI process serves the REST API under /api and the pre-built React SPA
from ./static. On startup it runs database migrations (Alembic) unless
RUN_MIGRATIONS=false, then optionally seeds sample data.
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from taxonomy.db import create_db_engine, make_session_factory
from taxonomy.routes import build_router, register_exception_handlers
from taxonomy.seed import seed_if_empty
from taxonomy.service import TaxonomyService

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"


def _migrations_enabled() -> bool:
    return os.environ.get("RUN_MIGRATIONS", "true").lower() != "false"


def run_migrations(engine: Engine) -> None:
    """Bring the database schema up to head, reusing the app's engine."""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "migrations"))
    with engine.begin() as connection:
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, "head")


def create_app() -> FastAPI:
    use_migrations = _migrations_enabled()
    engine = create_db_engine(create_tables=not use_migrations)
    if use_migrations:
        run_migrations(engine)

    session_factory = make_session_factory(engine)

    if os.environ.get("SEED_ON_STARTUP", "true").lower() != "false":
        session = session_factory()
        try:
            if seed_if_empty(TaxonomyService(session)):
                session.commit()
            else:
                session.rollback()
        finally:
            session.close()

    def get_session() -> Iterator[Session]:
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app = FastAPI(title="Data Mesh Taxonomy", version="1.0.0")
    register_exception_handlers(app)
    app.include_router(build_router(get_session), prefix="/api")

    if (STATIC_DIR / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    else:

        @app.get("/")
        def _placeholder() -> dict:
            return {
                "status": "API running",
                "note": "Build the React client and copy its dist/ into ./static to serve the UI.",
                "api": "/api/tree",
            }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DATABRICKS_APP_PORT") or os.environ.get("PORT") or 8000)
    uvicorn.run(app, host="0.0.0.0", port=port)
