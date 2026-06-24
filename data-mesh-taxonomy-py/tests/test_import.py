"""Excel import tests: structure, create/update, dedupe, validation, atomicity."""
from __future__ import annotations

import pytest

from taxonomy.excel_service import COLUMNS, ExcelService
from taxonomy.service import TaxonomyService
from taxonomy.types import Level
from taxonomy.validation import ValidationError
from tests.conftest import build_workbook, full_row


def test_import_rejects_missing_required_column(excel: ExcelService):
    header = [c for c in COLUMNS if c != "Domain Name"]
    data = build_workbook([], header=header)
    with pytest.raises(ValidationError) as exc:
        excel.import_workbook(data)
    assert "Domain Name" in exc.value.fields["file"]


def test_import_creates_full_branch(service: TaxonomyService, excel: ExcelService):
    data = build_workbook([
        full_row(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
    ])
    summary = excel.import_workbook(data)
    assert summary["created"] == 4
    assert summary["updated"] == 0
    assert summary["errors"] == []
    assert len(service.list(Level.DOMAIN_GROUP, None)) == 1


def test_import_dedupes_shared_ancestors(service: TaxonomyService, excel: ExcelService):
    data = build_workbook([
        full_row(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
        full_row(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Ledger", "d", "Jane", "Raj"]),
    ])
    summary = excel.import_workbook(data)
    # Row 1 creates 4 nodes; row 2 reuses the 3 ancestors and creates 1 product.
    assert summary["created"] == 5
    assert summary["errors"] == []
    products = service.list(Level.DATA_PRODUCT, service.list(Level.SUBDOMAIN, service.list(Level.DOMAIN, service.list(Level.DOMAIN_GROUP, None)[0]["id"])[0]["id"])[0]["id"])
    assert sorted(p["name"] for p in products) == ["Ledger", "Profile"]


def test_import_updates_existing(service: TaxonomyService, excel: ExcelService):
    service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "old", "businessOwner": "Jane"})
    data = build_workbook([full_row(["Customer", "new description", "Jane"])])
    summary = excel.import_workbook(data)
    assert summary["created"] == 0
    assert summary["updated"] == 1
    assert service.list(Level.DOMAIN_GROUP, None)[0]["description"] == "new description"


def test_import_no_change_is_not_counted(service: TaxonomyService, excel: ExcelService):
    service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "Jane"})
    data = build_workbook([full_row(["Customer", "d", "Jane"])])
    summary = excel.import_workbook(data)
    assert summary["created"] == 0
    assert summary["updated"] == 0


def test_import_blank_rows_are_skipped(service: TaxonomyService, excel: ExcelService):
    data = build_workbook([
        full_row(["Customer", "d", "Jane"]),
        full_row(),  # blank
    ])
    summary = excel.import_workbook(data)
    assert summary["created"] == 1
    assert summary["skipped"] == 1


def test_import_row_missing_ancestor_is_an_error(service: TaxonomyService, excel: ExcelService):
    # Subdomain present without a Domain on the row.
    data = build_workbook([
        full_row(["Customer", "d", "Jane"], None, ["Membership", "d", "Jane", "Raj"]),
    ])
    summary = excel.import_workbook(data)
    assert len(summary["errors"]) == 1
    assert "Subdomain present but Domain is missing" in summary["errors"][0]["message"]


def test_import_invalid_child_blocks_whole_row(service: TaxonomyService, excel: ExcelService):
    # Data product missing its required technical owner -> the entire row is
    # rejected, so the domain group on that row must NOT be created.
    data = build_workbook([
        full_row(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", ""]),
    ])
    summary = excel.import_workbook(data)
    assert summary["created"] == 0
    assert len(summary["errors"]) == 1
    assert service.list(Level.DOMAIN_GROUP, None) == []


def test_import_valid_rows_persist_alongside_invalid(service: TaxonomyService, excel: ExcelService):
    data = build_workbook([
        full_row(["Customer", "d", "Jane"]),
        full_row(["", "", ""], ["Orphan", "d", "Jane", "Raj"]),  # domain w/o group -> error
        full_row(["Commercial", "d", "Sam"]),
    ])
    summary = excel.import_workbook(data)
    assert summary["created"] == 2
    assert len(summary["errors"]) == 1
    names = sorted(g["name"] for g in service.list(Level.DOMAIN_GROUP, None))
    assert names == ["Commercial", "Customer"]
