"""FastAPI routing for the taxonomy REST API.

The taxonomy JSON contract stays compatible with the original client (same
paths, camelCase payloads, 400/404/409 semantics). Added on top:

* every request resolves an authenticated principal (401 if none);
* writes are authorized by role / per-domain grant (403 otherwise);
* mutating calls thread the acting user into the audit log and honor an
  optional ``expectedVersion`` for optimistic concurrency (409 on conflict);
* new endpoints: ``/me``, ``/audit``, ``/deleted`` + restore, and ``/admin/*``
  for role and grant management.
"""
from __future__ import annotations

from typing import Callable, Optional

from fastapi import APIRouter, Body, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from .auth import AuthService, Principal, require_admin, require_editor
from .excel_service import ExcelService
from .service import TaxonomyService
from .types import LEVEL_SEGMENT, PARENT_FIELD, PARENT_LEVEL, Level
from .validation import AppError, ConflictError, ValidationError

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def build_router(get_session: Callable[..., Session]) -> APIRouter:
    router = APIRouter()

    def service(session: Session = Depends(get_session)) -> TaxonomyService:
        return TaxonomyService(session)

    def auth(session: Session = Depends(get_session)) -> AuthService:
        return AuthService(session)

    def principal(request: Request, auth_svc: AuthService = Depends(auth)) -> Principal:
        return auth_svc.resolve(request.headers)

    # Authorize a write against the domain group that owns `node_id`.
    def _authorize_node(p: Principal, svc: TaxonomyService, level: Level, node_id: str) -> None:
        dg = svc.root_domain_group_id(level, node_id)
        require_editor(p, dg)

    # -- identity / health ---------------------------------------------
    @router.get("/health")
    def health() -> dict:
        return {"ok": True}

    @router.get("/me")
    def me(p: Principal = Depends(principal)) -> dict:
        return p.to_dict()

    @router.get("/tree")
    def get_tree(
        svc: TaxonomyService = Depends(service), p: Principal = Depends(principal)
    ) -> list[dict]:
        return svc.get_tree()

    # -- excel ---------------------------------------------------------
    @router.get("/export")
    def export(
        svc: TaxonomyService = Depends(service), p: Principal = Depends(principal)
    ) -> Response:
        data = ExcelService(svc).export()
        return Response(
            content=data,
            media_type=XLSX_MEDIA,
            headers={"Content-Disposition": 'attachment; filename="taxonomy.xlsx"'},
        )

    @router.get("/template")
    def template(
        svc: TaxonomyService = Depends(service), p: Principal = Depends(principal)
    ) -> Response:
        data = ExcelService(svc).template()
        return Response(
            content=data,
            media_type=XLSX_MEDIA,
            headers={"Content-Disposition": 'attachment; filename="taxonomy-template.xlsx"'},
        )

    @router.post("/import")
    async def import_workbook(
        request: Request,
        svc: TaxonomyService = Depends(service),
        p: Principal = Depends(principal),
    ) -> dict:
        # Import can touch many subtrees, so it requires global edit rights.
        require_editor(p, None)
        body = await request.body()
        if not body:
            raise ValidationError({"file": "No file uploaded"})
        return ExcelService(svc).import_workbook(body, actor=p.email)

    # -- recycle bin ---------------------------------------------------
    @router.get("/deleted")
    def deleted(
        svc: TaxonomyService = Depends(service), p: Principal = Depends(principal)
    ) -> list[dict]:
        require_editor(p, None)
        return svc.list_deleted()

    # -- audit ---------------------------------------------------------
    @router.get("/audit")
    def audit_log(
        limit: int = 200,
        nodeId: Optional[str] = None,
        session: Session = Depends(get_session),
        p: Principal = Depends(principal),
    ) -> list[dict]:
        require_admin(p)
        from . import audit as audit_mod

        return audit_mod.list_entries(session, limit=limit, node_id=nodeId)

    # -- admin: roles & grants -----------------------------------------
    @router.get("/admin/roles")
    def list_roles(auth_svc: AuthService = Depends(auth), p: Principal = Depends(principal)) -> list[dict]:
        require_admin(p)
        return auth_svc.list_roles()

    @router.put("/admin/roles")
    def set_role(
        payload: dict = Body(...),
        auth_svc: AuthService = Depends(auth),
        p: Principal = Depends(principal),
    ) -> dict:
        require_admin(p)
        return auth_svc.set_role(p.email, payload.get("email", ""), payload.get("role", ""))

    @router.delete("/admin/roles/{email}")
    def remove_role(
        email: str, auth_svc: AuthService = Depends(auth), p: Principal = Depends(principal)
    ) -> dict:
        require_admin(p)
        auth_svc.remove_role(email)
        return {"ok": True}

    @router.get("/admin/grants")
    def list_grants(auth_svc: AuthService = Depends(auth), p: Principal = Depends(principal)) -> list[dict]:
        require_admin(p)
        return auth_svc.list_grants()

    @router.put("/admin/grants")
    def grant_domain(
        payload: dict = Body(...),
        auth_svc: AuthService = Depends(auth),
        p: Principal = Depends(principal),
    ) -> dict:
        require_admin(p)
        return auth_svc.grant_domain(p.email, payload.get("email", ""), payload["domainGroupId"])

    @router.delete("/admin/grants")
    def revoke_domain(
        payload: dict = Body(...),
        auth_svc: AuthService = Depends(auth),
        p: Principal = Depends(principal),
    ) -> dict:
        require_admin(p)
        auth_svc.revoke_domain(payload.get("email", ""), payload["domainGroupId"])
        return {"ok": True}

    # -- per-level CRUD ------------------------------------------------
    def register_level(level: Level, parent_field: Optional[str]) -> None:
        segment = LEVEL_SEGMENT[level]
        base = f"/{segment}"
        parent_level = PARENT_LEVEL[level]

        @router.get(base)
        def list_nodes(
            parentId: Optional[str] = None,
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> list[dict]:
            return svc.list(level, parentId if parent_field else None)

        @router.get(base + "/{node_id}")
        def get_node(
            node_id: str,
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> dict:
            return svc.get(level, node_id)

        @router.post(base, status_code=201)
        def create_node(
            payload: dict = Body(...),
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> dict:
            parent_id = payload.get(parent_field) if parent_field else None
            # Authorize against the owning domain group (global editor for new groups).
            if parent_level is None:
                require_editor(p, None)
            else:
                require_editor(p, svc.root_domain_group_id(parent_level, parent_id) if parent_id else None)
            return svc.create(level, parent_id, payload, actor=p.email)

        @router.patch(base + "/{node_id}")
        def update_node(
            node_id: str,
            payload: dict = Body(...),
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> dict:
            _authorize_node(p, svc, level, node_id)
            return svc.update(
                level, node_id, payload, actor=p.email,
                expected_version=payload.get("expectedVersion"),
            )

        @router.delete(base + "/{node_id}")
        def delete_node(
            node_id: str,
            expectedVersion: Optional[int] = Query(default=None),
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> dict:
            _authorize_node(p, svc, level, node_id)
            return svc.remove(level, node_id, actor=p.email, expected_version=expectedVersion)

        @router.post(base + "/{node_id}/restore")
        def restore_node(
            node_id: str,
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> dict:
            _authorize_node(p, svc, level, node_id)
            return svc.restore(level, node_id, actor=p.email)

        @router.post(base + "/reorder")
        def reorder_nodes(
            payload: dict = Body(...),
            svc: TaxonomyService = Depends(service),
            p: Principal = Depends(principal),
        ) -> list[dict]:
            parent_id = payload.get("parentId") if parent_field else None
            if parent_id is None:
                require_editor(p, None)
            else:
                require_editor(p, svc.root_domain_group_id(parent_level, parent_id))
            return svc.reorder(level, parent_id, payload.get("orderedIds", []), actor=p.email)

        if parent_field:

            @router.post(base + "/{node_id}/move")
            def move_node(
                node_id: str,
                payload: dict = Body(...),
                svc: TaxonomyService = Depends(service),
                p: Principal = Depends(principal),
            ) -> dict:
                new_parent_id = payload["newParentId"]
                # Need edit rights on both the source and destination subtrees.
                _authorize_node(p, svc, level, node_id)
                require_editor(p, svc.root_domain_group_id(parent_level, new_parent_id))
                return svc.move(
                    level, node_id, new_parent_id, payload.get("newIndex"),
                    actor=p.email, expected_version=payload.get("expectedVersion"),
                )

    for lvl in (Level.DOMAIN_GROUP, Level.DOMAIN, Level.SUBDOMAIN, Level.DATA_PRODUCT):
        register_level(lvl, PARENT_FIELD[lvl])

    return router


def register_exception_handlers(app) -> None:  # noqa: ANN001
    @app.exception_handler(AppError)
    async def _app_error_handler(_request: Request, exc: AppError):
        return JSONResponse(status_code=exc.status, content=exc.payload())

    @app.exception_handler(StaleDataError)
    async def _stale_handler(_request: Request, _exc: StaleDataError):
        err = ConflictError("This item was changed by someone else. Reload and try again.")
        return JSONResponse(status_code=err.status, content=err.payload())

    @app.exception_handler(IntegrityError)
    async def _integrity_handler(_request: Request, _exc: IntegrityError):
        err = ConflictError("That name is already in use under this parent.")
        return JSONResponse(status_code=err.status, content=err.payload())
