import {
  DomainGroupNode,
  DomainNode,
  Level,
  SubdomainNode,
  TaxonomyTree,
  TreeNode,
} from "../api/types";
import { Filters } from "../components/FilterBar";

function matches(node: TreeNode, level: Level, f: Filters): boolean {
  if (f.level !== "all" && f.level !== level) return false;
  if (f.businessOwner && node.businessOwner !== f.businessOwner) return false;
  if (f.technicalOwner && node.technicalOwner !== f.technicalOwner) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!node.name.toLowerCase().includes(q) && !node.description.toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}

const isActive = (f: Filters): boolean =>
  !!f.search || !!f.businessOwner || !!f.technicalOwner || f.level !== "all";

export interface FilterResult {
  tree: TaxonomyTree;
  /** Ids to force-expand so matches deep in the hierarchy stay visible. */
  expand: Set<string>;
  /** Total number of nodes that directly matched. */
  count: number;
}

/**
 * Returns a pruned tree containing matching nodes plus the ancestors needed to
 * reach them. When a branch node matches, its whole subtree is retained.
 */
export function filterTree(tree: TaxonomyTree, f: Filters): FilterResult {
  if (!isActive(f)) return { tree, expand: new Set(), count: 0 };

  const expand = new Set<string>();
  let count = 0;

  const groups: DomainGroupNode[] = [];
  for (const g of tree) {
    const gMatch = matches(g, "DomainGroup", f);
    const domains: DomainNode[] = [];
    for (const d of g.children) {
      const dMatch = matches(d, "Domain", f);
      const subs: SubdomainNode[] = [];
      for (const s of d.children) {
        const sMatch = matches(s, "Subdomain", f);
        const products = s.children.filter((p) => matches(p, "DataProduct", f));
        count += products.length;
        if (sMatch || products.length > 0) {
          if (sMatch) count += 1;
          subs.push({ ...s, children: sMatch ? s.children : products });
          if (products.length > 0 && !sMatch) expand.add(s.id);
        }
      }
      if (dMatch || subs.length > 0) {
        if (dMatch) count += 1;
        domains.push({ ...d, children: dMatch ? d.children : subs });
        if (subs.length > 0 && !dMatch) expand.add(d.id);
      }
    }
    if (gMatch || domains.length > 0) {
      if (gMatch) count += 1;
      groups.push({ ...g, children: gMatch ? g.children : domains });
      if (domains.length > 0 && !gMatch) expand.add(g.id);
    }
  }

  // Expand every retained ancestor so matches are revealed.
  const addAll = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if ("children" in n && (n.children as TreeNode[]).length) {
        expand.add(n.id);
        addAll(n.children as TreeNode[]);
      }
    }
  };
  addAll(groups);

  return { tree: groups, expand, count };
}

export function collectOwners(tree: TaxonomyTree): {
  business: string[];
  technical: string[];
} {
  const business = new Set<string>();
  const technical = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.businessOwner) business.add(n.businessOwner);
      if (n.technicalOwner) technical.add(n.technicalOwner);
      if ("children" in n) walk(n.children as TreeNode[]);
    }
  };
  walk(tree);
  return {
    business: [...business].sort((a, b) => a.localeCompare(b)),
    technical: [...technical].sort((a, b) => a.localeCompare(b)),
  };
}
