# Data Mesh Taxonomy

A full-stack web application for managing a hierarchical data mesh taxonomy:

```
Domain Group  →  Domain  →  Subdomain  →  Data Product
```

It supports full CRUD at every level, inline rename, drag-and-drop reordering and
cross-parent moves, search and faceted filtering, and round-trip Excel import/export
with validation and an import summary.

---

## Architecture

The project is split into a verifiable TypeScript backend and a React frontend.

**Backend** (`server/`) — Node.js + Express + TypeScript, REST API, SQLite persistence.

- **`db.ts`** — thin adapter over Node's built-in `node:sqlite` (`DatabaseSync`). Four
  tables (`domain_groups`, `domains`, `subdomains`, `data_products`) with
  `ON DELETE CASCADE` foreign keys and supporting indexes. Exposes prepared
  statements and nestable transactions (`BEGIN/COMMIT` + `SAVEPOINT`).
- **`taxonomyService.ts`** — all business logic: create/read/update/rename/delete,
  sibling-uniqueness checks, sort-order maintenance, `reorder`, `move` (re-indexes
  both source and destination parents), and `getTree`. The API and Excel layers both
  go through this service so validation is enforced in exactly one place.
- **`validation.ts`** — `zod`-based create/update validation with typed errors
  (`ValidationError` → 400, `ConflictError` → 409, `NotFoundError` → 404).
- **`excelService.ts`** — export walks the tree and emits one row per branch;
  import maps headers, checks required columns, and runs every row inside a single
  transaction so a failure never leaves the database half-updated.
- **`routes.ts` / `app.ts` / `server.ts`** — REST routing, body parsing (raw bytes
  for the binary import upload, JSON elsewhere), error handling, and startup/seed.

**Frontend** (`client/`) — React + TypeScript + Vite, Material UI, TanStack Query for
server state, and `@dnd-kit` for drag-and-drop.

- A split-pane explorer: a level-coded hierarchy tree on the left, a detail panel with
  inline rename on the right.
- Each hierarchy level owns a fixed accent color (the product's visual signature), so a
  node's depth is legible at a glance in the tree, in chips, and on the detail rail.
- `TreeExplorer` wires a single `DndContext`; subdomains reorder within a domain and
  move between domains (mandatory), and the same mechanism enables reordering for
  domains and data products.
- `filterTree` prunes the tree to matches plus the ancestors needed to reach them, and
  auto-expands those branches.

### Why this stack

The brief's preferred stack was followed (React + TS + MUI + TanStack Query on the
front, Node + TS + SQLite on the back). Two pragmatic substitutions:

- **`node:sqlite` instead of `better-sqlite3`.** `better-sqlite3` is a native module
  requiring a node-gyp build; the build environment could not fetch node headers or
  prebuilt binaries. Node's built-in synchronous SQLite has the same ergonomics, needs
  no native compilation, and keeps the data layer dependency-free.
- **ExcelJS** for Excel handling — actively maintained, reads and writes `.xlsx`, and
  supports header styling and column sizing.

---

## Data model

Every node shares: `id`, `name`, `description`, `businessOwner`, `technicalOwner`
(nullable only on Domain Group), `sortOrder`, `createdAt`, `updatedAt`. Each non-root
node also carries its parent id (`domainGroupId`, `domainId`, or `subdomainId`).
Deleting a node cascades to its descendants.

---

## Setup

Requires **Node.js 22+** (the backend uses the built-in `node:sqlite` module).

### 1. Backend

```bash
cd server
npm install
npm run seed     # optional: reset + load sample data into taxonomy.db
npm start        # serves the REST API on http://localhost:4000
```

### 2. Frontend

```bash
cd client
npm install
npm run dev      # serves the UI on http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`, so run both together.
For a production bundle: `npm run build` then `npm run preview`.

---

## Tests

The backend carries the testable business logic and ships with a full, passing suite.

```bash
cd server
npm test
```

Run with [Vitest]. Latest result:

