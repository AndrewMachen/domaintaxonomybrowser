"""Reset and re-seed the configured database: python -m scripts.seed"""
from __future__ import annotations

from sqlalchemy import delete

from taxonomy.db import create_db_engine, make_session_factory
from taxonomy.models import DataProduct, Domain, DomainGroup, Subdomain
from taxonomy.seed import seed
from taxonomy.service import TaxonomyService


def main() -> None:
    engine = create_db_engine()
    factory = make_session_factory(engine)
    session = factory()
    try:
        for model in (DataProduct, Subdomain, Domain, DomainGroup):
            session.execute(delete(model))
        session.flush()
        seed(TaxonomyService(session))
        session.commit()
        print("Seeded sample taxonomy.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
