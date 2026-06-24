import { createDb, resetDb } from "./db.js";
import { TaxonomyService } from "./taxonomyService.js";

/** Idempotent seed: only seeds when the taxonomy is empty. */
export function seedIfEmpty(service: TaxonomyService): boolean {
  if (service.list("DomainGroup", null).length > 0) return false;
  seed(service);
  return true;
}

export function seed(service: TaxonomyService): void {
  const customer = service.create("DomainGroup", null, {
    name: "Customer",
    description: "Customer-facing data assets across loyalty and profiles",
    businessOwner: "Jane Doe",
  });
  const commercial = service.create("DomainGroup", null, {
    name: "Commercial",
    description: "Revenue, pricing and sales data assets",
    businessOwner: "Sam Reed",
    technicalOwner: "Lena Fox",
  });

  const loyalty = service.create("Domain", customer.id, {
    name: "Loyalty",
    description: "Loyalty program data",
    businessOwner: "Jane Doe",
    technicalOwner: "Raj Patel",
  });
  const pricing = service.create("Domain", commercial.id, {
    name: "Pricing",
    description: "Fare and ancillary pricing data",
    businessOwner: "Sam Reed",
    technicalOwner: "Lena Fox",
  });

  const membership = service.create("Subdomain", loyalty.id, {
    name: "Membership",
    description: "Member profiles and tier status",
    businessOwner: "Jane Doe",
    technicalOwner: "Raj Patel",
  });
  const rewards = service.create("Subdomain", loyalty.id, {
    name: "Rewards",
    description: "Points, awards and redemptions",
    businessOwner: "Jane Doe",
    technicalOwner: "Raj Patel",
  });
  service.create("Subdomain", pricing.id, {
    name: "Fare Rules",
    description: "Fare construction and rules",
    businessOwner: "Sam Reed",
    technicalOwner: "Lena Fox",
  });

  service.create("DataProduct", membership.id, {
    name: "Member Profile",
    description: "Curated, deduplicated member profile",
    businessOwner: "Jane Doe",
    technicalOwner: "Raj Patel",
  });
  service.create("DataProduct", rewards.id, {
    name: "Redemption Ledger",
    description: "Daily redemption transactions",
    businessOwner: "Jane Doe",
    technicalOwner: "Raj Patel",
  });
}

// Allow `npm run seed` to reset and re-seed the file DB.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDb(process.env.DB_FILE ?? "taxonomy.db");
  resetDb(db);
  seed(new TaxonomyService(db));
  console.log("Seeded sample taxonomy.");
}
