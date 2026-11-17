"""3-Tier Demand Forecasting (Cold-Start, EWMA Weekly, Holt-Winters Additive) & Replenishment ROP."""
from collections import defaultdict
from datetime import date, timedelta
import math

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import Product, StockMovement
from app.schemas.api import DailyPoint, ForecastOverviewOut, ProductForecastOut

SERVICE_LEVEL_Z_95 = 1.65
FORECAST_HORIZON_DAYS = 14
REPLENISHMENT_CYCLE_DAYS = 7


def _load_net_daily_consumption(db: Session, store_id: int, product_id: int) -> tuple[list[date], np.ndarray]:
    """Build contiguous daily OUT_CONSUMPTION series, subtracting reversed consumption entries."""
    consumption_rows = db.scalars(
        select(StockMovement).where(
            StockMovement.store_id == store_id,
            StockMovement.product_id == product_id,
            StockMovement.movement_type == "OUT_CONSUMPTION",
        )
    ).all()

    if not consumption_rows:
        return [], np.array([], dtype=float)

    consumption_ids = {m.id for m in consumption_rows}
    reversal_rows = db.scalars(
        select(StockMovement).where(
            StockMovement.store_id == store_id,
            StockMovement.product_id == product_id,
            StockMovement.movement_type == "REVERSAL",
            StockMovement.reversed_movement_id.in_(consumption_ids),
        )
    ).all()

    daily_map: dict[date, float] = defaultdict(float)
    for mv in consumption_rows:
        daily_map[mv.occurred_at.date()] += abs(mv.quantity_delta)
    for rev in reversal_rows:
        daily_map[rev.occurred_at.date()] -= abs(rev.quantity_delta)

    start_day = min(daily_map.keys())
    end_day = max(date.today(), max(daily_map.keys()))
    total_days = (end_day - start_day).days + 1

    dates: list[date] = []
    values: list[float] = []
    for offset in range(total_days):
        d = start_day + timedelta(days=offset)
        dates.append(d)
        values.append(max(0.0, float(daily_map.get(d, 0.0))))

    return dates, np.asarray(values, dtype=float)


def _holt_winters_additive(
    series: np.ndarray,
    horizon: int,
    alpha: float = 0.25,
    beta: float = 0.08,
    gamma: float = 0.25,
    period: int = 7,
) -> tuple[np.ndarray, np.ndarray]:
    """Additive Holt-Winters smoother with 7-day weekly seasonality."""
    n = len(series)
    season_init_len = min(n, period)
    init_level = float(np.mean(series[:season_init_len]))
    if n >= period * 2:
        init_trend = float(
            (np.mean(series[period : period * 2]) - np.mean(series[:period])) / period
        )
    else:
        init_trend = 0.0

    seasonals = np.zeros(period, dtype=float)
    for i in range(period):
        vals = series[i::period]
        if len(vals) > 0:
            seasonals[i] = float(np.mean(vals) - init_level)

    level = init_level
    trend = init_trend
    fitted = np.zeros(n, dtype=float)

    for t in range(n):
        s_idx = t % period
        val = float(series[t])
        last_level = level
        prev_seasonal = seasonals[s_idx]
        fitted[t] = max(0.0, last_level + trend + prev_seasonal)
        level = alpha * (val - prev_seasonal) + (1.0 - alpha) * (last_level + trend)
        trend = beta * (level - last_level) + (1.0 - beta) * trend
        seasonals[s_idx] = gamma * (val - level) + (1.0 - gamma) * prev_seasonal

    forecast = np.zeros(horizon, dtype=float)
    for h in range(1, horizon + 1):
        s_idx = (n + h - 1) % period
        forecast[h - 1] = max(0.0, level + h * trend + seasonals[s_idx])

    return fitted, forecast


def _compute_metrics(actual: np.ndarray, predicted: np.ndarray) -> tuple[float, float]:
    """Compute MAE and nonzero-safe MAPE (%) on validation slice."""
    errors = np.abs(actual - predicted)
    mae = float(np.mean(errors))
    nonzero_mask = actual > 1e-6
    if np.any(nonzero_mask):
        mape = float(np.mean(errors[nonzero_mask] / actual[nonzero_mask]) * 100.0)
    else:
        mape = 0.0
    return round(mae, 2), round(min(mape, 200.0), 1)


