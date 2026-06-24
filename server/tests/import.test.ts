import { describe, it, expect, beforeEach } from "vitest";
import { makeServices, buildWorkbook, fullRow } from "./helpers.js";
import { TaxonomyService } from "../src/taxonomyService.js";
import { ExcelService, COLUMNS } from "../src/excelService.js";
import { ValidationError } from "../src/validation.js";

let service: TaxonomyService;
let excel: ExcelService;
beforeEach(() => {
  const s = makeServices();
  service = s.service;
  excel = s.excel;
});

describe("import structure validation", () => {
  it("rejects a file missing required columns", async () => {
    const buf = await buildWorkbook([], ["Wrong", "Header"]);
    await expect(excel.import(buf)).rejects.toBeInstanceOf(ValidationError);
  });

  it("skips entirely blank rows", async () => {
    const buf = await buildWorkbook([
      fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ]);
    const summary = await excel.import(buf);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toHaveLength(0);
  });
});

describe("import create / update", () => {
  it("creates new nodes and counts them", async () => {
    const buf = await buildWorkbook([
      fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
    ]);
    const summary = await excel.import(buf);
    expect(summary.created).toBe(4); // DG + Domain + Sub + Product
    expect(summary.updated).toBe(0);
    expect(service.getTree()[0].children[0].children[0].children[0].name).toBe("Profile");
  });

  it("dedupes repeated ancestors across rows (hierarchy-aware)", async () => {
    const buf = await buildWorkbook([
      fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
      fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Preferences", "d", "Jane", "Raj"]),
    ]);
    const summary = await excel.import(buf);
    // DG + Domain + Sub created once, plus two distinct products => 5 created
    expect(summary.created).toBe(5);
    const sub = service.getTree()[0].children[0].children[0];
    expect(sub.children.map((p) => p.name).sort()).toEqual(["Preferences", "Profile"]);
  });

  it("updates existing nodes when fields change", async () => {
    const first = await buildWorkbook([
      fullRow(["Customer", "old desc", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
    ]);
    await excel.import(first);

    const second = await buildWorkbook([
      fullRow(["Customer", "new desc", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
    ]);
    const summary = await excel.import(second);
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(1); // only the DG description changed
    expect(service.getTree()[0].description).toBe("new desc");
  });
});

describe("import row validation", () => {
  it("records an error and skips a row missing a required technical owner", async () => {
    const buf = await buildWorkbook([
      // Domain with blank technical owner -> invalid
      ["Customer", "d", "Jane", "", "Loyalty", "d", "Jane", "", "", "", "", "", "", "", "", ""],
      // a fully valid row
      fullRow(["Sales", "d", "Sam"], ["Pricing", "d", "Sam", "Lena"], ["Fares", "d", "Sam", "Lena"], ["Fare DP", "d", "Sam", "Lena"]),
    ]);
    const summary = await excel.import(buf);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].row).toBe(2);
    // the valid row still applied
    expect(service.list("DomainGroup", null).map((g) => g.name)).toContain("Sales");
  });

  it("treats a row atomically: an invalid child prevents its parent from being created", async () => {
    const buf = await buildWorkbook([
      // DG valid, but Domain missing technical owner -> whole row rejected
      ["GhostGroup", "d", "Jane", "", "BadDomain", "d", "Jane", "", "", "", "", "", "", "", "", ""],
    ]);
    const summary = await excel.import(buf);
    expect(summary.errors).toHaveLength(1);
    expect(service.list("DomainGroup", null).map((g) => g.name)).not.toContain("GhostGroup");
  });

  it("errors when a level appears without its ancestor", async () => {
    const buf = await buildWorkbook([
      // Subdomain present, Domain missing
      ["Customer", "d", "Jane", "", "", "", "", "", "Orphan", "d", "Jane", "Raj", "", "", "", ""],
    ]);
    const summary = await excel.import(buf);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].message).toMatch(/Domain/i);
  });
});

describe("import does not corrupt existing data", () => {
  it("leaves prior data intact when later rows have validation errors", async () => {
    // Seed existing data via a clean import
    await excel.import(
      await buildWorkbook([
        fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
      ]),
    );
    const before = service.getTree();

    // Import a batch where one row is invalid; valid rows still apply,
    // invalid rows are reported without throwing.
    const summary = await excel.import(
      await buildWorkbook([
        ["BadGroup", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""], // missing desc+owner
        fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Rewards", "d", "Jane", "Raj"], ["Ledger", "d", "Jane", "Raj"]),
      ]),
    );

    expect(summary.errors.length).toBe(1);
    // Original Customer/Loyalty/Membership/Profile still present
    const customer = service.getTree().find((g) => g.name === "Customer")!;
    expect(customer).toBeTruthy();
    expect(customer.children[0].children.map((s) => s.name).sort()).toEqual(["Membership", "Rewards"]);
    expect(before[0].name).toBe("Customer");
  });
});
