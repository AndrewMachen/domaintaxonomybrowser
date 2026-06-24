import { z } from "zod";
import { Level, TECHNICAL_OWNER_REQUIRED, CreateInput, UpdateInput } from "./types.js";

/** Thrown when a payload fails validation. Carries a field map for the API. */
export class ValidationError extends Error {
  status = 400;
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super("Validation failed");
    this.name = "ValidationError";
    this.fields = fields;
  }
}

/** Thrown when a sibling with the same name already exists under a parent. */
export class ConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Thrown when an entity cannot be found. */
export class NotFoundError extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const required = (label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`);

function buildCreateSchema(level: Level) {
  const base = {
    name: required("Name"),
    description: required("Description"),
    businessOwner: required("Business Owner"),
  };
  if (TECHNICAL_OWNER_REQUIRED[level]) {
    return z.object({ ...base, technicalOwner: required("Technical Owner") });
  }
  // Technical owner optional: accept empty string / null / undefined.
  return z.object({
    ...base,
    technicalOwner: z.string().trim().optional().nullable(),
  });
}

function zodToFields(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Validate and normalize a create payload for the given level. */
export function validateCreate(level: Level, input: unknown): Required<CreateInput> {
  const result = buildCreateSchema(level).safeParse(input);
  if (!result.success) throw new ValidationError(zodToFields(result.error));
  const data = result.data as CreateInput;
  return {
    name: data.name,
    description: data.description,
    businessOwner: data.businessOwner,
    technicalOwner: normalizeTechnicalOwner(data.technicalOwner),
  } as Required<CreateInput>;
}

/**
 * Validate an update payload. Only provided fields are checked, but the
 * resulting record must still satisfy required-field rules, so callers pass
 * the merged (existing + patch) record for a full re-validation.
 */
export function validateUpdate(level: Level, merged: CreateInput): Required<CreateInput> {
  return validateCreate(level, merged);
}

export function normalizeTechnicalOwner(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** Case-insensitive, whitespace-insensitive comparison for sibling names. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
