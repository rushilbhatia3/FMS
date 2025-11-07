
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.staticfiles import StaticFiles
import pathlib

import db

#Routers
from auth import router as auth_router
from users import router as users_router
from systems import router as systems_router
from shelves import router as shelves_router
from items import router as items_router
from movements import router as movements_router
from status import router as status_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="Warehouse Management System API",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    # Health check
    @app.get("/api/health", tags=["meta"])
    def health():
        try:
            _ = db.db_read("SELECT 1 AS ok")
            return JSONResponse({"status": "ok", "db": "ok"})
        except Exception as e:
            return JSONResponse({"status": "degraded", "db": f"error: {e}"}, status_code=503)

    # API routers
    app.include_router(auth_router, prefix="/api")
    app.include_router(users_router, prefix="/api")
    app.include_router(systems_router, prefix="/api")
    app.include_router(shelves_router, prefix="/api")
    app.include_router(items_router, prefix="/api")
    app.include_router(movements_router, prefix="/api")
    app.include_router(status_router, prefix="/api")

    # ---------- Static frontend ----------
    frontend_dir = (pathlib.Path(__file__).parent / "Frontend").resolve()

    # Place AFTER API includes so /api/* keeps working.
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

    # Explicit root route to index.html (helps some servers & makes intent clear)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)