```
 Test Files  6 passed (6)
      Tests  61 passed (61)
```

Coverage by area:

| Suite                | What it covers |
|----------------------|----------------|
| `crud.test.ts`       | Create/read/update/rename/delete and cascade, tree assembly |
| `validation.test.ts` | Required fields at each level, technical-owner rules, duplicate sibling names |
| `reorder.test.ts`    | Subdomain reorder, move between domains, source/destination re-indexing, move guards |
| `excel.test.ts`      | Export header/data, empty-branch preservation, round-trip, template generation |
| `import.test.ts`     | Column-structure validation, create vs. update, hierarchy-aware dedupe, row validation, transactional atomicity |
| `api.test.ts`        | REST integration (supertest): CRUD, 400/409 errors, tree, rename, delete, reorder, move, export download, import upload |

---

## Excel import / export

### Column layout

The workbook uses one sheet (`Taxonomy`), one row per branch, with these columns:

```
Domain Group Name | Domain Group Description | Domain Group Business Owner |
Domain Group Technical Owner | Domain Name | Domain Description |
Domain Business Owner | Domain Technical Owner | Subdomain Name |
Subdomain Description | Subdomain Business Owner | Subdomain Technical Owner |
Data Product Name | Data Product Description | Data Product Business Owner |
Data Product Technical Owner
```

The 15 columns named in the brief are all present; `Domain Group Technical Owner` is
included as an optional 16th column (Domain Groups have no required technical owner).
A blank cell for an optional technical owner is stored as empty.

Two ready-made files are included:

- **`server/taxonomy-template.xlsx`** — headers plus one example row (`npm run make-template` regenerates it).
- **`server/sample-data.xlsx`** — the seeded sample taxonomy exported to Excel.

### Import behavior and assumptions

- **Required columns** are checked first; a missing column rejects the whole file.
- **Matching** is hierarchy-aware: a node is identified by its name within its parent
  (case- and whitespace-insensitive). A match is updated in place; otherwise a node is
  created. The summary reports created / updated / skipped / errors.
- **Row atomicity:** within a row, a parent is only created/updated if its named
  descendants on that row are themselves valid, so an invalid child never produces an
  orphaned parent.
- **File atomicity:** the entire import runs in one transaction. Expected per-row
  problems are recorded and the row is skipped; an unexpected failure rolls the whole
  import back, so existing data is never partially corrupted.

---

## Validation rules

Enforced identically in the UI, the service layer, and Excel import:

- `name`, `description`, and `businessOwner` are required at every level.
- `technicalOwner` is required for Domain, Subdomain, and Data Product; optional for
  Domain Group.
- Sibling names must be unique within the same parent (case- and
  whitespace-insensitive).

The server is always the source of truth and re-validates every write; the UI mirrors
these rules only to give immediate feedback.

---

## Project structure

```
data-mesh-taxonomy/
├── README.md
├── server/
│   ├── src/
│   │   ├── types.ts            # shared types, level config, owner-requirement map
│   │   ├── db.ts               # node:sqlite adapter, schema, transactions
│   │   ├── validation.ts       # zod validation + typed errors
│   │   ├── taxonomyService.ts  # CRUD, reorder, move, tree
│   │   ├── excelService.ts     # import/export
│   │   ├── routes.ts           # REST routes + error handler
│   │   ├── app.ts              # express app wiring
│   │   ├── server.ts           # entry point
│   │   ├── seed.ts             # sample data
│   │   └── makeTemplate.ts     # writes taxonomy-template.xlsx
│   ├── tests/                  # vitest suites (61 tests)
│   ├── taxonomy-template.xlsx  # sample import template
│   └── sample-data.xlsx        # seeded data exported to Excel
└── client/
    └── src/
        ├── api/                # types, REST client, client-side validation
        ├── hooks/              # TanStack Query hooks, tree filtering
        ├── components/         # explorer, detail panel, drawer, dialogs, toolbar
        ├── theme/              # MUI theme + level color tokens
        ├── App.tsx
        └── main.tsx
```
