"""Tests for the hardening features: soft delete + restore, optimistic locking,
DB-level uniqueness, and the audit trail."""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from taxonomy import audit
from taxonomy.models import DomainGroup
from taxonomy.service import TaxonomyService
from taxonomy.types import Level
from taxonomy.validation import ConflictError, NotFoundError, ValidationError
from tests.conftest import full_row, build_workbook, seed_chain


# -- soft delete & restore ----------------------------------------------

def test_delete_is_soft_and_hidden(service: TaxonomyService):
    chain = seed_chain(service)
    service.remove(Level.SUBDOMAIN, chain["sub"]["id"], actor="alice@aa.com")
    with pytest.raises(NotFoundError):
        service.get(Level.SUBDOMAIN, chain["sub"]["id"])
    # Gone from the tree, present in the recycle bin.
    tree = service.get_tree()
    assert tree[0]["children"][0]["children"] == []
    deleted = service.list_deleted()
    assert any(d["id"] == chain["sub"]["id"] and d["deletedBy"] == "alice@aa.com" for d in deleted)


def test_restore_brings_back_subtree(service: TaxonomyService):
    chain = seed_chain(service)
    service.remove(Level.DOMAIN, chain["domain"]["id"], actor="a@aa.com")
    # The data product under it is also gone.
    assert service.list_deleted()
    service.restore(Level.DOMAIN, chain["domain"]["id"], actor="a@aa.com")
    # Whole branch is back.
    tree = service.get_tree()
    assert tree[0]["children"][0]["children"][0]["children"][0]["name"] == "Profile"
    assert service.list_deleted() == []


def test_name_can_be_reused_after_soft_delete(service: TaxonomyService):
    a = service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "J"})
    service.remove(Level.DOMAIN_GROUP, a["id"])
    # Same name is allowed again because the old row is soft-deleted.
    b = service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "J"})
    assert b["id"] != a["id"]


def test_restore_conflict_when_name_taken(service: TaxonomyService):
    a = service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "J"})
    service.remove(Level.DOMAIN_GROUP, a["id"])
    service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "J"})
    with pytest.raises(ConflictError):
        service.restore(Level.DOMAIN_GROUP, a["id"])


def test_restore_requires_active_parent(service: TaxonomyService):
    chain = seed_chain(service)
    service.remove(Level.DOMAIN_GROUP, chain["group"]["id"])
    # Cannot restore a subdomain while its ancestor domain is still deleted.
    with pytest.raises(ValidationError):
        service.restore(Level.SUBDOMAIN, chain["sub"]["id"])


# -- optimistic locking --------------------------------------------------

def test_version_increments_on_update(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "C", "description": "d", "businessOwner": "J"})
    assert g["version"] == 1
    updated = service.update(Level.DOMAIN_GROUP, g["id"], {"description": "new"})
    assert updated["version"] == 2


def test_stale_expected_version_is_rejected(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "C", "description": "d", "businessOwner": "J"})
    service.update(Level.DOMAIN_GROUP, g["id"], {"description": "first"}, expected_version=1)
    with pytest.raises(ConflictError):
        service.update(Level.DOMAIN_GROUP, g["id"], {"description": "second"}, expected_version=1)


def test_matching_expected_version_succeeds(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "C", "description": "d", "businessOwner": "J"})
    out = service.update(Level.DOMAIN_GROUP, g["id"], {"description": "x"}, expected_version=g["version"])
    assert out["description"] == "x"


def test_api_patch_with_stale_version_returns_409(client):
    g = client.post("/api/domain-groups", json={"name": "C", "description": "d", "businessOwner": "J"}).json()
    client.patch(f"/api/domain-groups/{g['id']}", json={"description": "v2", "expectedVersion": 1})
    res = client.patch(f"/api/domain-groups/{g['id']}", json={"description": "v3", "expectedVersion": 1})
    assert res.status_code == 409


# -- DB-level uniqueness -------------------------------------------------

def test_database_blocks_duplicate_sibling_name(session):
    # Bypass the service-layer check and write straight to the DB; the partial
    # unique index must still reject a case-insensitive duplicate.
    session.add(DomainGroup(name="Customer", description="d", business_owner="J"))
    session.flush()
    session.add(DomainGroup(name="customer", description="d", business_owner="J"))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_database_allows_duplicate_after_soft_delete(service: TaxonomyService, session):
    a = service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "J"})
    service.remove(Level.DOMAIN_GROUP, a["id"])
    # Direct insert of the same name now succeeds at the DB level.
    session.add(DomainGroup(name="Customer", description="d", business_owner="J"))
    session.flush()


# -- audit trail ---------------------------------------------------------

def test_mutations_are_audited(service: TaxonomyService, session):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "C", "description": "d", "businessOwner": "J"}, actor="bob@aa.com")
    service.update(Level.DOMAIN_GROUP, g["id"], {"description": "changed"}, actor="bob@aa.com")
    service.remove(Level.DOMAIN_GROUP, g["id"], actor="bob@aa.com")
    entries = audit.list_entries(session, node_id=g["id"])
    actions = {e["action"] for e in entries}
    assert {"create", "update", "delete"} <= actions
    assert all(e["actor"] == "bob@aa.com" for e in entries)


def test_import_is_audited_with_actor(service: TaxonomyService, excel, session):
    data = build_workbook([full_row(["Customer", "d", "Jane"])])
    excel.import_workbook(data, actor="importer@aa.com")
    entries = audit.list_entries(session)
    assert any(e["actor"] == "importer@aa.com" and e["action"] == "create" for e in entries)
