import { describe, it, expect, beforeEach } from "vitest";
import { makeServices } from "./helpers.js";
import { TaxonomyService } from "../src/taxonomyService.js";
import { ConflictError } from "../src/validation.js";

let service: TaxonomyService;
beforeEach(() => {
  service = makeServices().service;
});

const O = { description: "d", businessOwner: "x", technicalOwner: "y" };

function scaffold() {
  const g = service.create("DomainGroup", null, { name: "G", description: "d", businessOwner: "x" });
  const domA = service.create("Domain", g.id, { name: "A", ...O });
  const domB = service.create("Domain", g.id, { name: "B", ...O });
  const s1 = service.create("Subdomain", domA.id, { name: "S1", ...O });
  const s2 = service.create("Subdomain", domA.id, { name: "S2", ...O });
  const s3 = service.create("Subdomain", domA.id, { name: "S3", ...O });
  return { g, domA, domB, s1, s2, s3 };
}

describe("reorder", () => {
  it("persists a new sibling order", () => {
    const { domA, s1, s2, s3 } = scaffold();
    const result = service.reorder("Subdomain", domA.id, [s3.id, s1.id, s2.id]);
    expect(result.map((r) => r.id)).toEqual([s3.id, s1.id, s2.id]);
    expect(result.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
    // re-list to confirm persistence
    expect(service.list("Subdomain", domA.id).map((r) => r.id)).toEqual([s3.id, s1.id, s2.id]);
  });

  it("rejects an order list that does not match the siblings", () => {
    const { domA, s1, s2 } = scaffold();
    expect(() => service.reorder("Subdomain", domA.id, [s1.id, s2.id])).toThrow(ConflictError);
    expect(() => service.reorder("Subdomain", domA.id, [s1.id, s2.id, "bogus"])).toThrow(ConflictError);
  });

  it("reorders domain groups too", () => {
    const a = service.create("DomainGroup", null, { name: "GA", description: "d", businessOwner: "x" });
    const b = service.create("DomainGroup", null, { name: "GB", description: "d", businessOwner: "x" });
    const out = service.reorder("DomainGroup", null, [b.id, a.id]);
    expect(out.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe("move subdomain (mandatory)", () => {
  it("moves a subdomain to another domain and updates its parent", () => {
    const { domA, domB, s1 } = scaffold();
    const moved = service.move("Subdomain", s1.id, domB.id);
    expect((moved as any).domainId).toBe(domB.id);
    expect(service.list("Subdomain", domB.id).map((s) => s.id)).toContain(s1.id);
    expect(service.list("Subdomain", domA.id).map((s) => s.id)).not.toContain(s1.id);
  });

  it("re-indexes the destination and honors target position", () => {
    const { domA, domB, s1 } = scaffold();
    service.create("Subdomain", domB.id, { name: "X", ...O });
    service.move("Subdomain", s1.id, domB.id, 0);
    const dest = service.list("Subdomain", domB.id);
    expect(dest[0].id).toBe(s1.id);
    expect(dest.map((s) => s.sortOrder)).toEqual([0, 1]);
  });

  it("re-indexes the source after a move", () => {
    const { domA, domB, s1 } = scaffold();
    service.move("Subdomain", s1.id, domB.id);
    const src = service.list("Subdomain", domA.id);
    expect(src.map((s) => s.sortOrder)).toEqual([0, 1]);
  });

  it("blocks a move that would create a duplicate name in the target", () => {
    const { domA, domB, s1 } = scaffold();
    service.create("Subdomain", domB.id, { name: "S1", ...O });
    expect(() => service.move("Subdomain", s1.id, domB.id)).toThrow(ConflictError);
  });
});

describe("move other levels", () => {
  it("moves a domain to another group", () => {
    const g1 = service.create("DomainGroup", null, { name: "G1", description: "d", businessOwner: "x" });
    const g2 = service.create("DomainGroup", null, { name: "G2", description: "d", businessOwner: "x" });
    const d = service.create("Domain", g1.id, { name: "D", ...O });
    const moved = service.move("Domain", d.id, g2.id);
    expect((moved as any).domainGroupId).toBe(g2.id);
  });

  it("moves a data product to another subdomain", () => {
    const { domA, s1, s2 } = scaffold();
    const p = service.create("DataProduct", s1.id, { name: "P", ...O });
    const moved = service.move("DataProduct", p.id, s2.id);
    expect((moved as any).subdomainId).toBe(s2.id);
  });

  it("refuses to move a Domain Group", () => {
    const g = service.create("DomainGroup", null, { name: "G", description: "d", businessOwner: "x" });
    expect(() => service.move("DomainGroup", g.id, "anything")).toThrow(ConflictError);
  });
});
