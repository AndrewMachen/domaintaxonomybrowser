"""CRUD and tree-assembly tests."""
from __future__ import annotations

import pytest

from taxonomy.service import TaxonomyService
from taxonomy.types import Level
from taxonomy.validation import NotFoundError
from tests.conftest import seed_chain


def test_create_and_get_domain_group(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "Jane"})
    assert g["id"]
    assert g["level"] == "DomainGroup"
    assert g["technicalOwner"] is None
    assert g["sortOrder"] == 0
    fetched = service.get(Level.DOMAIN_GROUP, g["id"])
    assert fetched["name"] == "Customer"


def test_create_assigns_incrementing_sort_order(service: TaxonomyService):
    a = service.create(Level.DOMAIN_GROUP, None, {"name": "A", "description": "d", "businessOwner": "J"})
    b = service.create(Level.DOMAIN_GROUP, None, {"name": "B", "description": "d", "businessOwner": "J"})
    assert a["sortOrder"] == 0
    assert b["sortOrder"] == 1


def test_create_child_carries_parent_id(service: TaxonomyService):
    chain = seed_chain(service)
    assert chain["domain"]["domainGroupId"] == chain["group"]["id"]
    assert chain["sub"]["domainId"] == chain["domain"]["id"]
    assert chain["product"]["subdomainId"] == chain["sub"]["id"]


def test_update_changes_fields(service: TaxonomyService):
    chain = seed_chain(service)
    updated = service.update(Level.DOMAIN, chain["domain"]["id"], {"description": "new desc", "technicalOwner": "Lena"})
    assert updated["description"] == "new desc"
    assert updated["technicalOwner"] == "Lena"
    assert updated["name"] == "Loyalty"


def test_rename(service: TaxonomyService):
    chain = seed_chain(service)
    renamed = service.rename(Level.SUBDOMAIN, chain["sub"]["id"], "Memberships")
    assert renamed["name"] == "Memberships"


def test_clear_optional_technical_owner_on_domain_group(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "C", "description": "d", "businessOwner": "J", "technicalOwner": "T"})
    cleared = service.update(Level.DOMAIN_GROUP, g["id"], {"technicalOwner": None})
    assert cleared["technicalOwner"] is None


def test_list_returns_children(service: TaxonomyService):
    chain = seed_chain(service)
    service.create(Level.SUBDOMAIN, chain["domain"]["id"], {"name": "Rewards", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    subs = service.list(Level.SUBDOMAIN, chain["domain"]["id"])
    assert [s["name"] for s in subs] == ["Membership", "Rewards"]


def test_delete_leaf(service: TaxonomyService):
    chain = seed_chain(service)
    result = service.remove(Level.DATA_PRODUCT, chain["product"]["id"])
    assert result["descendantsRemoved"] == 0
    with pytest.raises(NotFoundError):
        service.get(Level.DATA_PRODUCT, chain["product"]["id"])


def test_delete_cascades_to_descendants(service: TaxonomyService):
    chain = seed_chain(service)
    result = service.remove(Level.DOMAIN_GROUP, chain["group"]["id"])
    # domain + subdomain + data product = 3
    assert result["descendantsRemoved"] == 3
    with pytest.raises(NotFoundError):
        service.get(Level.DOMAIN, chain["domain"]["id"])
    with pytest.raises(NotFoundError):
        service.get(Level.DATA_PRODUCT, chain["product"]["id"])


def test_get_missing_raises_not_found(service: TaxonomyService):
    with pytest.raises(NotFoundError):
        service.get(Level.DOMAIN_GROUP, "does-not-exist")


def test_get_tree_nests_all_levels(service: TaxonomyService):
    seed_chain(service)
    tree = service.get_tree()
    assert len(tree) == 1
    group = tree[0]
    assert group["children"][0]["name"] == "Loyalty"
    assert group["children"][0]["children"][0]["name"] == "Membership"
    assert group["children"][0]["children"][0]["children"][0]["name"] == "Profile"


def test_tree_preserves_empty_branches(service: TaxonomyService):
    service.create(Level.DOMAIN_GROUP, None, {"name": "Empty", "description": "d", "businessOwner": "J"})
    tree = service.get_tree()
    assert tree[0]["children"] == []
