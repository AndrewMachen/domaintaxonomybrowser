# Data Mesh Taxonomy — Python / Databricks Apps

A Python port of the Data Mesh Taxonomy admin tool, packaged to deploy as a
single **Databricks App**. It manages the hierarchy

```
Domain Group  →  Domain  →  Subdomain  →  Data Product
```

with full CRUD, inline rename, drag-and-drop reordering and cross-parent moves,
search/filter, and round-trip Excel import/export with validation.

The runtime is pure Python: **FastAPI** serves the REST API under `/api` and the
pre-built **React** single-page UI from `./static`, so the whole thing runs as
one process on Databricks' serverless app compute.

---

## Production hardening

Beyond the core CRUD app, the following are built in so this can serve as a
governed system of record rather than just an internal editor.

### Authorization (RBAC + per-domain ownership)
Databricks SSO decides *who can open* the app; this layer decides *what they can
do*. Identity is taken from the `X-Forwarded-Email` header the Databricks Apps
proxy injects. Three global roles — `admin` > `editor` > `viewer` — plus
per-domain-group **grants** that give a steward editor rights over a single
subtree without making them a global editor.

- Reads (tree, list, get, export, template): any authenticated user.
- Writes (create/update/delete/move/reorder/restore): global `editor`/`admin`,
  or a grant on the owning Domain Group. Creating a new top-level Domain Group
  and importing both require global edit rights.
- Role/grant management and the audit log: `admin` only.
- Bootstrap with `ADMIN_EMAILS` (always-admin); those admins assign everyone
  else via `PUT /api/admin/roles` and `PUT /api/admin/grants`.
- `GET /api/me` returns the caller's role and grants.
- `AUTH_DISABLED=true` resolves every request to a synthetic admin for local
  development; it must be `false` in production.

### Audit trail + recoverable deletes
Every mutation (create, update, delete, restore, move, reorder, import) writes
an `audit_log` row recording the acting user, the action, the node, and a JSON
diff of what changed. `GET /api/audit` exposes it (admin only).

Deletes are **soft**: rows get `deleted_at`/`deleted_by` stamps instead of being
dropped, and the delete cascades down the subtree. `GET /api/deleted` is the
recycle bin; `POST /api/{level}/{id}/restore` brings a subtree back (it refuses
if the parent is still deleted or the name is now taken).

### DB-level uniqueness + optimistic locking
Sibling-name uniqueness is enforced by a **partial unique index** on
`(parent, lower(name)) WHERE deleted_at IS NULL` — in the database, not just the
app — so two concurrent creates can't both win, and a name frees up after a soft
delete. Each row carries a `version` wired as SQLAlchemy's `version_id_col`;
concurrent writers get a `409`. Clients may also pass `expectedVersion` on
PATCH/move (or `?expectedVersion=` on delete) for explicit optimistic
concurrency.

### Schema migrations (Alembic)
Schema is managed by Alembic, not `create_all`. `app.py` runs
`alembic upgrade head` on startup (reusing the app's engine, so the Lakebase
token hook applies) unless `RUN_MIGRATIONS=false`. The baseline migration is
`migrations/versions/0001_initial.py`; create future changes with
`alembic revision -m "..."` and they apply automatically on the next deploy.

### Lakebase OAuth token refresh
Lakebase OAuth tokens used as the Postgres password expire ~hourly, so a
long-lived pooled connection would eventually fail to authenticate. Set
`LAKEBASE_INSTANCE_NAME` and, on each new DBAPI connection, a SQLAlchemy
`do_connect` hook injects a freshly generated token (via the Databricks SDK);
the pool also recycles connections well within the token lifetime. No static
password is stored. The hook is skipped (falling back to `PGPASSWORD`) when no
instance is configured or the SDK isn't installed, so local SQLite is unaffected.

### Known limitation
The pre-built React UI is **not yet role-aware**: a viewer sees edit controls
that return `403` when used. Server-side enforcement is authoritative and
complete; making the UI hide/disable controls per role is a follow-up.

See `app.yaml` for the full list of configuration environment variables.

---

## Why this shape

The original app was Node/Express + React/TypeScript. "Convert to Python" here
means the entire backend — service logic, validation, Excel handling, and the
web server — is now Python, while the polished React UI (which carries the
mandated subdomain drag-and-drop) is reused as compiled static assets. The JSON
API contract is kept byte-for-byte identical, so the existing UI runs unchanged.

Streamlit/Dash were considered (they're the "native" Databricks Python
frameworks) but neither cleanly supports the required drag-and-drop tree, so
FastAPI-serving-React is the better fit and still deploys as a standard
Databricks App.

---

## Architecture

