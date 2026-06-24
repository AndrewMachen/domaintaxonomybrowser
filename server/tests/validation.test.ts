import { describe, it, expect, beforeEach } from "vitest";
import { makeServices } from "./helpers.js";
import { TaxonomyService } from "../src/taxonomyService.js";
import { ValidationError, ConflictError } from "../src/validation.js";

let service: TaxonomyService;
beforeEach(() => {
  service = makeServices().service;
});

function dg(name = "G") {
  return service.create("DomainGroup", null, { name, description: "d", businessOwner: "Jane" });
}

describe("required fields", () => {
  it("requires name at every level", () => {
    expect(() => service.create("DomainGroup", null, { name: "", description: "d", businessOwner: "x" })).toThrow(ValidationError);
  });

  it("requires description at every level", () => {
    expect(() => service.create("DomainGroup", null, { name: "n", description: "", businessOwner: "x" })).toThrow(ValidationError);
  });

  it("requires business owner at every level", () => {
    expect(() => service.create("DomainGroup", null, { name: "n", description: "d", businessOwner: "" })).toThrow(ValidationError);
  });

  it("rejects whitespace-only values", () => {
    expect(() => service.create("DomainGroup", null, { name: "   ", description: "d", businessOwner: "x" })).toThrow(ValidationError);
  });

  it("surfaces field-level error messages", () => {
    try {
      service.create("DomainGroup", null, { name: "", description: "", businessOwner: "" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const fields = (e as ValidationError).fields;
      expect(fields.name).toMatch(/required/i);
      expect(fields.description).toMatch(/required/i);
      expect(fields.businessOwner).toMatch(/required/i);
    }
  });
});

describe("technical owner rules", () => {
  it("does NOT require a technical owner for a Domain Group", () => {
    const g = service.create("DomainGroup", null, { name: "G", description: "d", businessOwner: "x" });
    expect(g.technicalOwner).toBeNull();
  });

  it("requires a technical owner for a Domain", () => {
    const g = dg();
    expect(() => service.create("Domain", g.id, { name: "D", description: "d", businessOwner: "x" })).toThrow(ValidationError);
  });

  it("requires a technical owner for a Subdomain", () => {
    const g = dg();
    const d = service.create("Domain", g.id, { name: "D", description: "d", businessOwner: "x", technicalOwner: "y" });
    expect(() => service.create("Subdomain", d.id, { name: "S", description: "d", businessOwner: "x" })).toThrow(ValidationError);
  });

  it("requires a technical owner for a Data Product", () => {
    const g = dg();
    const d = service.create("Domain", g.id, { name: "D", description: "d", businessOwner: "x", technicalOwner: "y" });
    const s = service.create("Subdomain", d.id, { name: "S", description: "d", businessOwner: "x", technicalOwner: "y" });
    expect(() => service.create("DataProduct", s.id, { name: "P", description: "d", businessOwner: "x" })).toThrow(ValidationError);
  });

  it("update cannot blank out a required technical owner", () => {
    const g = dg();
    const d = service.create("Domain", g.id, { name: "D", description: "d", businessOwner: "x", technicalOwner: "y" });
    expect(() => service.update("Domain", d.id, { technicalOwner: "" })).toThrow(ValidationError);
  });
});

describe("duplicate sibling names", () => {
  it("blocks duplicate names under the same parent (case-insensitive)", () => {
    dg("Customer");
    expect(() => dg("customer")).toThrow(ConflictError);
  });

  it("allows the same name under different parents", () => {
    const g1 = dg("G1");
    const g2 = dg("G2");
    const opts = { description: "d", businessOwner: "x", technicalOwner: "y" };
    service.create("Domain", g1.id, { name: "Shared", ...opts });
    expect(() => service.create("Domain", g2.id, { name: "Shared", ...opts })).not.toThrow();
  });

  it("blocks renaming into a duplicate but allows a no-op rename", () => {
    const a = dg("Alpha");
    dg("Beta");
    expect(() => service.rename("DomainGroup", a.id, "Beta")).toThrow(ConflictError);
    expect(() => service.rename("DomainGroup", a.id, "Alpha")).not.toThrow();
  });
});
