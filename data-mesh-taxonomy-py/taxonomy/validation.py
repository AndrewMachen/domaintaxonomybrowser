"""Validation rules and typed exceptions, mirrored across API and Excel import."""
from __future__ import annotations

from .types import Level, TECHNICAL_OWNER_REQUIRED


class AppError(Exception):
    status = 500

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message

    def payload(self) -> dict:
        return {"error": self.message}


class ValidationError(AppError):
    status = 400

    def __init__(self, fields: dict[str, str], message: str = "Validation failed") -> None:
        super().__init__(message)
        self.fields = fields

    def payload(self) -> dict:
        return {"error": self.message, "fields": self.fields}


class ConflictError(AppError):
    status = 409


class NotFoundError(AppError):
    status = 404


class UnauthorizedError(AppError):
    status = 401


class ForbiddenError(AppError):
    status = 403


def normalize_technical_owner(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def same_name(a: str, b: str) -> bool:
    """Case- and whitespace-insensitive sibling-name comparison."""
    return a.strip().casefold() == b.strip().casefold()


def _validate_fields(
    level: Level,
    name: str,
    description: str,
    business_owner: str,
    technical_owner: str | None,
) -> dict[str, str]:
    fields: dict[str, str] = {}
    if not (name or "").strip():
        fields["name"] = "Name is required"
    if not (description or "").strip():
        fields["description"] = "Description is required"
    if not (business_owner or "").strip():
        fields["businessOwner"] = "Business owner is required"
    if TECHNICAL_OWNER_REQUIRED[level] and not (technical_owner or "").strip():
        fields["technicalOwner"] = "Technical owner is required"
    return fields


def validate_create(level: Level, data: dict) -> dict:
    """Validate a create payload; returns a normalized field dict."""
    name = data.get("name", "")
    description = data.get("description", "")
    business_owner = data.get("businessOwner", "")
    technical_owner = data.get("technicalOwner")
    fields = _validate_fields(level, name, description, business_owner, technical_owner)
    if fields:
        raise ValidationError(fields)
    return {
        "name": name.strip(),
        "description": description.strip(),
        "businessOwner": business_owner.strip(),
        "technicalOwner": normalize_technical_owner(technical_owner),
    }


def validate_update(level: Level, merged: dict) -> dict:
    """Validate the merged (existing + patch) state of a node."""
    return validate_create(level, merged)
