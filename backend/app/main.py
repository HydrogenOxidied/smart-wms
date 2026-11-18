"""PocketWMS FastAPI Application Entrypoint."""
from contextlib import asynccontextmanager
import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.pwa_assets import MANIFEST_JSON, SERVICE_WORKER_JS
from app.routes import auth, forecasts, imports, movements, products, stocktakes, store
from app.seed import seed_demo_data_if_empty

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/woff2", ".woff2")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Ensure tables exist and demo dataset is seeded on startup."""
    Base.metadata.create_all(bind=engine)
    if get_settings().auto_seed_demo:
        with SessionLocal() as db:
            seed_demo_data_if_empty(db)
    yield


def create_app() -> FastAPI:
    """Build and configure FastAPI instance."""
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="1.0.2",
        description="Mobile-First Smart Inventory, Blind Barcode Stocktake & 3-Tier Demand Forecasting API",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get(f"{settings.api_prefix}/health", tags=["Health"])
    def health_check() -> dict[str, str]:
        return {"status": "ok", "service": "pocketwms-api", "version": "1.0.2"}

    @app.get("/manifest.json", include_in_schema=False)
    def serve_manifest() -> Response:
        return Response(content=MANIFEST_JSON, media_type="application/manifest+json")

    @app.get("/sw.js", include_in_schema=False)
    def serve_service_worker() -> Response:
        return Response(
            content=SERVICE_WORKER_JS,
            media_type="text/javascript",
            headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
        )

    app.include_router(auth.router, prefix=settings.api_prefix)
    app.include_router(store.router, prefix=settings.api_prefix)
    app.include_router(products.router, prefix=settings.api_prefix)
    app.include_router(movements.router, prefix=settings.api_prefix)
    app.include_router(stocktakes.router, prefix=settings.api_prefix)
    app.include_router(forecasts.router, prefix=settings.api_prefix)
    app.include_router(imports.router, prefix=settings.api_prefix)

    web_dist = Path(__file__).resolve().parents[2] / "mobile" / "dist"
    if (web_dist / "index.html").exists():
        expo_dir = web_dist / "_expo"
        if expo_dir.is_dir():
            app.mount("/_expo", StaticFiles(directory=str(expo_dir)), name="expo-static")

        assets_dir = web_dist / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="expo-assets")

        @app.get("/", include_in_schema=False)
        def serve_pwa_index() -> FileResponse:
            return FileResponse(
                web_dist / "index.html",
                media_type="text/html",
                headers={"Cache-Control": "no-cache"},
            )

        favicon_path = web_dist / "favicon.ico"
        if favicon_path.exists():
            @app.get("/favicon.ico", include_in_schema=False)
            def serve_favicon() -> FileResponse:
                return FileResponse(favicon_path, media_type="image/x-icon")

        metadata_path = web_dist / "metadata.json"
        if metadata_path.exists():
            @app.get("/metadata.json", include_in_schema=False)
            def serve_metadata() -> FileResponse:
                return FileResponse(metadata_path, media_type="application/json")

        app.mount("/web", StaticFiles(directory=str(web_dist), html=True), name="pwa-web")

    return app


app = create_app()
