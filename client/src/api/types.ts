// Domain types mirrored from the server API.

export const LEVELS = ["DomainGroup", "Domain", "Subdomain", "DataProduct"] as const;
export type Level = (typeof LEVELS)[number];

export const TECHNICAL_OWNER_REQUIRED: Record<Level, boolean> = {
  DomainGroup: false,
  Domain: true,
  Subdomain: true,
  DataProduct: true,
};

/** Human-readable, singular label per level. */
export const LEVEL_LABEL: Record<Level, string> = {
  DomainGroup: "Domain Group",
  Domain: "Domain",
  Subdomain: "Subdomain",
  DataProduct: "Data Product",
};

/** The level immediately below a given level, or null for leaves. */
export const CHILD_LEVEL: Record<Level, Level | null> = {
  DomainGroup: "Domain",
  Domain: "Subdomain",
  Subdomain: "DataProduct",
  DataProduct: null,
};

/** REST path segment per level. */
export const LEVEL_SEGMENT: Record<Level, string> = {
  DomainGroup: "domain-groups",
  Domain: "domains",
  Subdomain: "subdomains",
  DataProduct: "data-products",
};

/** Name of the parent-id field expected by the API on create/move. */
export const PARENT_FIELD: Record<Level, string | null> = {
  DomainGroup: null,
  Domain: "domainGroupId",
  Subdomain: "domainId",
  DataProduct: "subdomainId",
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

export interface DataProductNode extends BaseNode {
  level: "DataProduct";
  subdomainId: string;
}
export interface SubdomainNode extends BaseNode {
  level: "Subdomain";
  domainId: string;
  children: DataProductNode[];
}
export interface DomainNode extends BaseNode {
  level: "Domain";
  domainGroupId: string;
  children: SubdomainNode[];
}
export interface DomainGroupNode extends BaseNode {
  level: "DomainGroup";
  children: DomainNode[];
}

export type TreeNode = DomainGroupNode | DomainNode | SubdomainNode | DataProductNode;
export type TaxonomyTree = DomainGroupNode[];

export interface NodeFormValues {
  name: string;
  description: string;
  businessOwner: string;
  technicalOwner: string;
}

export interface ImportError {
  row: number;
  message: string;
}
export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
