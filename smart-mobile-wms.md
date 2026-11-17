# PocketWMS (KhoThôngMinh) — Implementation Plan

## Overview
Mobile-First Smart Inventory & Warehouse Management System (`PocketWMS`) designed as a graduation thesis MVP in `f:\gayt\smart-wms`. Combines a **Cloud-Ready FastAPI + SQLite ACID Ledger + 3-Tier NumPy Forecasting Backend** with an **Adaptive Cross-Platform React Native (Expo) Mobile App** supporting both **Micro-Store Lite Mode** (loose/consumable items, pack-break units) and **Warehouse Pro Mode** (real-time barcode stock-out, end-of-shift batch consumption, blind stocktake, offline sync queue, and AI reorder recommendations).

## Project Type
**MOBILE + BACKEND** (`mobile-developer` + `backend-specialist` + `database-architect`)

## Success Criteria
- [x] **ACID Stock Ledger (`stock_movements`)**: Immutable append-only ledger with `idempotency_key` deduplication, Anomaly Guard (`>10x` avg consumption `409` prompt), and 15-minute `REVERSAL` correction.
- [x] **3 Consumption / Stock-Out Flows**:
  - [x] Flow 1: Real-time Stock-Out (`OUT_CONSUMPTION` vs `OUT_DAMAGE_EXPIRED`) via barcode or quick stepper.
  - [x] Flow 2: End-of-Shift Batch Consumption (`POST /api/v1/movements/batch`).
  - [x] Flow 3: Blind Stocktake (`STAFF` blind mode masking system stock + `MANAGER` Variance Approval with Implied Consumption).
- [x] **Adaptive Micro-Store UX**: 5-second Quick-Add (3 required fields + fuzzy duplicate warning), `PACK_BREAK` 2-level unit conversion (`break-pack`), and `CONSUMABLE` gauge percentage counting.
- [x] **3-Tier Demand Forecasting Engine**: Excludes `OUT_DAMAGE_EXPIRED`, applies Tier 1 (`COLD_START`), Tier 2 (`EWMA_WEEKLY`), and Tier 3 (`HOLT_WINTERS` 7-day seasonal + backtest MAE/MAPE), computing Safety Stock, Reorder Point (ROP), Days Until Stockout, and Auto-Draft PO export.
- [x] **CSV Import & Starter Templates**: Bulk product/history CSV import and 1-tap industry templates (`CAFE_BAKERY`, `MINI_MART`, `HARDWARE`, `EMPTY`).
- [x] **Expo Mobile App**: Role-based tabs (`STAFF` 4 tabs / `MANAGER` 5 tabs), `expo-camera` barcode scanner + web fallback, `expo-secure-store` JWT storage, offline FIFO queue (`AsyncStorage`), Light & Dark OLED themes (`DESIGN.md`), 48dp+ touch targets.
- [x] **Verification**: Pytest suite passing, live API smoke test, `tsc --noEmit` passing, `expo export --platform web` succeeding, `security_scan.py` & `mobile_audit.py` passing with 0 critical issues.

## Tech Stack
- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2.0, Pydantic v2, PyJWT, bcrypt, NumPy, SQLite (`WAL` mode + `PRAGMA foreign_keys=ON`, 1-line PostgreSQL switchable via `DATABASE_URL`).
- **Mobile**: React Native + Expo (TypeScript), TanStack Query, Zustand, `expo-camera`, `expo-secure-store`, `expo-haptics`, `@react-native-async-storage/async-storage`, `expo-document-picker`, `expo-file-system`, `expo-sharing`, `@expo/vector-icons`.

## File Structure
```text
f:\gayt\smart-wms\
├── DESIGN.md
├── README.md
├── smart-mobile-wms.md
├── start-backend.bat
├── start-mobile.bat
├── backend\
│   ├── requirements.txt
│   ├── .env.example
│   ├── app\
│   │   ├── main.py
│   │   ├── seed.py
│   │   ├── core\ (config.py, database.py, security.py)
│   │   ├── models\ (entities.py)
│   │   ├── schemas\ (api.py)
│   │   ├── services\ (ledger.py, stocktake.py, forecasting.py, csv_import.py, templates.py)
│   │   └── routes\ (auth.py, store.py, products.py, movements.py, stocktakes.py, forecasts.py, imports.py)
│   └── tests\ (test_wms_api.py)
└── mobile\
    ├── App.tsx
    ├── app.json
    ├── package.json
    └── src\
        ├── theme\tokens.ts
        ├── types\wms.ts
        ├── services\ (secureTokenStorage.ts, apiClient.ts, offlineQueue.ts)
        ├── store\ (authStore.ts, offlineQueueStore.ts, uiStore.ts)
        ├── components\ (BarcodeScannerModal.tsx, QuickAddProductModal.tsx, CommonUI.tsx)
        └── screens\ (LoginScreen.tsx, DashboardScreen.tsx, InventoryScreen.tsx, ConsumptionScreen.tsx, StocktakeScreen.tsx, ForecastScreen.tsx)
```

## Task Breakdown
- [x] **T1 (Governance & Design)**: Initialize git branch `feature/smart-mobile-wms`, `.gitignore`, `smart-mobile-wms.md`, and `DESIGN.md` (`design-spec`) -> Verify: Files exist and match schema.
- [x] **T2 (Backend Core & Models)**: Setup `.venv`, FastAPI config, SQLite WAL engine, bcrypt/PyJWT RBAC, SQLAlchemy entities (`Store`, `User`, `Product`, `StockMovement`, `StocktakeSession`, `StocktakeItem`) -> Verify: App imports cleanly.
- [x] **T3 (Ledger, Stocktake & Forecasting Services)**: Implement append-only ledger (`idempotency_key`, anomaly 409 guard, 15m reversal, pack-break), blind stocktake & implied consumption, 3-tier `numpy` Holt-Winters + ROP forecasting, CSV importer, starter templates, and 65-day realistic seed data -> Verify: `pytest` passes all unit & integration tests.
- [x] **T4 (Expo Mobile App)**: Scaffold TypeScript Expo app, design tokens, `SecureStore` auth, offline FIFO sync queue, camera barcode scanner + web fallback, Quick-Add 3-field modal, and 6 role-adaptive screens -> Verify: `npx tsc --noEmit` & `npx expo export --platform web` succeed.
- [x] **T5 (Launchers & Docs)**: Write `start-backend.bat`, `start-mobile.bat`, and Vietnamese thesis demo `README.md` -> Verify: Launchers valid.
- [x] **T6 (Phase X Verification)**: Run `pytest`, live backend smoke check, `tsc --noEmit`, `expo export`, `security_scan.py`, and `mobile_audit.py` -> Verify: Zero critical issues.

## ✅ PHASE X COMPLETE
- Backend Pytest: ✅ 5/5 passed (`2.19s`)
- Live FastAPI Smoke Test: ✅ `HEALTH=ok`, `SKUS=10`, `CRITICAL=4`, `REORDER=1`, `smart_wms.db` seeded
- Mobile TypeScript (`tsc --noEmit`): ✅ Exit 0 (0 errors)
- Expo Production Web Bundle (`expo export --platform web`): ✅ Exported `dist/` (`457 modules`)
- Security Scan (`security_scan.py`): ✅ `[OK] SECURE` (0 findings across 55 scanned files)
- Mobile UX Audit (`mobile_audit.py`): ✅ `STATUS: PASS` (0 critical issues, 62 passed checks across 22 files)
- Date: 2026-11-17
