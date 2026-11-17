---
version: 1.0.0
name: Industrial Emerald PocketWMS
description: High-contrast, one-handed field-ready mobile design system for warehouse scanning, micro-store quick inventory, and AI replenishment insights.
colors:
  primary: "#059669"
  primary-pressed: "#047857"
  primary-soft: "#D1FAE5"
  secondary: "#0284C7"
  secondary-soft: "#E0F2FE"
  warning: "#D97706"
  warning-soft: "#FEF3C7"
  danger: "#DC2626"
  danger-soft: "#FEE2E2"
  light-bg: "#F4F7F9"
  light-surface: "#FFFFFF"
  light-surface-alt: "#E9EFF4"
  light-border: "#D1DCE5"
  light-text: "#111827"
  light-text-muted: "#4B5563"
  dark-bg: "#12181F"
  dark-surface: "#1B242E"
  dark-surface-alt: "#24303D"
  dark-border: "#2E3D4D"
  dark-text: "#F3F4F6"
  dark-text-muted: "#9CA3AF"
typography:
  headline-lg:
    fontFamily: System
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.02em
  headline-md:
    fontFamily: System
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.3
  title-md:
    fontFamily: System
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
  body-md:
    fontFamily: System
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.45
  label-md:
    fontFamily: System
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.3
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    height: 48px
    padding: 14px
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    height: 48px
    padding: 14px
  card-surface:
    backgroundColor: "{colors.light-surface}"
    rounded: "{rounded.lg}"
    padding: 16px
  touch-target-min:
    height: 48px
    width: 48px
---

# Industrial Emerald PocketWMS

## Overview
PocketWMS is a mobile-first smart warehouse and micro-store inventory assistant engineered for two real-world environments:
1. **Busy Retail Counter / Micro-Store (Lite Mode)**: Fast thumb-driven `+`/`-` adjustments, 5-second quick-add for unbarcoded supplies, and end-of-shift batch logging.
2. **Storage Floor / Backroom (Warehouse Pro Mode)**: Continuous barcode scanning, blind cycle counting, offline queuing in low-signal corners, and manager replenishment decisions.

## Colors
- **Primary Emerald (`#059669`) & Pressed (`#047857`)**: Signals healthy stock, confirmed scans, and primary CTAs with high daylight legibility.
- **Secondary Steel-Blue (`#0284C7`)**: Used for informational analytics, EWMA/Holt-Winters forecast series, and sync indicators.
- **Amber (`#D97706`) & Red (`#DC2626`)**: Reserved strictly for Reorder Point warnings (`REORDER_SOON`) and critical stockout/negative-variance states (`CRITICAL`).
- **OLED-Safe Dark Slate (`#12181F` / `#1B242E`) & Clean Daylight Slate (`#F4F7F9` / `#FFFFFF`)**: Avoids pure `#000000` to prevent OLED black-smear during rapid scrolling while preserving battery efficiency during full-shift warehouse counts.
- **Explicit Exclusion**: Zero purple or violet tones anywhere in UI or charts.

## Typography
- **Platform Native Typeface (`System` / SF Pro on iOS, Roboto on Android)**: Ensures instant legibility and zero custom-font flash on low-end Android devices.
- **Tabular Numerals & Crisp Hierarchy**: Stock counts, ROP thresholds, MAE/MAPE metrics, and barcode strings remain legible at arm's length with minimum `12px–13px` labels and `1.3–1.45` compact mobile line-heights.

## Layout
- **Thumb-Zone Priority**: Primary scan triggers, batch submit CTAs, and Quick-Add FAB sit in the bottom third of the viewport.
- **Role-Adaptive Navigation**:
  - `STAFF` sees 4 focused destinations: **Kho hàng**, **Tiêu thụ**, **Kiểm kê**, **Tài khoản**.
  - `MANAGER` sees 5 destinations: **Tổng quan**, **Kho hàng**, **Tiêu thụ**, **Kiểm kê**, **Dự báo AI**.
- **Safe Area Compliance**: Every top-level screen respects notch/status-bar and gesture-home insets via `react-native-safe-area-context`.

## Elevation & Depth
- Light mode relies on crisp `1px` structural borders (`#D1DCE5`) and soft subtle elevation (`elevation: 2`) on floating scan/add triggers.
- Dark mode communicates depth through tonal surface shifts (`#12181F` canvas -> `#1B242E` cards -> `#24303D` inputs/chips) rather than heavy drop shadows.

## Shapes
- Cards and containers use `16px` (`lg`) radius for a grounded industrial utility look.
- Action buttons, inputs, and stepper controls use `12px` (`md`) radius.
- Status badges and unit chips use pill rounding (`999px`) with generous horizontal padding (`>= 10px`).

## Components
- **Touch Targets**: All interactive buttons, steppers (`-1`, `+1`, `-5`), tab buttons, and gauge presets enforce a minimum `48dp` hit height/width and `>= 8px` gap between adjacent touch targets.
- **Lists**: All inventory catalogs, ledger feeds, forecast rankings, and stocktake queues render via virtualized `FlatList` with `React.memo` row components, `useCallback` renderers, and stable entity IDs as keys.
- **Feedback**: Every barcode scan, stock deduction, and approval emits immediate visual press feedback (`android_ripple` + opacity scale) and typed native haptic confirmation (`expo-haptics`).

## Do's and Don'ts
- **Do** support system Light and Dark mode dynamically via `useColorScheme` plus manual toggle.
- **Do** show explicit offline queue status and server connection controls for field reliability.
- **Don't** put `.map()` list loops inside `ScrollView`.
- **Don't** store authentication JWTs in unencrypted `AsyncStorage` on native platforms; always use `expo-secure-store`.
- **Don't** use pure `#000000` black or any purple/violet colors.
