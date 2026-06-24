"""Shared fixtures and helpers for the test suite."""
from __future__ import annotations

import importlib
from io import BytesIO
from typing import Optional

import pytest
from openpyxl import Workbook

from taxonomy.db import create_db_engine, make_session_factory
from taxonomy.excel_service import COLUMNS, ExcelService
from taxonomy.service import TaxonomyService
from taxonomy.types import Level


@pytest.fixture
def factory(tmp_path):
    engine = create_db_engine(f"sqlite:///{tmp_path}/test.db")
    return make_session_factory(engine)


@pytest.fixture
def session(factory):
    s = factory()
    yield s
    s.close()


@pytest.fixture
def service(session) -> TaxonomyService:
    return TaxonomyService(session)


@pytest.fixture
def excel(service) -> ExcelService:
    return ExcelService(service)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/api.db")
    monkeypatch.setenv("SEED_ON_STARTUP", "false")
    monkeypatch.setenv("RUN_MIGRATIONS", "false")
    monkeypatch.setenv("AUTH_DISABLED", "true")
    import app as app_module

    importlib.reload(app_module)
    from fastapi.testclient import TestClient

    return TestClient(app_module.app)


# -- helpers -------------------------------------------------------------

def seed_chain(service: TaxonomyService) -> dict:
    """Create one node at each level and return their ids."""
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "Jane"})
    d = service.create(Level.DOMAIN, g["id"], {"name": "Loyalty", "description": "d", "businessOwner": "Jane", "technicalOwner": "Raj"})
    s = service.create(Level.SUBDOMAIN, d["id"], {"name": "Membership", "description": "d", "businessOwner": "Jane", "technicalOwner": "Raj"})
    p = service.create(Level.DATA_PRODUCT, s["id"], {"name": "Profile", "description": "d", "businessOwner": "Jane", "technicalOwner": "Raj"})
    return {"group": g, "domain": d, "sub": s, "product": p}


def full_row(
    dg: Optional[list[str]] = None,
    domain: Optional[list[str]] = None,
    sub: Optional[list[str]] = None,
    product: Optional[list[str]] = None,
) -> list[str]:
    """Build a 16-cell row. dg is [name, desc, biz]; others are [name, desc, biz, tech]."""
    dg_cells = [dg[0], dg[1], dg[2], ""] if dg else ["", "", "", ""]
    domain_cells = list(domain) if domain else ["", "", "", ""]
    sub_cells = list(sub) if sub else ["", "", "", ""]
    product_cells = list(product) if product else ["", "", "", ""]
    return dg_cells + domain_cells + sub_cells + product_cells


def build_workbook(rows: list[list[str]], header: Optional[list[str]] = None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Taxonomy"
    ws.append(header if header is not None else COLUMNS)
    for row in rows:
        ws.append(row)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def read_sheet(data: bytes) -> list[list[str]]:
    from openpyxl import load_workbook

    wb = load_workbook(BytesIO(data))
    ws = wb["Taxonomy"]
    out = []
    for row in ws.iter_rows(values_only=True):
        out.append(["" if c is None else str(c) for c in row])
    return out
