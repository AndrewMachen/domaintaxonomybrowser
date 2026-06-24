import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import {
  Level,
  CreateInput,
  UpdateInput,
  TaxonomyNode,
  TaxonomyTree,
  DomainGroupNode,
  DomainNode,
  SubdomainNode,
} from "./types.js";
import {
  validateCreate,
  validateUpdate,
  ConflictError,
  NotFoundError,
  sameName,
  normalizeTechnicalOwner,
} from "./validation.js";

interface LevelConfig {
  table: string;
  parentColumn: string | null; // null for DomainGroup
  parentTable: string | null;
  childLevel: Level | null;
}

const CONFIG: Record<Level, LevelConfig> = {
  DomainGroup: { table: "domain_groups", parentColumn: null, parentTable: null, childLevel: "Domain" },
  Domain: { table: "domains", parentColumn: "domain_group_id", parentTable: "domain_groups", childLevel: "Subdomain" },
  Subdomain: { table: "subdomains", parentColumn: "domain_id", parentTable: "domains", childLevel: "DataProduct" },
  DataProduct: { table: "data_products", parentColumn: "subdomain_id", parentTable: "subdomains", childLevel: null },
};

interface Row {
  id: string;
  name: string;
  description: string;
  business_owner: string;
  technical_owner: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  domain_group_id?: string;
  domain_id?: string;
  subdomain_id?: string;
}

export class TaxonomyService {
  constructor(private db: DB) {}

  // ---- helpers ---------------------------------------------------------

  private mapRow(level: Level, row: Row): TaxonomyNode {
    const base = {
      id: row.id,
      name: row.name,
      description: row.description,
      businessOwner: row.business_owner,
      technicalOwner: row.technical_owner,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      level,
    };
    switch (level) {
      case "DomainGroup":
        return base as TaxonomyNode;
      case "Domain":
        return { ...base, domainGroupId: row.domain_group_id } as TaxonomyNode;
      case "Subdomain":
        return { ...base, domainId: row.domain_id } as TaxonomyNode;
      case "DataProduct":
        return { ...base, subdomainId: row.subdomain_id } as TaxonomyNode;
    }
  }

  private requireParent(level: Level, parentId: string | null): void {
    const cfg = CONFIG[level];
    if (!cfg.parentTable) return;
    if (!parentId) throw new NotFoundError(`${level} requires a parent`);
    const found = this.db.prepare(`SELECT id FROM ${cfg.parentTable} WHERE id = ?`).get(parentId);
    if (!found) throw new NotFoundError(`Parent ${cfg.parentTable} ${parentId} not found`);
  }

  private siblings(level: Level, parentId: string | null): Row[] {
    const cfg = CONFIG[level];
    if (!cfg.parentColumn) {
      return this.db.prepare(`SELECT * FROM ${cfg.table} ORDER BY sort_order, name`).all() as Row[];
    }
    return this.db
      .prepare(`SELECT * FROM ${cfg.table} WHERE ${cfg.parentColumn} = ? ORDER BY sort_order, name`)
      .all(parentId) as Row[];
  }

  private assertUniqueName(level: Level, parentId: string | null, name: string, exceptId?: string): void {
    const dupe = this.siblings(level, parentId).find(
      (s) => s.id !== exceptId && sameName(s.name, name),
    );
    if (dupe) {
      throw new ConflictError(`A ${level} named "${name.trim()}" already exists under this parent`);
    }
  }

  private nextSortOrder(level: Level, parentId: string | null): number {
    const rows = this.siblings(level, parentId);
    return rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0;
  }

