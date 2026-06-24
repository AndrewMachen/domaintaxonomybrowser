"""Sample taxonomy seed data (parity with the original Node seed)."""
from __future__ import annotations

from .service import TaxonomyService
from .types import Level


def seed_if_empty(service: TaxonomyService) -> bool:
    """Idempotent: seed only when the taxonomy is empty."""
    if service.list(Level.DOMAIN_GROUP, None):
        return False
    seed(service)
    return True


def seed(service: TaxonomyService) -> None:
    customer = service.create(
        Level.DOMAIN_GROUP,
        None,
        {
            "name": "Customer",
            "description": "Customer-facing data assets across loyalty and profiles",
            "businessOwner": "Jane Doe",
        },
    )
    commercial = service.create(
        Level.DOMAIN_GROUP,
        None,
        {
            "name": "Commercial",
            "description": "Revenue, pricing and sales data assets",
            "businessOwner": "Sam Reed",
            "technicalOwner": "Lena Fox",
        },
    )

    loyalty = service.create(
        Level.DOMAIN,
        customer["id"],
        {
            "name": "Loyalty",
            "description": "Loyalty program data",
            "businessOwner": "Jane Doe",
            "technicalOwner": "Raj Patel",
        },
    )
    pricing = service.create(
        Level.DOMAIN,
        commercial["id"],
        {
            "name": "Pricing",
            "description": "Fare and ancillary pricing data",
            "businessOwner": "Sam Reed",
            "technicalOwner": "Lena Fox",
        },
    )

    membership = service.create(
        Level.SUBDOMAIN,
        loyalty["id"],
        {
            "name": "Membership",
            "description": "Member profiles and tier status",
            "businessOwner": "Jane Doe",
            "technicalOwner": "Raj Patel",
        },
    )
    rewards = service.create(
        Level.SUBDOMAIN,
        loyalty["id"],
        {
            "name": "Rewards",
            "description": "Points, awards and redemptions",
            "businessOwner": "Jane Doe",
            "technicalOwner": "Raj Patel",
        },
    )
    service.create(
        Level.SUBDOMAIN,
        pricing["id"],
        {
            "name": "Fare Rules",
            "description": "Fare construction and rules",
            "businessOwner": "Sam Reed",
            "technicalOwner": "Lena Fox",
        },
    )

    service.create(
        Level.DATA_PRODUCT,
        membership["id"],
        {
            "name": "Member Profile",
            "description": "Curated, deduplicated member profile",
            "businessOwner": "Jane Doe",
            "technicalOwner": "Raj Patel",
        },
    )
    service.create(
        Level.DATA_PRODUCT,
        rewards["id"],
        {
            "name": "Redemption Ledger",
            "description": "Daily redemption transactions",
            "businessOwner": "Jane Doe",
            "technicalOwner": "Raj Patel",
        },
    )
