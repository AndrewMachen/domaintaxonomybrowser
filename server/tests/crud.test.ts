import { describe, it, expect, beforeEach } from "vitest";
import { makeServices } from "./helpers.js";
import { TaxonomyService } from "../src/taxonomyService.js";
import { NotFoundError } from "../src/validation.js";

let service: TaxonomyService;

beforeEach(() => {
  service = makeServices().service;
});

function seedChain() {
  const dg = service.create("DomainGroup", null, { name: "Customer", description: "d", businessOwner: "Jane" });
  const dom = service.create("Domain", dg.id, { name: "Loyalty", description: "d", businessOwner: "Jane", technicalOwner: "Raj" });
  const sub = service.create("Subdomain", dom.id, { name: "Membership", description: "d", businessOwner: "Jane", technicalOwner: "Raj" });
  const dp = service.create("DataProduct", sub.id, { name: "Profile", description: "d", businessOwner: "Jane", technicalOwner: "Raj" });
  return { dg, dom, sub, dp };
}

describe("CRUD: create", () => {
  it("creates a Domain Group with no technical owner", () => {
    const dg = service.create("DomainGroup", null, { name: "Customer", description: "d", businessOwner: "Jane" });
    expect(dg.id).toBeTruthy();
    expect(dg.level).toBe("DomainGroup");
    expect(dg.technicalOwner).toBeNull();
    expect(dg.sortOrder).toBe(0);
    expect(dg.createdAt).toBeTruthy();
  });

  it("creates the full hierarchy and assigns parent ids", () => {
    const { dg, dom, sub, dp } = seedChain();
    expect((dom as any).domainGroupId).toBe(dg.id);
    expect((sub as any).domainId).toBe(dom.id);
    expect((dp as any).subdomainId).toBe(sub.id);
  });

  it("assigns incrementing sort order to siblings", () => {
    const dg = service.create("DomainGroup", null, { name: "A", description: "d", businessOwner: "x" });
    const dg2 = service.create("DomainGroup", null, { name: "B", description: "d", businessOwner: "x" });
    expect(dg.sortOrder).toBe(0);
    expect(dg2.sortOrder).toBe(1);
  });

  it("rejects a child with a non-existent parent", () => {
    expect(() =>
      service.create("Domain", "missing", { name: "X", description: "d", businessOwner: "x", technicalOwner: "y" }),
    ).toThrow(NotFoundError);
  });
});

describe("CRUD: read", () => {
  it("gets an item and lists siblings in order", () => {
    const { dg, dom } = seedChain();
    expect(service.get("DomainGroup", dg.id).name).toBe("Customer");
    const domains = service.list("Domain", dg.id);
    expect(domains).toHaveLength(1);
    expect(domains[0].id).toBe(dom.id);
  });

  it("throws NotFound for a missing id", () => {
    expect(() => service.get("DomainGroup", "nope")).toThrow(NotFoundError);
  });
});

describe("CRUD: update & rename", () => {
  it("updates fields and refreshes updatedAt", async () => {
    const { dg } = seedChain();
    await new Promise((r) => setTimeout(r, 5));
    const updated = service.update("DomainGroup", dg.id, { description: "new desc", businessOwner: "Sam" });
    expect(updated.description).toBe("new desc");
    expect(updated.businessOwner).toBe("Sam");
    expect(updated.updatedAt >= dg.updatedAt).toBe(true);
  });

  it("renames inline without affecting other fields", () => {
    const { sub } = seedChain();
    const renamed = service.rename("Subdomain", sub.id, "Member Mgmt");
    expect(renamed.name).toBe("Member Mgmt");
    expect(renamed.description).toBe(sub.description);
    expect(renamed.technicalOwner).toBe(sub.technicalOwner);
  });

  it("can set a Domain Group technical owner and clear it", () => {
    const { dg } = seedChain();
    const withTech = service.update("DomainGroup", dg.id, { technicalOwner: "Lena" });
    expect(withTech.technicalOwner).toBe("Lena");
    const cleared = service.update("DomainGroup", dg.id, { technicalOwner: "" });
    expect(cleared.technicalOwner).toBeNull();
  });
});

describe("CRUD: delete & cascade", () => {
  it("counts descendants before deletion", () => {
    const { dg } = seedChain();
    // 1 domain + 1 subdomain + 1 data product = 3
    expect(service.countDescendants("DomainGroup", dg.id)).toBe(3);
  });

  it("cascades deletion of all descendants", () => {
    const { dg, dom, sub, dp } = seedChain();
    const result = service.remove("DomainGroup", dg.id);
    expect(result.descendantsRemoved).toBe(3);
    expect(() => service.get("DomainGroup", dg.id)).toThrow(NotFoundError);
    expect(() => service.get("Domain", dom.id)).toThrow(NotFoundError);
    expect(() => service.get("Subdomain", sub.id)).toThrow(NotFoundError);
    expect(() => service.get("DataProduct", dp.id)).toThrow(NotFoundError);
  });

  it("deletes a leaf with zero descendants", () => {
    const { dp } = seedChain();
    expect(service.remove("DataProduct", dp.id).descendantsRemoved).toBe(0);
  });
});

describe("Tree", () => {
  it("builds a nested tree", () => {
    seedChain();
    const tree = service.getTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].children[0].name).toBe("Profile");
  });
});
