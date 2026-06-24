import ExcelJS from "exceljs";
import { createDb } from "../src/db.js";
import { TaxonomyService } from "../src/taxonomyService.js";
import { ExcelService } from "../src/excelService.js";
import { COLUMNS } from "../src/excelService.js";

export function makeServices() {
  const db = createDb(":memory:");
  const service = new TaxonomyService(db);
  const excel = new ExcelService(db, service);
  return { db, service, excel };
}

/** Build an .xlsx buffer with the standard header and the given data rows. */
export async function buildWorkbook(rows: string[][], header: string[] = [...COLUMNS]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Taxonomy");
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Convenience: a full DG->Domain->Sub->Product row. */
export function fullRow(
  dg: [string, string, string, string?],
  domain: [string, string, string, string],
  sub: [string, string, string, string],
  product: [string, string, string, string],
): string[] {
  return [
    dg[0], dg[1], dg[2], dg[3] ?? "",
    ...domain,
    ...sub,
    ...product,
  ];
}
