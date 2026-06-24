"""Generate Excel deliverables from an in-memory database.

  python -m scripts.make_template                 # writes taxonomy-template.xlsx
  python -m scripts.make_template sample-data.xlsx --seed   # exports seeded data
"""
from __future__ import annotations

import sys

from taxonomy.db import create_db_engine, make_session_factory
from taxonomy.excel_service import ExcelService
from taxonomy.seed import seed
from taxonomy.service import TaxonomyService


def main(argv: list[str]) -> None:
    out = next((a for a in argv if not a.startswith("-")), "taxonomy-template.xlsx")
    do_seed = "--seed" in argv

    engine = create_db_engine("sqlite://")  # in-memory
    factory = make_session_factory(engine)
    session = factory()
    try:
        service = TaxonomyService(session)
        excel = ExcelService(service)
        if do_seed:
            seed(service)
            session.flush()
            data = excel.export()
        else:
            data = excel.template()
        with open(out, "wb") as fh:
            fh.write(data)
        print(f"Wrote {out}")
    finally:
        session.close()


if __name__ == "__main__":
    main(sys.argv[1:])