```
app.py                 # entrypoint: builds FastAPI, seeds, serves /api + static SPA
app.yaml               # Databricks Apps manifest (command + env)
requirements.txt
taxonomy/
  types.py             # Level enum, level config, owner-requirement map, payloads
  db.py                # SQLAlchemy engine/session; DATABASE_URL + Lakebase resolution
  models.py            # ORM models for the four levels (camelCase serialization)
  validation.py        # field validation + typed errors (400/409/404)
  service.py           # CRUD, reorder, move (re-indexes both parents), tree
  excel_service.py     # openpyxl import/export
  routes.py            # API router + exception handlers
  seed.py              # sample data
scripts/
  seed.py              # python -m scripts.seed   (reset + seed configured DB)
  make_template.py     # python -m scripts.make_template [out] [--seed]
static/                # pre-built React UI (index.html + assets)
tests/                 # pytest suite (62 tests)
taxonomy-template.xlsx # blank import template (header + example row)
sample-data.xlsx       # seeded taxonomy exported to Excel
```

**Persistence.** `db.py` chooses the database from the environment so the same
code runs locally and on Databricks:

- `DATABASE_URL` if set (any SQLAlchemy URL; `postgres://` is normalized to the
  psycopg driver).
- otherwise, if `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` are present (as
  injected by an attached Lakebase resource), a PostgreSQL URL is assembled.
- otherwise `sqlite:///taxonomy.db` for local development.

Each HTTP request runs in one transaction (commit on success, rollback on
error). The Excel import runs entirely inside one transaction, so a row-level
problem is recorded and skipped while an unexpected failure rolls the whole
import back — existing data is never partially corrupted.

---

## Local development

Requires Python 3.11+ (Databricks Apps run 3.11; developed/tested on 3.12).

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python app.py            # serves UI + API on http://localhost:8000
```

By default it uses a local `taxonomy.db` SQLite file and seeds sample data on
first run. Open `http://localhost:8000` for the UI; the API is under `/api`
(e.g. `GET /api/tree`).

Rebuild the UI only if you change the React source: build the client and copy
its `dist/` output into `./static`.

---

## Tests

```bash
source .venv/bin/activate
pytest
```

Latest run: **84 passed**. Coverage mirrors the original suite plus the
hardening features:

| Suite               | Focus |
|---------------------|-------|
| `test_crud.py`      | create/read/update/rename/delete, cascade, tree assembly |
| `test_validation.py`| required fields per level, technical-owner rules, duplicate siblings |
| `test_reorder.py`   | subdomain reorder, move between parents, source/destination re-indexing, move guards |
| `test_excel.py`     | export header/rows, empty-branch preservation, round-trip, template |
| `test_import.py`    | column validation, create vs update, hierarchy-aware dedupe, row atomicity |
| `test_api.py`       | REST integration via FastAPI TestClient: CRUD, 400/409/404, tree, reorder, move, export, import |
| `test_authz.py`     | RBAC: 401 unauth, role gating, admin role/grant management, per-domain grant scoping, admin-only audit |
| `test_hardening.py` | soft-delete + restore + recycle bin, name reuse, optimistic-lock 409, DB-level unique index, audit trail |

---

## Deploying to Databricks Apps

1. **Durable database (recommended).** Create a Lakebase (managed Postgres)
   instance. The app's local disk is ephemeral, so production state must live
   here. Attach it to the app as a **database resource** — Databricks injects
   `PGHOST` / `PGDATABASE` / `PGUSER` / `PGPASSWORD`, which the app picks up
   automatically. (For local or throwaway runs, the SQLite default is fine.)

2. **Get the code into Databricks.** Either upload this folder via workspace
   sync, or push it to Git and create a custom app pointing at the repo. Include
   `app.yaml`, `requirements.txt`, `app.py`, `taxonomy/`, and `static/`. Every
   file is under the 10 MB per-file limit.

3. **Deploy.** Create app → *Create a custom app*, select this source, and
   deploy. Databricks installs `requirements.txt`, then runs the `app.yaml`
   command `python app.py`. The app reads `DATABRICKS_APP_PORT`, binds
   `0.0.0.0`, and serves the UI at the app URL with the API under `/api`.

4. **Config.** `SEED_ON_STARTUP` (default `true`) seeds sample data only when
   the database is empty; set it to `false` once you manage data yourself.

Notes: FastAPI and uvicorn are preinstalled in the Databricks Apps Python
environment; API routes are under `/api`, which is what Databricks' token auth
expects. If you change the React source, rebuild it and copy `dist/` into
`static/` before redeploying.

---

## Excel format

One sheet (`Taxonomy`), one row per branch, 16 columns: the 15 required columns
from the spec plus an optional `Domain Group Technical Owner` (Domain Groups
have no required technical owner). Two files are included: `taxonomy-template.xlsx`
(header + example row) and `sample-data.xlsx` (seeded data exported).

Import rules: required columns are checked first (a missing one rejects the
file); a node is matched by its name within its parent (case- and
whitespace-insensitive) and updated in place, otherwise created; the summary
reports `created` / `updated` / `skipped` / `errors`. A row is all-or-nothing —
an invalid child prevents its ancestors on that row from being written.

## Validation rules

Enforced identically in the service layer and Excel import:

- `name`, `description`, `businessOwner` required at every level.
- `technicalOwner` required for Domain, Subdomain, Data Product; optional for
  Domain Group.
- Sibling names unique within a parent (case- and whitespace-insensitive).
