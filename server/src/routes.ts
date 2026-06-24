import { Router, Request, Response, NextFunction } from "express";
import { TaxonomyService } from "./taxonomyService.js";
import { ExcelService } from "./excelService.js";
import { Level } from "./types.js";
import { ValidationError, ConflictError, NotFoundError } from "./validation.js";

interface RouteCfg {
  level: Level;
  parentField: string | null;
}

const LEVEL_ROUTES: Record<string, RouteCfg> = {
  "domain-groups": { level: "DomainGroup", parentField: null },
  domains: { level: "Domain", parentField: "domainGroupId" },
  subdomains: { level: "Subdomain", parentField: "domainId" },
  "data-products": { level: "DataProduct", parentField: "subdomainId" },
};

export function buildRouter(service: TaxonomyService, excel: ExcelService): Router {
  const r = Router();

  r.get("/tree", (_req, res) => res.json(service.getTree()));

  r.get("/export", async (_req, res, next) => {
    try {
      const buf = await excel.export();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="taxonomy.xlsx"');
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });

  r.get("/template", async (_req, res, next) => {
    try {
      const buf = await excel.template();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="taxonomy-template.xlsx"');
      res.send(buf);
    } catch (e) {
      next(e);
    }
  });

  r.post("/import", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body;
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
      if (!buf.length) throw new ValidationError({ file: "No file uploaded" });
      const summary = await excel.import(buf);
      res.json(summary);
    } catch (e) {
      next(e);
    }
  });

  for (const [segment, cfg] of Object.entries(LEVEL_ROUTES)) {
    const base = `/${segment}`;

    r.get(base, (req, res) => {
      const parentId = cfg.parentField ? (req.query.parentId as string) ?? null : null;
      res.json(service.list(cfg.level, parentId));
    });

    r.get(`${base}/:id`, (req, res, next) => {
      try {
        res.json(service.get(cfg.level, req.params.id));
      } catch (e) {
        next(e);
      }
    });

    r.post(base, (req, res, next) => {
      try {
        const parentId = cfg.parentField ? (req.body[cfg.parentField] ?? null) : null;
        const node = service.create(cfg.level, parentId, req.body);
        res.status(201).json(node);
      } catch (e) {
        next(e);
      }
    });

    r.patch(`${base}/:id`, (req, res, next) => {
      try {
        res.json(service.update(cfg.level, req.params.id, req.body));
      } catch (e) {
        next(e);
      }
    });

    r.delete(`${base}/:id`, (req, res, next) => {
      try {
        res.json(service.remove(cfg.level, req.params.id));
      } catch (e) {
        next(e);
      }
    });

    r.post(`${base}/reorder`, (req, res, next) => {
      try {
        const parentId = cfg.parentField ? (req.body.parentId ?? null) : null;
        res.json(service.reorder(cfg.level, parentId, req.body.orderedIds));
      } catch (e) {
        next(e);
      }
    });

    if (cfg.parentField) {
      r.post(`${base}/:id/move`, (req, res, next) => {
        try {
          res.json(service.move(cfg.level, req.params.id, req.body.newParentId, req.body.newIndex));
        } catch (e) {
          next(e);
        }
      });
    }
  }

  return r;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, fields: err.fields });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
