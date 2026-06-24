import { Level, NodeFormValues, TECHNICAL_OWNER_REQUIRED } from "../api/types";

export type FieldErrors = Partial<Record<keyof NodeFormValues, string>>;

/**
 * Mirrors the server's create/update validation so the UI can surface errors
 * before a round-trip. The server remains the source of truth and re-validates.
 */
export function validateNode(level: Level, values: NodeFormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Name is required";
  if (!values.description.trim()) errors.description = "Description is required";
  if (!values.businessOwner.trim()) errors.businessOwner = "Business owner is required";
  if (TECHNICAL_OWNER_REQUIRED[level] && !values.technicalOwner.trim()) {
    errors.technicalOwner = "Technical owner is required";
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

export const emptyForm: NodeFormValues = {
  name: "",
  description: "",
  businessOwner: "",
  technicalOwner: "",
};
