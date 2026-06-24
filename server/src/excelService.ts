import ExcelJS from "exceljs";
import type { DB } from "./db.js";
import { TaxonomyService } from "./taxonomyService.js";
import { Level, ImportSummary, ImportError, CreateInput } from "./types.js";
import { validateCreate, ValidationError, sameName, normalizeTechnicalOwner } from "./validation.js";

const SHEET = "Taxonomy";

// Column order. "Domain Group Technical Owner" is optional (DG tech owner is
// not required) but included so optional values round-trip cleanly.
export const COLUMNS = [
  "Domain Group Name",
  "Domain Group Description",
  "Domain Group Business Owner",
  "Domain Group Technical Owner",
  "Domain Name",
  "Domain Description",
  "Domain Business Owner",
  "Domain Technical Owner",
  "Subdomain Name",
  "Subdomain Description",
  "Subdomain Business Owner",
  "Subdomain Technical Owner",
  "Data Product Name",
  "Data Product Description",
  "Data Product Business Owner",
  "Data Product Technical Owner",
] as const;

// Columns that MUST be present in an imported file (DG Technical Owner excluded).
const REQUIRED_COLUMNS = COLUMNS.filter((c) => c !== "Domain Group Technical Owner");

interface RowValues {
  dg: CreateInput | null;
  domain: CreateInput | null;
  sub: CreateInput | null;
  product: CreateInput | null;
}

export class ExcelService {
  constructor(
    private db: DB,
    private service: TaxonomyService,
  ) {}

  // ---- Export ----------------------------------------------------------

  async export(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Data Mesh Taxonomy";
    wb.created = new Date();
    const ws = wb.addWorksheet(SHEET);
    ws.addRow([...COLUMNS]);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    COLUMNS.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.max(18, c.length + 2);
    });

    const tree = this.service.getTree();
    for (const g of tree) {
      const gCells = [g.name, g.description, g.businessOwner, g.technicalOwner ?? ""];
      if (g.children.length === 0) {
        ws.addRow([...gCells, "", "", "", "", "", "", "", "", "", "", "", ""]);
        continue;
      }
      for (const d of g.children) {
        const dCells = [d.name, d.description, d.businessOwner, d.technicalOwner ?? ""];
        if (d.children.length === 0) {
          ws.addRow([...gCells, ...dCells, "", "", "", "", "", "", "", ""]);
          continue;
        }
        for (const s of d.children) {
          const sCells = [s.name, s.description, s.businessOwner, s.technicalOwner ?? ""];
          if (s.children.length === 0) {
            ws.addRow([...gCells, ...dCells, ...sCells, "", "", "", ""]);
            continue;
          }
          for (const p of s.children) {
            ws.addRow([...gCells, ...dCells, ...sCells, p.name, p.description, p.businessOwner, p.technicalOwner ?? ""]);
          }
        }
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  /** Build the blank import template (header + one example row). */
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET);
    ws.addRow([...COLUMNS]);
    ws.getRow(1).font = { bold: true };
    ws.addRow([
      "Customer", "Customer-facing data assets", "Jane Doe", "",
      "Loyalty", "Loyalty program data", "Jane Doe", "Raj Patel",
      "Membership", "Member profiles and tiers", "Jane Doe", "Raj Patel",
      "Member Profile", "Curated member profile product", "Jane Doe", "Raj Patel",
    ]);
    COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(18, c.length + 2)));
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ---- Import ----------------------------------------------------------

  async import(buffer: Buffer): Promise<ImportSummary> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
    if (!ws) throw new ValidationError({ file: "Workbook contains no worksheets" });

    // Map header names -> column index (1-based).
    const headerRow = ws.getRow(1);
    const headerIndex: Record<string, number> = {};
    headerRow.eachCell((cell, col) => {
      headerIndex[cellText(cell.value).toLowerCase()] = col;
    });
    const missing = REQUIRED_COLUMNS.filter((c) => !(c.toLowerCase() in headerIndex));
    if (missing.length) {
      throw new ValidationError({ file: `Missing required column(s): ${missing.join(", ")}` });
    }

    const get = (row: ExcelJS.Row, name: string): string => {
      const col = headerIndex[name.toLowerCase()];
      return col ? cellText(row.getCell(col).value) : "";
    };

    const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };

    // Caches: parent id keyed by hierarchy path, to dedupe across rows.
    const groupId = new Map<string, string>();
    const domainId = new Map<string, string>();
    const subId = new Map<string, string>();

    // Everything runs in one transaction: an unexpected throw rolls the whole
    // import back so existing data is never partially corrupted. Expected,
    // per-row validation problems are recorded and skipped without aborting.
    const run = this.db.transaction(() => {
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // header
        const parsed = parseRow(row, get);

        // Entirely blank row -> skip silently.
        if (!parsed.dg && !parsed.domain && !parsed.sub && !parsed.product) {
          summary.skipped++;
          return;
        }

        try {
          validateRowShape(parsed, rowNumber);

          // Validate each present level up front so the row is all-or-nothing.
          if (parsed.dg) validateCreate("DomainGroup", parsed.dg);
          if (parsed.domain) validateCreate("Domain", parsed.domain);
          if (parsed.sub) validateCreate("Subdomain", parsed.sub);
          if (parsed.product) validateCreate("DataProduct", parsed.product);

          // Apply top-down, upserting by hierarchy-aware name key.
          const gKey = parsed.dg!.name.trim().toLowerCase();
          const gid = this.upsert("DomainGroup", null, parsed.dg!, groupId, gKey, summary);

          if (!parsed.domain) return;
          const dKey = `${gid}::${parsed.domain.name.trim().toLowerCase()}`;
          const did = this.upsert("Domain", gid, parsed.domain, domainId, dKey, summary);

          if (!parsed.sub) return;
          const sKey = `${did}::${parsed.sub.name.trim().toLowerCase()}`;
          const sid = this.upsert("Subdomain", did, parsed.sub, subId, sKey, summary);

          if (!parsed.product) return;
          this.upsert("DataProduct", sid, parsed.product, new Map(), "", summary);
        } catch (err) {
          if (err instanceof ValidationError) {
            const msg = Object.entries(err.fields)
              .map(([k, v]) => (k === "_" || k === "file" ? v : `${v}`))
              .join("; ");
            summary.errors.push({ row: rowNumber, message: msg });
          } else if (err instanceof RowError) {
            summary.errors.push({ row: rowNumber, message: err.message });
          } else {
            throw err; // unexpected -> abort & rollback everything
          }
        }
      });
    });

    run();
    return summary;
  }

  /** Find-or-create/update a node by name under a parent. Updates counters. */
  private upsert(
    level: Level,
    parentId: string | null,
    input: CreateInput,
    cache: Map<string, string>,
    cacheKey: string,
    summary: ImportSummary,
  ): string {
    const tech = normalizeTechnicalOwner(input.technicalOwner);
    const existing = this.service.list(level, parentId).find((n) => sameName(n.name, input.name));

    if (existing) {
      const changed =
        existing.description !== input.description.trim() ||
        existing.businessOwner !== input.businessOwner.trim() ||
        (existing.technicalOwner ?? null) !== tech ||
        existing.name !== input.name.trim();
      if (changed) {
        this.service.update(level, existing.id, {
          name: input.name,
          description: input.description,
          businessOwner: input.businessOwner,
          technicalOwner: tech,
        });
        summary.updated++;
      }
      if (cacheKey) cache.set(cacheKey, existing.id);
      return existing.id;
    }

    const created = this.service.create(level, parentId, { ...input, technicalOwner: tech });
    summary.created++;
    if (cacheKey) cache.set(cacheKey, created.id);
    return created.id;
  }
}

