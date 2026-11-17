"""PocketWMS FastAPI Application Entrypoint."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.routes import auth, forecasts, imports, movements, products, stocktakes, store
from app.seed import seed_demo_data_if_empty


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
        version="1.0.0",
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
        return {"status": "ok", "service": "pocketwms-api", "version": "1.0.0"}

    app.include_router(auth.router, prefix=settings.api_prefix)
    app.include_router(store.router, prefix=settings.api_prefix)
    app.include_router(products.router, prefix=settings.api_prefix)
    app.include_router(movements.router, prefix=settings.api_prefix)
    app.include_router(stocktakes.router, prefix=settings.api_prefix)
    app.include_router(forecasts.router, prefix=settings.api_prefix)
    app.include_router(imports.router, prefix=settings.api_prefix)

    return app


app = create_app()
