/**
 * Design tokens synchronized with f:\gayt\smart-wms\DESIGN.md (Industrial Emerald PocketWMS).
 * Strictly avoids pure #000000 black and any purple/violet hex codes.
 */
export interface ThemePalette {
  mode: 'light' | 'dark';
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primaryTextOn: string;
  secondary: string;
  secondarySoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  ripple: string;
}

export const LIGHT_PALETTE: ThemePalette = {
  mode: 'light',
  bg: '#F4F7F9',
  surface: '#FFFFFF',
  surfaceAlt: '#E9EFF4',
  border: '#D1DCE5',
  text: '#111827',
  textMuted: '#4B5563',
  primary: '#059669',
  primaryPressed: '#047857',
  primarySoft: '#D1FAE5',
  primaryTextOn: '#FFFFFF',
  secondary: '#0284C7',
  secondarySoft: '#E0F2FE',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  ripple: 'rgba(5, 150, 105, 0.16)',
};

export const DARK_PALETTE: ThemePalette = {
  mode: 'dark',
  bg: '#12181F',
  surface: '#1B242E',
  surfaceAlt: '#24303D',
  border: '#2E3D4D',
  text: '#E8EEF2',
  textMuted: '#9CA3AF',
  primary: '#10B981',
  primaryPressed: '#059669',
  primarySoft: '#064E3B',
  primaryTextOn: '#0F172A',
  secondary: '#38BDF8',
  secondarySoft: '#0C4A6E',
  warning: '#F59E0B',
  warningSoft: '#78350F',
  danger: '#F87171',
  dangerSoft: '#7F1D1D',
  ripple: 'rgba(16, 185, 129, 0.22)',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const TOUCH_MIN = 48;
