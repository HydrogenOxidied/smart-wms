import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, isOfflineNetworkError } from '../services/apiClient';
import { useOfflineQueueStore } from '../store/offlineQueueStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Product, UnitMode } from '../types/wms';
import {
  createIdempotencyKey,
  formatNumber,
  triggerLightHaptic,
  triggerSuccessHaptic,
} from '../utils/formatters';
import { ActionButton, ChipOption, ChipRow, StatusPill } from './CommonUI';

const UNIT_MODE_OPTIONS: ChipOption[] = [
  { key: 'BASE', label: 'Đơn vị lẻ' },
  { key: 'PACK', label: 'Thùng / Bịch nguyên' },
];

export function RestockSlideModal({
  visible,
  product,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const enqueueMovement = useOfflineQueueStore((s) => s.enqueueMovement);

  const [qtyText, setQtyText] = useState('10');
  const [unitMode, setUnitMode] = useState<UnitMode>('BASE');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const trackWidthRef = useRef(1);

  useEffect(() => {
    if (visible && product) {
      setQtyText(product.unit === 'Thùng' ? '5' : '10');
      setUnitMode('BASE');
      setNote('');
      setErrorMsg(null);
    }
  }, [visible, product]);

  const numericQty = useMemo(() => {
    const parsed = Number(qtyText.replace(',', '.'));
    if (Number.isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  }, [qtyText]);

  const supportsPackMode = Boolean(
    product && product.tracking_type === 'PACK_BREAK' && product.pack_unit && product.pack_conversion_rate > 1,
  );
  const effectiveUnitMode: UnitMode = supportsPackMode ? unitMode : 'BASE';
  const activeUnitLabel =
    effectiveUnitMode === 'PACK' && product?.pack_unit ? product.pack_unit : product?.unit || '';

  const baseSliderMax = effectiveUnitMode === 'PACK' || product?.unit === 'Thùng' ? 50 : 100;
  const effectiveMax = Math.max(baseSliderMax, Math.ceil(numericQty));
  const sliderRatio = Math.max(0, Math.min(1, numericQty / effectiveMax));

  const updateFromTouchX = useCallback(
    (locX: number) => {
      const clamped = Math.max(0, Math.min(1, locX / Math.max(1, trackWidthRef.current)));
      const nextVal = Math.max(1, Math.round(clamped * baseSliderMax));
      setQtyText(String(nextVal));
    },
    [baseSliderMax],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          void triggerLightHaptic();
          updateFromTouchX(evt.nativeEvent.locationX);
        },
        onPanResponderMove: (evt) => {
          updateFromTouchX(evt.nativeEvent.locationX);
        },
      }),
    [updateFromTouchX],
  );

  const addedBaseQty = useMemo(() => {
    if (!product) return 0;
    if (effectiveUnitMode === 'PACK' && product.pack_conversion_rate > 1) {
      return Number((numericQty * product.pack_conversion_rate).toFixed(3));
    }
    return Number(numericQty.toFixed(3));
  }, [product, effectiveUnitMode, numericQty]);

  const adjustQty = useCallback(
    (delta: number) => {
      void triggerLightHaptic();
      const next = Math.max(1, Math.round((numericQty + delta) * 100) / 100);
      setQtyText(String(next));
    },
    [numericQty],
  );

  const handleConfirm = useCallback(async () => {
    if (!product) return;
    if (numericQty <= 0) {
      setErrorMsg('Số lượng nhập thêm phải lớn hơn 0.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    const payload = {
      product_id: product.id,
      movement_type: 'IN_PURCHASE' as const,
      quantity: numericQty,
      unit_mode: effectiveUnitMode,
      note: note.trim() || 'Nhập thêm hàng vào kho',
      idempotency_key: createIdempotencyKey('restock'),
    };

    try {
      const mv = await api.createMovement(payload);
      await triggerSuccessHaptic();
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['product-ledger', product.id] });
      void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
      onSuccess(
        `Đã nhập thêm +${formatNumber(mv.quantity_delta)} ${product.unit} cho "${product.name}". Tồn mới: ${formatNumber(mv.balance_after)} ${product.unit}.`,
      );
    } catch (err) {
      if (isOfflineNetworkError(err)) {
        await enqueueMovement(product.name, product.unit, payload);
        onSuccess(
          `Mất mạng: Đã xếp hàng đợi Offline nhập +${formatNumber(addedBaseQty)} ${product.unit} "${product.name}".`,
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Không thể nhập thêm hàng.');
      }
    } finally {
      setSaving(false);
    }
  }, [
    product,
    numericQty,
    effectiveUnitMode,
    note,
    queryClient,
    onSuccess,
    enqueueMovement,
    addedBaseQty,
  ]);

  const sections = ['summary', 'controls', 'presets'];

  const renderSection = useCallback(
    ({ item }: { item: string }) => {
      if (!product) return null;

      if (item === 'summary') {
        const projected = Number((product.current_stock + addedBaseQty).toFixed(3));
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.flexOne}>
                <Text style={[styles.productTitle, { color: theme.text }]} numberOfLines={2}>
                  {product.name}
                </Text>
                <Text style={[styles.subText, { color: theme.textMuted }]}>
                  SKU: {product.sku} · Tối thiểu: {formatNumber(product.min_stock_level)} {product.unit}
                </Text>
              </View>
              <StatusPill text={`Hiện có: ${formatNumber(product.current_stock)} ${product.unit}`} tone="secondary" />
            </View>

            <View style={[styles.previewBanner, { backgroundColor: theme.primarySoft }]}>
              <Text style={[styles.previewText, { color: theme.text }]}>
                Sau khi nhập (+{formatNumber(addedBaseQty)} {product.unit}):{' '}
                {formatNumber(projected)} {product.unit}
              </Text>
            </View>

            {supportsPackMode ? (
              <View style={styles.gapXs}>
                <Text style={[styles.subText, { color: theme.textMuted }]}>
                  Đơn vị nhập (1 {product.pack_unit} = {product.pack_conversion_rate} {product.unit}):
                </Text>
                <ChipRow
                  options={UNIT_MODE_OPTIONS}
                  selectedKey={effectiveUnitMode}
                  onSelect={(k) => setUnitMode(k as UnitMode)}
                />
              </View>
            ) : null}
          </View>
        );
      }

      if (item === 'controls') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                Kéo thanh trượt hoặc điền số ({activeUnitLabel})
              </Text>
              <StatusPill text={`${formatNumber(numericQty)} ${activeUnitLabel}`} tone="primary" />
            </View>

            <View
              {...panResponder.panHandlers}
              onLayout={(e) => {
                trackWidthRef.current = Math.max(1, e.nativeEvent.layout.width);
              }}
              accessibilityLabel="Thanh trượt chọn số lượng nhập thêm"
              style={styles.sliderTouchArea}
            >
              <View
                pointerEvents="none"
                style={[styles.sliderTrack, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              >
                {sliderRatio > 0 ? (
                  <View style={[styles.sliderFill, { flex: sliderRatio, backgroundColor: theme.primary }]} />
                ) : null}
                {1 - sliderRatio > 0 ? (
                  <View style={[styles.sliderRemain, { flex: 1 - sliderRatio }]} />
                ) : null}
              </View>
            </View>

            <View style={styles.rowBetween}>
              <Text style={[styles.scaleLabel, { color: theme.textMuted }]}>0</Text>
              <Text style={[styles.scaleLabel, { color: theme.textMuted }]}>
                {Math.round(effectiveMax / 2)}
              </Text>
              <Text style={[styles.scaleLabel, { color: theme.textMuted }]}>
                {effectiveMax} {activeUnitLabel}
              </Text>
            </View>

            <View style={styles.numberFieldRow}>
              <Pressable
                onPress={() => adjustQty(-1)}
                accessibilityRole="button"
                accessibilityLabel="Giảm 1 đơn vị"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.stepperBtn,
                  {
                    backgroundColor: theme.surfaceAlt,
                    borderColor: theme.border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons name="remove" size={22} color={theme.text} />
              </Pressable>

              <TextInput
                value={qtyText}
                onChangeText={setQtyText}
                keyboardType="numeric"
                selectTextOnFocus
                accessibilityLabel="Ô điền số lượng nhập thêm"
                placeholder="0"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.numberInput,
                  {
                    backgroundColor: theme.surfaceAlt,
                    color: theme.text,
                    borderColor: theme.primary,
                  },
                ]}
              />

              <Pressable
                onPress={() => adjustQty(1)}
                accessibilityRole="button"
                accessibilityLabel="Tăng 1 đơn vị"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.stepperBtn,
                  {
                    backgroundColor: theme.primarySoft,
                    borderColor: theme.primary,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons name="add" size={22} color={theme.primary} />
              </Pressable>
            </View>
          </View>
        );
      }

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.subText, { color: theme.textMuted }]}>Cộng nhanh số lượng:</Text>
          <View style={styles.presetRow}>
            <ActionButton label="+5" variant="outline" style={styles.flexOne} onPress={() => adjustQty(5)} />
            <ActionButton label="+10" variant="outline" style={styles.flexOne} onPress={() => adjustQty(10)} />
            <ActionButton label="+20" variant="outline" style={styles.flexOne} onPress={() => adjustQty(20)} />
            <ActionButton label="+50" variant="outline" style={styles.flexOne} onPress={() => adjustQty(50)} />
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Ghi chú nhập lô (VD: Nhập sỉ đầu tuần, NCC giao...)"
            placeholderTextColor={theme.textMuted}
            style={[
              styles.noteInput,
              { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
            ]}
          />
        </View>
      );
    },
    [
      product,
      theme,
      addedBaseQty,
      supportsPackMode,
      effectiveUnitMode,
      activeUnitLabel,
      numericQty,
      panResponder.panHandlers,
      sliderRatio,
      effectiveMax,
      qtyText,
      note,
      adjustQty,
    ],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
        <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <View style={styles.flexOne}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Nhập thêm hàng đã có</Text>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Ghi nhận vào Sổ cái tồn kho (IN_PURCHASE)
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Đóng bảng nhập thêm hàng"
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.closeBtn,
              { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.flexOne}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlatList
            data={sections}
            renderItem={renderSection}
            keyExtractor={(s) => s}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        </KeyboardAvoidingView>

        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          {errorMsg ? <Text style={[styles.errText, { color: theme.danger }]}>{errorMsg}</Text> : null}
          <ActionButton
            label={`Xác nhận nhập +${formatNumber(numericQty)} ${activeUnitLabel}`}
            icon="checkmark-circle-outline"
            loading={saving}
            onPress={() => void handleConfirm()}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.md,
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  closeBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  productTitle: { fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  subText: { fontSize: 13, lineHeight: 19 },
  gapXs: { gap: SPACING.xs },
  previewBanner: {
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  previewText: { fontSize: 14, fontWeight: '600' },
  sliderTouchArea: {
    minHeight: TOUCH_MIN,
    justifyContent: 'center',
  },
  sliderTrack: {
    flexDirection: 'row',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  sliderFill: {
    paddingVertical: 11,
  },
  sliderRemain: {
    paddingVertical: 11,
    backgroundColor: 'transparent',
  },
  scaleLabel: { fontSize: 12 },
  numberFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stepperBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numberInput: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    paddingHorizontal: SPACING.md,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  noteInput: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
  footer: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
  errText: { fontSize: 13, fontWeight: '500' },
});
