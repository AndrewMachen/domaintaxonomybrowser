"""Shared taxonomy types, level configuration, and request/response models."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class Level(str, Enum):
    DOMAIN_GROUP = "DomainGroup"
    DOMAIN = "Domain"
    SUBDOMAIN = "Subdomain"
    DATA_PRODUCT = "DataProduct"


LEVELS = [Level.DOMAIN_GROUP, Level.DOMAIN, Level.SUBDOMAIN, Level.DATA_PRODUCT]

# Levels at which a Technical Owner is mandatory.
TECHNICAL_OWNER_REQUIRED: dict[Level, bool] = {
    Level.DOMAIN_GROUP: False,
    Level.DOMAIN: True,
    Level.SUBDOMAIN: True,
    Level.DATA_PRODUCT: True,
}

LEVEL_LABEL: dict[Level, str] = {
    Level.DOMAIN_GROUP: "Domain Group",
    Level.DOMAIN: "Domain",
    Level.SUBDOMAIN: "Subdomain",
    Level.DATA_PRODUCT: "Data Product",
}

# The level immediately below a given level (None for leaves).
CHILD_LEVEL: dict[Level, Optional[Level]] = {
    Level.DOMAIN_GROUP: Level.DOMAIN,
    Level.DOMAIN: Level.SUBDOMAIN,
    Level.SUBDOMAIN: Level.DATA_PRODUCT,
    Level.DATA_PRODUCT: None,
}

# The level immediately above a given level (None for the root).
PARENT_LEVEL: dict[Level, Optional[Level]] = {
    Level.DOMAIN_GROUP: None,
    Level.DOMAIN: Level.DOMAIN_GROUP,
    Level.SUBDOMAIN: Level.DOMAIN,
    Level.DATA_PRODUCT: Level.SUBDOMAIN,
}

# REST path segment per level.
LEVEL_SEGMENT: dict[Level, str] = {
    Level.DOMAIN_GROUP: "domain-groups",
    Level.DOMAIN: "domains",
    Level.SUBDOMAIN: "subdomains",
    Level.DATA_PRODUCT: "data-products",
}

SEGMENT_TO_LEVEL: dict[str, Level] = {seg: lvl for lvl, seg in LEVEL_SEGMENT.items()}

# Name of the parent-id field carried in JSON payloads per level.
PARENT_FIELD: dict[Level, Optional[str]] = {
    Level.DOMAIN_GROUP: None,
    Level.DOMAIN: "domainGroupId",
    Level.SUBDOMAIN: "domainId",
    Level.DATA_PRODUCT: "subdomainId",
}


class CreateInput(BaseModel):
    """Create payload. Parent-id fields are accepted but ignored here."""

    model_config = ConfigDict(extra="ignore")

    name: str = ""
    description: str = ""
    businessOwner: str = ""
    technicalOwner: Optional[str] = None

    @field_validator("name", "description", "businessOwner", mode="before")
    @classmethod
    def _coerce_str(cls, v: object) -> str:
        return "" if v is None else str(v)


class UpdateInput(BaseModel):
    """Patch payload. Only provided fields are applied."""

    model_config = ConfigDict(extra="ignore")

    name: Optional[str] = None
    description: Optional[str] = None
    businessOwner: Optional[str] = None
    technicalOwner: Optional[str] = None


class ReorderInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    parentId: Optional[str] = None
    orderedIds: list[str]


class MoveInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    newParentId: str
    newIndex: Optional[int] = None
