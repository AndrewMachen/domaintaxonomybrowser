import { writeFileSync } from "node:fs";
import { createDb } from "./db.js";
import { TaxonomyService } from "./taxonomyService.js";
import { ExcelService } from "./excelService.js";

// Generates taxonomy-template.xlsx in the current directory.
const db = createDb(":memory:");
const excel = new ExcelService(db, new TaxonomyService(db));
const out = process.argv[2] ?? "taxonomy-template.xlsx";
const buf = await excel.template();
writeFileSync(out, buf);
console.log(`Wrote ${out}`);
