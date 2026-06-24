import { createApp } from "./app.js";
import { createDb } from "./db.js";
import { TaxonomyService } from "./taxonomyService.js";
import { seedIfEmpty } from "./seed.js";

const PORT = Number(process.env.PORT ?? 4000);
const DB_FILE = process.env.DB_FILE ?? "taxonomy.db";

const db = createDb(DB_FILE);
seedIfEmpty(new TaxonomyService(db));

const app = createApp(db);
app.listen(PORT, () => {
  console.log(`Data Mesh Taxonomy API listening on http://localhost:${PORT}`);
});
