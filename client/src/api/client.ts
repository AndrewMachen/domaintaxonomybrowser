import {
  ApiError,
  ImportSummary,
  Level,
  LEVEL_SEGMENT,
  NodeFormValues,
  PARENT_FIELD,
  TaxonomyTree,
} from "./types";

const BASE = "/api";

/** Error thrown for non-2xx responses, carrying server field-level messages. */
export class RequestError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, body: ApiError) {
    super(body.error || `Request failed (${status})`);
    this.name = "RequestError";
    this.status = status;
    this.fields = body.fields;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let body: ApiError = { error: `Request failed (${res.status})` };
  try {
    body = (await res.json()) as ApiError;
  } catch {
    /* non-JSON error body */
  }
  throw new RequestError(res.status, body);
}

async function jsonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

export function fetchTree(): Promise<TaxonomyTree> {
  return jsonRequest<TaxonomyTree>("GET", "/tree");
}

/** Build the create payload, injecting the right parent-id field for the level. */
function createPayload(level: Level, parentId: string | null, values: NodeFormValues) {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    description: values.description.trim(),
    businessOwner: values.businessOwner.trim(),
    technicalOwner: values.technicalOwner.trim() || null,
  };
  const field = PARENT_FIELD[level];
  if (field) payload[field] = parentId;
  return payload;
}

export function createNode(level: Level, parentId: string | null, values: NodeFormValues) {
  return jsonRequest("POST", `/${LEVEL_SEGMENT[level]}`, createPayload(level, parentId, values));
}

export function updateNode(level: Level, id: string, values: Partial<NodeFormValues>) {
  const payload: Record<string, unknown> = {};
  if (values.name !== undefined) payload.name = values.name.trim();
  if (values.description !== undefined) payload.description = values.description.trim();
  if (values.businessOwner !== undefined) payload.businessOwner = values.businessOwner.trim();
  if (values.technicalOwner !== undefined) payload.technicalOwner = values.technicalOwner.trim() || null;
  return jsonRequest("PATCH", `/${LEVEL_SEGMENT[level]}/${id}`, payload);
}

export function deleteNode(level: Level, id: string): Promise<{ descendantsRemoved: number }> {
  return jsonRequest("DELETE", `/${LEVEL_SEGMENT[level]}/${id}`);
}

export function reorderNodes(level: Level, parentId: string | null, orderedIds: string[]) {
  return jsonRequest("POST", `/${LEVEL_SEGMENT[level]}/reorder`, { parentId, orderedIds });
}

export function moveNode(level: Level, id: string, newParentId: string, newIndex: number) {
  return jsonRequest("POST", `/${LEVEL_SEGMENT[level]}/${id}/move`, { newParentId, newIndex });
}

export function exportUrl(): string {
  return `${BASE}/export`;
}

export function templateUrl(): string {
  return `${BASE}/template`;
}

export async function importWorkbook(file: File): Promise<ImportSummary> {
  const res = await fetch(`${BASE}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
  return parse<ImportSummary>(res);
}