def _forecast_ewma_weekly(series: np.ndarray, horizon: int) -> tuple[np.ndarray, float, float | None, float | None]:
    """Tier 2 forecast: EWMA level modulated by day-of-week factors."""
    alpha = 0.30
    ewma = float(series[0])
    fitted = np.zeros(len(series), dtype=float)
    for idx, val in enumerate(series):
        fitted[idx] = max(0.0, ewma)
        ewma = alpha * float(val) + (1.0 - alpha) * ewma

    mean_all = float(np.mean(series)) or 1.0
    dow_factors = np.ones(7, dtype=float)
    for dow in range(7):
        slice_vals = series[dow::7]
        if len(slice_vals) > 0:
            dow_factors[dow] = max(0.5, min(1.8, float(np.mean(slice_vals)) / mean_all))

    forecast = np.array(
        [max(0.0, ewma * dow_factors[(len(series) + h) % 7]) for h in range(horizon)],
        dtype=float,
    )
    residual_std = float(np.std(series - fitted)) if len(series) > 2 else float(np.std(series))
    mae, mape = _compute_metrics(series[-min(7, len(series)):], fitted[-min(7, len(series)):])
    return forecast, residual_std, mae, mape


def forecast_product(db: Session, product: Product) -> ProductForecastOut:
    """Compute demand forecast, safety stock, ROP, stockout days, and draft PO qty for one product."""
    dates, series = _load_net_daily_consumption(db, product.store_id, product.id)
    history_days = len(series)
    today = date.today()

    mae: float | None = None
    mape: float | None = None

    if history_days < 7:
        tier = "COLD_START"
        if history_days > 0:
            avg_daily = float(np.mean(series))
            demand_std = float(np.std(series)) if history_days > 1 else avg_daily * 0.25
        else:
            avg_daily = round(max(0.5, product.min_stock_level / max(1, product.lead_time_days)), 2)
            demand_std = round(avg_daily * 0.25, 2)
        forecast_vals = np.full(FORECAST_HORIZON_DAYS, avg_daily, dtype=float)
    elif history_days < 30:
        tier = "EWMA_WEEKLY"
        forecast_vals, demand_std, mae, mape = _forecast_ewma_weekly(series, FORECAST_HORIZON_DAYS)
        avg_daily = float(np.mean(forecast_vals[:7]))
    else:
        tier = "HOLT_WINTERS"
        val_len = min(14, max(7, history_days // 4))
        train_slice = series[:-val_len]
        val_slice = series[-val_len:]

        best_params = (0.25, 0.08, 0.25)
        best_val_mae = float("inf")
        best_val_mape = 0.0
        for a in (0.15, 0.30):
            for b in (0.05, 0.12):
                for g in (0.15, 0.35):
                    _, val_pred = _holt_winters_additive(train_slice, val_len, a, b, g, period=7)
                    c_mae, c_mape = _compute_metrics(val_slice, val_pred)
                    if c_mae < best_val_mae:
                        best_val_mae = c_mae
                        best_val_mape = c_mape
                        best_params = (a, b, g)

        fitted_full, forecast_vals = _holt_winters_additive(
            series, FORECAST_HORIZON_DAYS, *best_params, period=7
        )
        mae = best_val_mae
        mape = best_val_mape
        demand_std = float(np.std(series[-30:] - fitted_full[-30:]))
        avg_daily = float(np.mean(forecast_vals[:7]))

    avg_daily = max(0.0, avg_daily)
    demand_std = max(0.1, demand_std)
    safety_stock = round(SERVICE_LEVEL_Z_95 * demand_std * math.sqrt(product.lead_time_days), 2)
    calc_rop = round(avg_daily * product.lead_time_days + safety_stock, 2)
    reorder_point = round(max(calc_rop, product.min_stock_level), 2)

    if avg_daily > 1e-4:
        days_until_stockout: float | None = round(product.current_stock / avg_daily, 1)
    else:
        days_until_stockout = None

    if product.current_stock <= 0 or (days_until_stockout is not None and days_until_stockout <= product.lead_time_days):
        item_status = "CRITICAL"
    elif product.current_stock <= reorder_point:
        item_status = "REORDER_SOON"
    else:
        item_status = "HEALTHY"

    target_stock = avg_daily * (product.lead_time_days + REPLENISHMENT_CYCLE_DAYS) + safety_stock
    raw_order = max(0.0, target_stock - product.current_stock)
    if item_status == "HEALTHY" and product.current_stock > reorder_point * 1.1:
        recommended_order_qty = 0.0
    else:
        recommended_order_qty = float(math.ceil(raw_order))

    if product.tracking_type == "PACK_BREAK" and product.pack_conversion_rate > 1 and recommended_order_qty > 0:
        packs = math.ceil(recommended_order_qty / product.pack_conversion_rate)
        recommended_order_qty = float(packs * product.pack_conversion_rate)

    history_slice_dates = dates[-30:] if dates else []
    history_slice_vals = series[-30:] if len(series) else []
    history_points = [
        DailyPoint(date=d.isoformat(), qty=round(float(v), 2))
        for d, v in zip(history_slice_dates, history_slice_vals)
    ]

    forecast_points: list[DailyPoint] = []
    for h in range(FORECAST_HORIZON_DAYS):
        f_date = (today + timedelta(days=h + 1)).isoformat()
        yhat = round(float(forecast_vals[h]), 2)
        band = 1.65 * demand_std * math.sqrt(1.0 + h / 14.0)
        forecast_points.append(
            DailyPoint(
                date=f_date,
                qty=yhat,
                lower=round(max(0.0, yhat - band), 2),
                upper=round(yhat + band, 2),
            )
        )

    return ProductForecastOut(
        product_id=product.id,
        sku=product.sku,
        name=product.name,
        category=product.category,
        unit=product.unit,
        tracking_type=product.tracking_type,
        supplier_name=product.supplier_name,
        current_stock=round(product.current_stock, 2),
        min_stock_level=round(product.min_stock_level, 2),
        lead_time_days=product.lead_time_days,
        unit_cost=product.unit_cost,
        history_days=history_days,
        algorithm_tier=tier,
        avg_daily_demand=round(avg_daily, 2),
        demand_std=round(demand_std, 2),
        safety_stock=safety_stock,
        reorder_point=reorder_point,
        days_until_stockout=days_until_stockout,
        status=item_status,
        recommended_order_qty=recommended_order_qty,
        estimated_order_cost=round(recommended_order_qty * product.unit_cost, 0),
        mae=mae,
        mape=mape,
        history_series=history_points,
        forecast_series=forecast_points,
    )


def get_store_forecast_overview(db: Session, store_id: int) -> ForecastOverviewOut:
    """Rank all active store products by stockout urgency and compute draft PO cost."""
    products = db.scalars(
        select(Product).where(Product.store_id == store_id, Product.is_active.is_(True))
    ).all()
    forecasts = [forecast_product(db, prod) for prod in products]
    severity_rank = {"CRITICAL": 0, "REORDER_SOON": 1, "HEALTHY": 2}
    forecasts.sort(
        key=lambda f: (
            severity_rank[f.status],
            f.days_until_stockout if f.days_until_stockout is not None else 9999.0,
        )
    )

    critical_count = sum(1 for f in forecasts if f.status == "CRITICAL")
    reorder_soon_count = sum(1 for f in forecasts if f.status == "REORDER_SOON")
    healthy_count = sum(1 for f in forecasts if f.status == "HEALTHY")
    total_po_cost = sum(f.estimated_order_cost for f in forecasts if f.recommended_order_qty > 0)

    return ForecastOverviewOut(
        store_id=store_id,
        total_skus=len(forecasts),
        critical_count=critical_count,
        reorder_soon_count=reorder_soon_count,
        healthy_count=healthy_count,
        total_suggested_po_cost=round(total_po_cost, 0),
        items=forecasts,
    )
