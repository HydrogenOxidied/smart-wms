import { useColorScheme } from 'react-native';
import { useUiStore } from '../store/uiStore';
import { DARK_PALETTE, LIGHT_PALETTE, ThemePalette } from './tokens';

export function useTheme(): ThemePalette {
  const systemScheme = useColorScheme();
  const themePref = useUiStore((s) => s.themePref);

  if (themePref === 'dark') return DARK_PALETTE;
  if (themePref === 'light') return LIGHT_PALETTE;
  return systemScheme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}
