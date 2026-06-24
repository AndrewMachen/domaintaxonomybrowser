"""Validation-rule tests."""
from __future__ import annotations

import pytest

from taxonomy.service import TaxonomyService
from taxonomy.types import Level
from taxonomy.validation import ConflictError, ValidationError
from tests.conftest import seed_chain


def test_name_required_all_levels(service: TaxonomyService):
    with pytest.raises(ValidationError) as exc:
        service.create(Level.DOMAIN_GROUP, None, {"name": "  ", "description": "d", "businessOwner": "J"})
    assert "name" in exc.value.fields


def test_description_required(service: TaxonomyService):
    with pytest.raises(ValidationError) as exc:
        service.create(Level.DOMAIN_GROUP, None, {"name": "X", "description": "", "businessOwner": "J"})
    assert "description" in exc.value.fields


def test_business_owner_required(service: TaxonomyService):
    with pytest.raises(ValidationError) as exc:
        service.create(Level.DOMAIN_GROUP, None, {"name": "X", "description": "d", "businessOwner": ""})
    assert "businessOwner" in exc.value.fields


def test_technical_owner_optional_for_domain_group(service: TaxonomyService):
    g = service.create(Level.DOMAIN_GROUP, None, {"name": "X", "description": "d", "businessOwner": "J"})
    assert g["technicalOwner"] is None


@pytest.mark.parametrize("level_name", ["Domain", "Subdomain", "DataProduct"])
def test_technical_owner_required_for_lower_levels(service: TaxonomyService, level_name: str):
    chain = seed_chain(service)
    parents = {
        "Domain": (Level.DOMAIN, chain["group"]["id"]),
        "Subdomain": (Level.SUBDOMAIN, chain["domain"]["id"]),
        "DataProduct": (Level.DATA_PRODUCT, chain["sub"]["id"]),
    }
    level, parent_id = parents[level_name]
    with pytest.raises(ValidationError) as exc:
        service.create(level, parent_id, {"name": "New", "description": "d", "businessOwner": "J"})
    assert "technicalOwner" in exc.value.fields


def test_duplicate_sibling_name_rejected(service: TaxonomyService):
    service.create(Level.DOMAIN_GROUP, None, {"name": "Customer", "description": "d", "businessOwner": "J"})
    with pytest.raises(ConflictError):
        service.create(Level.DOMAIN_GROUP, None, {"name": "customer", "description": "d", "businessOwner": "J"})


def test_duplicate_check_is_scoped_to_parent(service: TaxonomyService):
    chain = seed_chain(service)
    other_group = service.create(Level.DOMAIN_GROUP, None, {"name": "Commercial", "description": "d", "businessOwner": "S"})
    # Same domain name is allowed under a different group.
    service.create(Level.DOMAIN, other_group["id"], {"name": "Loyalty", "description": "d", "businessOwner": "S", "technicalOwner": "L"})
    assert len(service.list(Level.DOMAIN, other_group["id"])) == 1


def test_rename_to_existing_sibling_name_rejected(service: TaxonomyService):
    chain = seed_chain(service)
    service.create(Level.SUBDOMAIN, chain["domain"]["id"], {"name": "Rewards", "description": "d", "businessOwner": "J", "technicalOwner": "R"})
    with pytest.raises(ConflictError):
        service.rename(Level.SUBDOMAIN, chain["sub"]["id"], "Rewards")


def test_update_missing_technical_owner_on_domain_rejected(service: TaxonomyService):
    chain = seed_chain(service)
    with pytest.raises(ValidationError):
        service.update(Level.DOMAIN, chain["domain"]["id"], {"technicalOwner": None})
