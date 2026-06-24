import express, { Express } from "express";
import cors from "cors";
import type { DB } from "./db.js";
import { TaxonomyService } from "./taxonomyService.js";
import { ExcelService } from "./excelService.js";
import { buildRouter, errorHandler } from "./routes.js";

export function createApp(db: DB): Express {
  const service = new TaxonomyService(db);
  const excel = new ExcelService(db, service);

  const app = express();
  app.use(cors());
  // JSON for normal endpoints; raw bytes for the binary import upload.
  app.use("/api/import", express.raw({ type: "*/*", limit: "25mb" }));
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", buildRouter(service, excel));
  app.use(errorHandler);
  return app;
}
