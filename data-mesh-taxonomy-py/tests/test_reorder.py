"""Reorder and move tests (subdomain DnD is mandatory)."""
from __future__ import annotations

import pytest

from taxonomy.service import TaxonomyService
from taxonomy.types import Level
from taxonomy.validation import ValidationError
from tests.conftest import seed_chain


def _make_subs(service, domain_id, names):
    return [
        service.create(Level.SUBDOMAIN, domain_id, {"name": n, "description": "d", "businessOwner": "J", "technicalOwner": "R"})
        for n in names
    ]


def test_reorder_within_domain(service: TaxonomyService):
    chain = seed_chain(service)
    a, b, c = _make_subs(service, chain["domain"]["id"], ["A", "B", "C"])
    # initial: Membership(0), A(1), B(2), C(3)
    ids = [s["id"] for s in service.list(Level.SUBDOMAIN, chain["domain"]["id"])]
    reordered = list(reversed(ids))
    service.reorder(Level.SUBDOMAIN, chain["domain"]["id"], reordered)
    after = [s["id"] for s in service.list(Level.SUBDOMAIN, chain["domain"]["id"])]
    assert after == reordered


def test_reorder_rejects_wrong_id_set(service: TaxonomyService):
    chain = seed_chain(service)
    with pytest.raises(ValidationError):
        service.reorder(Level.SUBDOMAIN, chain["domain"]["id"], ["bogus"])


def test_move_subdomain_between_domains(service: TaxonomyService):
    chain = seed_chain(service)
    domain2 = service.create(Level.DOMAIN, chain["group"]["id"], {"name": "Pricing", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    moved = service.move(Level.SUBDOMAIN, chain["sub"]["id"], domain2["id"], 0)
    assert moved["domainId"] == domain2["id"]
    assert [s["name"] for s in service.list(Level.SUBDOMAIN, chain["domain"]["id"])] == []
    assert [s["name"] for s in service.list(Level.SUBDOMAIN, domain2["id"])] == ["Membership"]


def test_move_inserts_at_index(service: TaxonomyService):
    chain = seed_chain(service)
    domain2 = service.create(Level.DOMAIN, chain["group"]["id"], {"name": "Pricing", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    _make_subs(service, domain2["id"], ["X", "Y"])
    service.move(Level.SUBDOMAIN, chain["sub"]["id"], domain2["id"], 1)
    names = [s["name"] for s in service.list(Level.SUBDOMAIN, domain2["id"])]
    assert names == ["X", "Membership", "Y"]


def test_move_reindexes_source_parent(service: TaxonomyService):
    chain = seed_chain(service)
    a, b = _make_subs(service, chain["domain"]["id"], ["A", "B"])
    domain2 = service.create(Level.DOMAIN, chain["group"]["id"], {"name": "Pricing", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    # Move the first subdomain (Membership, index 0) away; source should compact to 0,1.
    service.move(Level.SUBDOMAIN, chain["sub"]["id"], domain2["id"], 0)
    remaining = service.list(Level.SUBDOMAIN, chain["domain"]["id"])
    assert [s["sortOrder"] for s in remaining] == [0, 1]
    assert [s["name"] for s in remaining] == ["A", "B"]


def test_move_domain_between_groups(service: TaxonomyService):
    chain = seed_chain(service)
    group2 = service.create(Level.DOMAIN_GROUP, None, {"name": "Commercial", "description": "d", "businessOwner": "S"})
    moved = service.move(Level.DOMAIN, chain["domain"]["id"], group2["id"], 0)
    assert moved["domainGroupId"] == group2["id"]


def test_move_data_product_between_subdomains(service: TaxonomyService):
    chain = seed_chain(service)
    sub2 = service.create(Level.SUBDOMAIN, chain["domain"]["id"], {"name": "Rewards", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    moved = service.move(Level.DATA_PRODUCT, chain["product"]["id"], sub2["id"], 0)
    assert moved["subdomainId"] == sub2["id"]


def test_cannot_move_domain_group(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "A", "description": "d", "businessOwner": "J"})
    g2 = service.create(Level.DOMAIN_GROUP, None, {"name": "B", "description": "d", "businessOwner": "J"})
    with pytest.raises(ValidationError):
        service.move(Level.DOMAIN_GROUP, g["id"], g2["id"], 0)


def test_move_into_name_collision_rejected(service: TaxonomyService):
    chain = seed_chain(service)
    domain2 = service.create(Level.DOMAIN, chain["group"]["id"], {"name": "Pricing", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    service.create(Level.SUBDOMAIN, domain2["id"], {"name": "Membership", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    from taxonomy.validation import ConflictError

    with pytest.raises(ConflictError):
        service.move(Level.SUBDOMAIN, chain["sub"]["id"], domain2["id"], 0)