class RowError extends Error {}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const anyVal = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(anyVal.richText)) return anyVal.richText.map((r) => r.text).join("").trim();
    if (typeof anyVal.text === "string") return anyVal.text.trim();
    if (anyVal.result != null) return String(anyVal.result).trim();
    return "";
  }
  return String(value).trim();
}

function parseRow(row: ExcelJS.Row, get: (r: ExcelJS.Row, name: string) => string): RowValues {
  const node = (n: string, d: string, b: string, t: string): CreateInput | null => {
    const name = get(row, n);
    const description = get(row, d);
    const businessOwner = get(row, b);
    const technicalOwner = get(row, t);
    if (!name && !description && !businessOwner && !technicalOwner) return null;
    return { name, description, businessOwner, technicalOwner };
  };
  return {
    dg: node("Domain Group Name", "Domain Group Description", "Domain Group Business Owner", "Domain Group Technical Owner"),
    domain: node("Domain Name", "Domain Description", "Domain Business Owner", "Domain Technical Owner"),
    sub: node("Subdomain Name", "Subdomain Description", "Subdomain Business Owner", "Subdomain Technical Owner"),
    product: node("Data Product Name", "Data Product Description", "Data Product Business Owner", "Data Product Technical Owner"),
  };
}

/** Ensure no level is present without its ancestors. */
function validateRowShape(p: RowValues, _row: number): void {
  if (p.product && !p.sub) throw new RowError("Data Product present but Subdomain is missing");
  if (p.sub && !p.domain) throw new RowError("Subdomain present but Domain is missing");
  if (p.domain && !p.dg) throw new RowError("Domain present but Domain Group is missing");
}
