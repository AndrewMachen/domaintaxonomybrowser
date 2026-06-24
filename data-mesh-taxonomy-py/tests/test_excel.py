"""Excel export and template tests."""
from __future__ import annotations

from taxonomy.excel_service import COLUMNS, ExcelService
from taxonomy.service import TaxonomyService
from taxonomy.types import Level
from tests.conftest import read_sheet, seed_chain


def test_export_has_header(service: TaxonomyService, excel: ExcelService):
    seed_chain(service)
    rows = read_sheet(excel.export())
    assert rows[0] == list(COLUMNS)


def test_export_emits_one_row_per_leaf(service: TaxonomyService, excel: ExcelService):
    seed_chain(service)
    rows = read_sheet(excel.export())
    assert len(rows) == 2  # header + one full branch
    data = rows[1]
    assert data[0] == "Customer"
    assert data[4] == "Loyalty"
    assert data[8] == "Membership"
    assert data[12] == "Profile"


def test_export_preserves_empty_branches(service: TaxonomyService, excel: ExcelService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "Empty", "description": "d", "businessOwner": "J"})
    service.create(Level.DOMAIN, g["id"], {"name": "DomOnly", "description": "d", "businessOwner": "J", "technicalOwner": "T"})
    rows = read_sheet(excel.export())
    assert len(rows) == 2
    data = rows[1]
    assert data[0] == "Empty"
    assert data[4] == "DomOnly"
    assert data[8] == ""  # no subdomain


def test_domain_group_technical_owner_blank_when_absent(service: TaxonomyService, excel: ExcelService):
    service.create(Level.DOMAIN_GROUP, None, {"name": "X", "description": "d", "businessOwner": "J"})
    rows = read_sheet(excel.export())
    assert rows[1][3] == ""  # DG technical owner column


def test_template_has_header_and_example(excel: ExcelService):
    rows = read_sheet(excel.template())
    assert rows[0] == list(COLUMNS)
    assert rows[1][0] == "Customer"
    assert rows[1][12] == "Member Profile"


def test_export_round_trips_through_import(service: TaxonomyService, excel: ExcelService):
    seed_chain(service)
    data = excel.export()
    # Re-importing the same workbook should change nothing.
    summary = excel.import_workbook(data)
    assert summary["created"] == 0
    assert summary["updated"] == 0
    assert summary["errors"] == []
