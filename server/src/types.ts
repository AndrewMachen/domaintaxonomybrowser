// Shared taxonomy types used across the service, API and Excel layers.

export const LEVELS = [
  "DomainGroup",
  "Domain",
  "Subdomain",
  "DataProduct",
] as const;

export type Level = (typeof LEVELS)[number];

/** Levels at which a Technical Owner is mandatory. */
export const TECHNICAL_OWNER_REQUIRED: Record<Level, boolean> = {
  DomainGroup: false,
  Domain: true,
  Subdomain: true,
  DataProduct: true,
};

export interface BaseNode {
  id: string;
  name: string;
  description: string;
  businessOwner: string;
  technicalOwner: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DomainGroup extends BaseNode {
  level: "DomainGroup";
}

export interface Domain extends BaseNode {
  level: "Domain";
  domainGroupId: string;
}

export interface Subdomain extends BaseNode {
  level: "Subdomain";
  domainId: string;
}

export interface DataProduct extends BaseNode {
  level: "DataProduct";
  subdomainId: string;
}

export type TaxonomyNode = DomainGroup | Domain | Subdomain | DataProduct;

// Tree shapes returned by the API for the explorer view.
export interface DataProductNode extends DataProduct {}
export interface SubdomainNode extends Subdomain {
  children: DataProductNode[];
}
export interface DomainNode extends Domain {
  children: SubdomainNode[];
}
export interface DomainGroupNode extends DomainGroup {
  children: DomainNode[];
}
export type TaxonomyTree = DomainGroupNode[];

// Input payloads (id / timestamps / sortOrder are server-managed).
export interface CreateInput {
  name: string;
  description: string;
  businessOwner: string;
  technicalOwner?: string | null;
}

export interface UpdateInput {
  name?: string;
  description?: string;
  businessOwner?: string;
  technicalOwner?: string | null;
}

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  message: string;
}