  private getRow(level: Level, id: string): Row {
    const cfg = CONFIG[level];
    const row = this.db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`${level} ${id} not found`);
    return row;
  }

  private parentIdOf(level: Level, row: Row): string | null {
    const col = CONFIG[level].parentColumn;
    if (!col) return null;
    return (row as Record<string, unknown>)[col] as string;
  }

  // ---- CRUD ------------------------------------------------------------

  get(level: Level, id: string): TaxonomyNode {
    return this.mapRow(level, this.getRow(level, id));
  }

  list(level: Level, parentId: string | null): TaxonomyNode[] {
    return this.siblings(level, parentId).map((r) => this.mapRow(level, r));
  }

  create(level: Level, parentId: string | null, input: CreateInput): TaxonomyNode {
    const clean = validateCreate(level, input);
    this.requireParent(level, parentId);
    this.assertUniqueName(level, parentId, clean.name);

    const now = new Date().toISOString();
    const id = randomUUID();
    const cfg = CONFIG[level];
    const sortOrder = this.nextSortOrder(level, parentId);

    if (cfg.parentColumn) {
      this.db
        .prepare(
          `INSERT INTO ${cfg.table}
             (id, name, description, business_owner, technical_owner, ${cfg.parentColumn}, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, clean.name, clean.description, clean.businessOwner, clean.technicalOwner, parentId, sortOrder, now, now);
    } else {
      this.db
        .prepare(
          `INSERT INTO ${cfg.table}
             (id, name, description, business_owner, technical_owner, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, clean.name, clean.description, clean.businessOwner, clean.technicalOwner, sortOrder, now, now);
    }
    return this.get(level, id);
  }

  update(level: Level, id: string, patch: UpdateInput): TaxonomyNode {
    const existing = this.getRow(level, id);
    const merged: CreateInput = {
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      businessOwner: patch.businessOwner ?? existing.business_owner,
      technicalOwner:
        patch.technicalOwner !== undefined
          ? normalizeTechnicalOwner(patch.technicalOwner)
          : existing.technical_owner,
    };
    const clean = validateUpdate(level, merged);
    const parentId = this.parentIdOf(level, existing);
    this.assertUniqueName(level, parentId, clean.name, id);

    const now = new Date().toISOString();
    const cfg = CONFIG[level];
    this.db
      .prepare(
        `UPDATE ${cfg.table}
           SET name = ?, description = ?, business_owner = ?, technical_owner = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(clean.name, clean.description, clean.businessOwner, clean.technicalOwner, now, id);
    return this.get(level, id);
  }

  /** Inline rename helper — renames without touching other fields. */
  rename(level: Level, id: string, name: string): TaxonomyNode {
    return this.update(level, id, { name });
  }

  /**
   * Count descendants so the UI can warn the user before a cascading delete.
   */
  countDescendants(level: Level, id: string): number {
    this.getRow(level, id);
    switch (level) {
      case "DataProduct":
        return 0;
      case "Subdomain":
        return this.scalar(`SELECT COUNT(*) c FROM data_products WHERE subdomain_id = ?`, id);
      case "Domain": {
        const subs = this.scalar(`SELECT COUNT(*) c FROM subdomains WHERE domain_id = ?`, id);
        const prods = this.scalar(
          `SELECT COUNT(*) c FROM data_products
             WHERE subdomain_id IN (SELECT id FROM subdomains WHERE domain_id = ?)`,
          id,
        );
        return subs + prods;
      }
      case "DomainGroup": {
        const doms = this.scalar(`SELECT COUNT(*) c FROM domains WHERE domain_group_id = ?`, id);
        const subs = this.scalar(
          `SELECT COUNT(*) c FROM subdomains
             WHERE domain_id IN (SELECT id FROM domains WHERE domain_group_id = ?)`,
          id,
        );
        const prods = this.scalar(
          `SELECT COUNT(*) c FROM data_products WHERE subdomain_id IN (
             SELECT id FROM subdomains WHERE domain_id IN (
               SELECT id FROM domains WHERE domain_group_id = ?))`,
          id,
        );
        return doms + subs + prods;
      }
    }
  }

  private scalar(sql: string, ...params: unknown[]): number {
    const row = this.db.prepare(sql).get(...params) as { c: number };
    return row.c;
  }

  /** Delete an item; FK cascade removes children. Returns descendants removed. */
  remove(level: Level, id: string): { descendantsRemoved: number } {
    const descendantsRemoved = this.countDescendants(level, id);
    const cfg = CONFIG[level];
    this.db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
    return { descendantsRemoved };
  }

  // ---- Reorder & move --------------------------------------------------

  /** Persist a new sibling order. All ids must belong to the same parent. */
  reorder(level: Level, parentId: string | null, orderedIds: string[]): TaxonomyNode[] {
    const current = this.siblings(level, parentId);
    const currentIds = new Set(current.map((r) => r.id));
    if (orderedIds.length !== current.length || !orderedIds.every((id) => currentIds.has(id))) {
      throw new ConflictError("Reorder list must contain exactly the current siblings of this parent");
    }
    const cfg = CONFIG[level];
    const stmt = this.db.prepare(`UPDATE ${cfg.table} SET sort_order = ?, updated_at = ? WHERE id = ?`);
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      orderedIds.forEach((id, index) => stmt.run(index, now, id));
    });
    tx();
    return this.list(level, parentId);
  }

  /**
   * Move a node to a new parent (and optional position). Mandatory for
   * Subdomain (Domain -> Domain); also works for Domain and DataProduct.
   */
  move(level: Level, id: string, newParentId: string, newIndex?: number): TaxonomyNode {
    const cfg = CONFIG[level];
    if (!cfg.parentColumn) throw new ConflictError("DomainGroup has no parent and cannot be moved");

    const row = this.getRow(level, id);
    const oldParentId = this.parentIdOf(level, row);
    this.requireParent(level, newParentId);
    this.assertUniqueName(level, newParentId, row.name, id);

    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE ${cfg.table} SET ${cfg.parentColumn} = ?, updated_at = ? WHERE id = ?`)
        .run(newParentId, now, id);

      // Reindex destination siblings, inserting the moved node at newIndex.
      const dest = this.siblings(level, newParentId).filter((r) => r.id !== id);
      const insertAt = newIndex == null ? dest.length : Math.max(0, Math.min(newIndex, dest.length));
      const ordered = [...dest.slice(0, insertAt), row, ...dest.slice(insertAt)];
      const stmt = this.db.prepare(`UPDATE ${cfg.table} SET sort_order = ? WHERE id = ?`);
      ordered.forEach((r, i) => stmt.run(i, r.id));

      // Compact the source parent so its ordering has no gaps.
      if (oldParentId !== newParentId) {
        this.siblings(level, oldParentId).forEach((r, i) => stmt.run(i, r.id));
      }
    });
    tx();
    return this.get(level, id);
  }

  // ---- Tree ------------------------------------------------------------

  getTree(): TaxonomyTree {
    const groups = this.list("DomainGroup", null) as DomainGroupNode[];
    for (const g of groups) {
      const domains = this.list("Domain", g.id) as DomainNode[];
      for (const d of domains) {
        const subs = this.list("Subdomain", d.id) as SubdomainNode[];
        for (const s of subs) {
          s.children = this.list("DataProduct", s.id) as SubdomainNode["children"];
        }
        d.children = subs;
      }
      g.children = domains;
    }
    return groups;
  }
}
