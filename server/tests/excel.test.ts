import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { makeServices } from "./helpers.js";
import { TaxonomyService } from "../src/taxonomyService.js";
import { ExcelService, COLUMNS } from "../src/excelService.js";
import { seed } from "../src/seed.js";

let service: TaxonomyService;
let excel: ExcelService;

beforeEach(() => {
  const s = makeServices();
  service = s.service;
  excel = s.excel;
});

async function readSheet(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet("Taxonomy")!;
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => vals.push(cell.text ?? ""));
    rows.push(vals);
  });
  return { ws, rows };
}

describe("Excel export", () => {
  it("produces a workbook with the exact header columns", async () => {
    seed(service);
    const buf = await excel.export();
    expect(buf.length).toBeGreaterThan(0);
    const { rows } = await readSheet(buf);
    expect(rows[0]).toEqual([...COLUMNS]);
  });

  it("includes a row for each data product with full ancestry", async () => {
    seed(service);
    const { rows } = await readSheet(await excel.export());
    const body = rows.slice(1);
    const profile = body.find((r) => r[12] === "Member Profile");
    expect(profile).toBeTruthy();
    expect(profile![0]).toBe("Customer"); // DG name
    expect(profile![4]).toBe("Loyalty"); // Domain name
    expect(profile![8]).toBe("Membership"); // Subdomain name
  });

  it("preserves empty branches (group with no domains)", async () => {
    service.create("DomainGroup", null, { name: "Lonely", description: "d", businessOwner: "x" });
    const { rows } = await readSheet(await excel.export());
    const lonely = rows.slice(1).find((r) => r[0] === "Lonely");
    expect(lonely).toBeTruthy();
    expect(lonely![4]).toBe(""); // no domain
  });

  it("round-trips through export then import into a fresh store", async () => {
    seed(service);
    const buf = await excel.export();

    const fresh = makeServices();
    const summary = await fresh.excel.import(buf);
    expect(summary.errors).toHaveLength(0);

    const treeA = service.getTree();
    const treeB = fresh.service.getTree();
    const flatten = (t: ReturnType<TaxonomyService["getTree"]>) =>
      t.map((g) => `${g.name}:${g.children.map((d) => d.name).sort().join(",")}`).sort();
    expect(flatten(treeB)).toEqual(flatten(treeA));
    expect(treeB.length).toBe(treeA.length);
  });

  it("generates a usable template with the header", async () => {
    const { rows } = await readSheet(await excel.template());
    expect(rows[0]).toEqual([...COLUMNS]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
