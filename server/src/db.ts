// SQLite layer backed by Node's built-in node:sqlite (no native build needed).
// A thin adapter preserves the small subset of the better-sqlite3 API the
// rest of the codebase relies on: prepare().get/all/run, exec, and a nestable
// transaction() helper.

import { createRequire } from "node:module";

// Vite/Vitest don't yet recognise the experimental `node:sqlite` builtin, so
// load it at runtime via require rather than a static import.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: any };

export interface Stmt {
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface DB {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS domain_groups (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  business_owner  TEXT NOT NULL,
  technical_owner TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domains (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  business_owner  TEXT NOT NULL,
  technical_owner TEXT NOT NULL,
  domain_group_id TEXT NOT NULL REFERENCES domain_groups(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subdomains (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  business_owner  TEXT NOT NULL,
  technical_owner TEXT NOT NULL,
  domain_id       TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  business_owner  TEXT NOT NULL,
  technical_owner TEXT NOT NULL,
  subdomain_id    TEXT NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domains_group  ON domains(domain_group_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_dom ON subdomains(domain_id);
CREATE INDEX IF NOT EXISTS idx_products_sub   ON data_products(subdomain_id);
`;

class SqliteDb implements DB {
  private depth = 0;
  constructor(private raw: any) {}

  prepare(sql: string): Stmt {
    return this.raw.prepare(sql) as Stmt;
  }
  exec(sql: string): void {
    this.raw.exec(sql);
  }
  close(): void {
    this.raw.close();
  }

  // Nestable transaction: top level uses BEGIN/COMMIT, nested calls use
  // SAVEPOINTs so composing transactional operations is safe.
  transaction<T extends (...args: any[]) => any>(fn: T): T {
    const self = this;
    const wrapped = function (this: unknown, ...args: any[]) {
      const nested = self.depth > 0;
      const name = `sp_${self.depth}`;
      self.depth++;
      self.raw.exec(nested ? `SAVEPOINT ${name}` : "BEGIN");
      try {
        const result = fn.apply(this, args);
        self.raw.exec(nested ? `RELEASE ${name}` : "COMMIT");
        self.depth--;
        return result;
      } catch (err) {
        self.raw.exec(nested ? `ROLLBACK TO ${name}` : "ROLLBACK");
        self.depth--;
        throw err;
      }
    };
    return wrapped as T;
  }
}

export function createDb(file = "taxonomy.db"): DB {
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);
  return new SqliteDb(raw);
}

export function resetDb(db: DB): void {
  db.exec(`
    DELETE FROM data_products;
    DELETE FROM subdomains;
    DELETE FROM domains;
    DELETE FROM domain_groups;
  `);
}
