import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { triggerLightHaptic } from '../utils/formatters';

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'warning';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
}: ActionButtonProps) {
  const theme = useTheme();

  let bg = theme.primary;
  let fg = theme.primaryTextOn;
  let borderColor = 'transparent';

  if (variant === 'secondary') {
    bg = theme.secondary;
    fg = '#F8FAFC';
  } else if (variant === 'danger') {
    bg = theme.danger;
    fg = '#F8FAFC';
  } else if (variant === 'warning') {
    bg = theme.warning;
    fg = '#111827';
  } else if (variant === 'outline') {
    bg = theme.surfaceAlt;
    fg = theme.text;
    borderColor = theme.border;
  }

  const handlePress = useCallback(() => {
    if (disabled || loading) return;
    void triggerLightHaptic();
    onPress();
  }, [disabled, loading, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      android_ripple={{ color: theme.ripple }}
      style={({ pressed }) => [
        styles.buttonBase,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'outline' ? 1 : 0,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

interface StatusPillProps {
  text: string;
  tone: 'primary' | 'secondary' | 'warning' | 'danger' | 'neutral';
}

export function StatusPill({ text, tone }: StatusPillProps) {
  const theme = useTheme();
  const map = {
    primary: { bg: theme.primarySoft, fg: theme.mode === 'dark' ? '#6EE7B7' : '#065F46' },
    secondary: { bg: theme.secondarySoft, fg: theme.mode === 'dark' ? '#7DD3FC' : '#0369A1' },
    warning: { bg: theme.warningSoft, fg: theme.mode === 'dark' ? '#FCD34D' : '#92400E' },
    danger: { bg: theme.dangerSoft, fg: theme.mode === 'dark' ? '#FCA5A5' : '#991B1B' },
    neutral: { bg: theme.surfaceAlt, fg: theme.textMuted },
  }[tone];

  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      <Text style={[styles.pillText, { color: map.fg }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function GaugeBar({
  ratio,
  tone = 'primary',
}: {
  ratio: number;
  tone?: 'primary' | 'warning' | 'danger' | 'secondary';
}) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, ratio));
  const fillColor = {
    primary: theme.primary,
    warning: theme.warning,
    danger: theme.danger,
    secondary: theme.secondary,
  }[tone];

  return (
    <View style={[styles.gaugeTrack, { backgroundColor: theme.surfaceAlt }]}>
      {clamped > 0 ? (
        <View style={[styles.gaugeSegment, { flex: clamped, backgroundColor: fillColor }]} />
      ) : null}
      {1 - clamped > 0 ? (
        <View style={[styles.gaugeSegment, { flex: 1 - clamped, backgroundColor: 'transparent' }]} />
      ) : null}
    </View>
  );
}

export interface ChipOption {
  key: string;
  label: string;
}

const ChipItem = React.memo(
  ({
    option,
    active,
    onSelect,
  }: {
    option: ChipOption;
    active: boolean;
    onSelect: (key: string) => void;
  }) => {
    const theme = useTheme();
    return (
      <Pressable
        onPress={() => {
          void triggerLightHaptic();
          onSelect(option.key);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Chọn ${option.label}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.chipBtn,
          {
            backgroundColor: active ? theme.primary : theme.surfaceAlt,
            borderColor: active ? theme.primary : theme.border,
            opacity: pressed ? 0.84 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.chipText,
            { color: active ? theme.primaryTextOn : theme.text },
          ]}
          numberOfLines={1}
        >
          {option.label}
        </Text>
      </Pressable>
    );
  },
);

export function ChipRow({
  options,
  selectedKey,
  onSelect,
}: {
  options: ChipOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: ChipOption }) => (
      <ChipItem option={item} active={item.key === selectedKey} onSelect={onSelect} />
    ),
    [selectedKey, onSelect],
  );

  const keyExtractor = useCallback((item: ChipOption) => item.key, []);

  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={options}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.chipListContainer}
    />
  );
}

export function SegmentedToggle({
  options,
  selectedKey,
  onSelect,
}: {
  options: ChipOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segTrack, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
      {options.map((opt) => {
        const active = opt.key === selectedKey;
        return (
          <Pressable
            key={opt.key}
            onPress={() => {
              if (!active) {
                void triggerLightHaptic();
                onSelect(opt.key);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.segItem,
              {
                backgroundColor: active ? theme.primary : 'transparent',
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.segText,
                { color: active ? theme.primaryTextOn : theme.textMuted },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(_error: Error): void {
    // Error state already captured for recovery UI
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorHeading}>Ứng dụng gặp sự cố hiển thị</Text>
          <Text style={styles.errorDetail}>{this.state.message}</Text>
          <ActionButton
            label="Thử khôi phục"
            onPress={() => this.setState({ hasError: false, message: '' })}
            accessibilityLabel="Thử khôi phục ứng dụng"
          />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  buttonBase: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  gaugeTrack: {
    flexDirection: 'row',
    borderRadius: RADIUS.full,
    overflow: 'hidden',
    width: '100%',
  },
  gaugeSegment: {
    paddingVertical: 5,
  },
  chipListContainer: {
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  chipBtn: {
    minHeight: TOUCH_MIN,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  segTrack: {
    flexDirection: 'row',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: 3,
    gap: 4,
  },
  segItem: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    padding: SPACING.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F4F7F9',
    gap: SPACING.md,
  },
  errorHeading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  errorDetail: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
  },
});
