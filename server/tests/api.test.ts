import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { buildWorkbook, fullRow } from "./helpers.js";

let app: Express;
beforeEach(() => {
  app = createApp(createDb(":memory:"));
});

async function createGroup(name = "Customer") {
  const res = await request(app)
    .post("/api/domain-groups")
    .send({ name, description: "d", businessOwner: "Jane" });
  return res.body;
}

describe("API CRUD", () => {
  it("creates a domain group (201)", async () => {
    const res = await request(app)
      .post("/api/domain-groups")
      .send({ name: "Customer", description: "d", businessOwner: "Jane" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("returns 400 with field errors on invalid create", async () => {
    const res = await request(app).post("/api/domain-groups").send({ name: "", description: "", businessOwner: "" });
    expect(res.status).toBe(400);
    expect(res.body.fields.name).toMatch(/required/i);
  });

  it("returns 400 when a Domain has no technical owner", async () => {
    const g = await createGroup();
    const res = await request(app).post("/api/domains").send({ domainGroupId: g.id, name: "D", description: "d", businessOwner: "x" });
    expect(res.status).toBe(400);
    expect(res.body.fields.technicalOwner).toMatch(/required/i);
  });

  it("builds the nested tree", async () => {
    const g = await createGroup();
    await request(app).post("/api/domains").send({ domainGroupId: g.id, name: "Loyalty", description: "d", businessOwner: "x", technicalOwner: "y" });
    const res = await request(app).get("/api/tree");
    expect(res.status).toBe(200);
    expect(res.body[0].children[0].name).toBe("Loyalty");
  });

  it("renames via PATCH", async () => {
    const g = await createGroup();
    const res = await request(app).patch(`/api/domain-groups/${g.id}`).send({ name: "Renamed" });
    expect(res.body.name).toBe("Renamed");
  });

  it("returns 409 on a duplicate sibling name", async () => {
    await createGroup("Dup");
    const res = await request(app).post("/api/domain-groups").send({ name: "Dup", description: "d", businessOwner: "x" });
    expect(res.status).toBe(409);
  });

  it("deletes and reports descendants removed", async () => {
    const g = await createGroup();
    await request(app).post("/api/domains").send({ domainGroupId: g.id, name: "D", description: "d", businessOwner: "x", technicalOwner: "y" });
    const res = await request(app).delete(`/api/domain-groups/${g.id}`);
    expect(res.status).toBe(200);
    expect(res.body.descendantsRemoved).toBe(1);
  });
});

describe("API reorder & move", () => {
  it("reorders subdomains", async () => {
    const g = await createGroup();
    const d = (await request(app).post("/api/domains").send({ domainGroupId: g.id, name: "D", description: "d", businessOwner: "x", technicalOwner: "y" })).body;
    const s1 = (await request(app).post("/api/subdomains").send({ domainId: d.id, name: "S1", description: "d", businessOwner: "x", technicalOwner: "y" })).body;
    const s2 = (await request(app).post("/api/subdomains").send({ domainId: d.id, name: "S2", description: "d", businessOwner: "x", technicalOwner: "y" })).body;
    const res = await request(app).post("/api/subdomains/reorder").send({ parentId: d.id, orderedIds: [s2.id, s1.id] });
    expect(res.body.map((r: any) => r.id)).toEqual([s2.id, s1.id]);
  });

  it("moves a subdomain to a different domain", async () => {
    const g = await createGroup();
    const dA = (await request(app).post("/api/domains").send({ domainGroupId: g.id, name: "A", description: "d", businessOwner: "x", technicalOwner: "y" })).body;
    const dB = (await request(app).post("/api/domains").send({ domainGroupId: g.id, name: "B", description: "d", businessOwner: "x", technicalOwner: "y" })).body;
    const s = (await request(app).post("/api/subdomains").send({ domainId: dA.id, name: "S", description: "d", businessOwner: "x", technicalOwner: "y" })).body;
    const res = await request(app).post(`/api/subdomains/${s.id}/move`).send({ newParentId: dB.id });
    expect(res.status).toBe(200);
    expect(res.body.domainId).toBe(dB.id);
  });
});

describe("API export & import", () => {
  it("exports an .xlsx download", async () => {
    await createGroup();
    const res = await request(app)
      .get("/api/export")
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("imports an uploaded workbook and returns a summary", async () => {
    const buf = await buildWorkbook([
      fullRow(["Customer", "d", "Jane"], ["Loyalty", "d", "Jane", "Raj"], ["Membership", "d", "Jane", "Raj"], ["Profile", "d", "Jane", "Raj"]),
    ]);
    const res = await request(app)
      .post("/api/import")
      .set("Content-Type", "application/octet-stream")
      .send(buf);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(4);
    expect(res.body.errors).toHaveLength(0);
  });
});
