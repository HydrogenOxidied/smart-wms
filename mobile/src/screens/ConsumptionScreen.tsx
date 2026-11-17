import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ActionButton, ChipOption, ChipRow, StatusPill } from '../components/CommonUI';
import { ApiHttpError, api, isOfflineNetworkError } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useOfflineQueueStore } from '../store/offlineQueueStore';
import { useUiStore } from '../store/uiStore';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { MovementCreateInput, Product, UnitMode } from '../types/wms';
import {
  createIdempotencyKey,
  formatNumber,
  triggerLightHaptic,
  triggerSuccessHaptic,
  triggerWarningHaptic,
} from '../utils/formatters';

type ActionMode = 'out_single' | 'stockin' | 'out_batch';

const MANAGER_MODE_TABS: ChipOption[] = [
  { key: 'out_single', label: 'Xuất tiêu hao (-)' },
  { key: 'stockin', label: 'Nhập thêm hàng (+)' },
  { key: 'out_batch', label: 'Chốt nhanh cuối ca' },
];

const STAFF_MODE_TABS: ChipOption[] = [
  { key: 'out_single', label: 'Xuất tiêu hao (-)' },
  { key: 'out_batch', label: 'Chốt nhanh cuối ca' },
];

const OUT_REASON_OPTIONS: ChipOption[] = [
  { key: 'OUT_CONSUMPTION', label: 'Tiêu hao / Bán ra (AI học)' },
  { key: 'OUT_DAMAGE_EXPIRED', label: 'Hàng hỏng / Hủy (Loại khỏi AI)' },
];

const ShiftItemRow = React.memo(
  ({
    product,
    qty,
    onChangeQty,
  }: {
    product: Product;
    qty: number;
    onChangeQty: (productId: number, nextQty: number) => void;
  }) => {
    const theme = useTheme();
    const afterQty = Number((product.current_stock - qty).toFixed(3));
    return (
      <View style={[styles.shiftCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.flexOne}>
          <View style={styles.rowGap}>
            {product.is_pinned ? <StatusPill text="Hay dùng" tone="primary" /> : null}
            <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
              {product.name}
            </Text>
          </View>
          <Text style={[styles.subText, { color: qty > 0 ? theme.danger : theme.textMuted }]}>
            Hiện có: {formatNumber(product.current_stock)} {product.unit}
            {qty > 0 ? ` → Trừ ${qty} → Còn: ${formatNumber(afterQty)} ${product.unit}` : ''}
          </Text>
        </View>

        <View style={styles.stepperWrap}>
          <Pressable
            onPress={() => {
              void triggerLightHaptic();
              onChangeQty(product.id, Math.max(0, qty - 1));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Giảm số lượng chốt ca cho ${product.name}`}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.stepBtn,
              { backgroundColor: theme.surfaceAlt, borderColor: theme.border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="remove" size={20} color={theme.text} />
          </Pressable>
          <Text style={[styles.stepVal, { color: qty > 0 ? theme.primary : theme.textMuted }]}>
            {qty}
          </Text>
          <Pressable
            onPress={() => {
              void triggerLightHaptic();
              onChangeQty(product.id, qty + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Tăng số lượng chốt ca cho ${product.name}`}
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.stepBtn,
              { backgroundColor: theme.primarySoft, borderColor: theme.primary, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="add" size={20} color={theme.primary} />
          </Pressable>
        </View>
      </View>
    );
  },
);

export function ConsumptionScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const store = useAuthStore((s) => s.store);
  const isManager = user?.role === 'MANAGER';
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const { pending, enqueueMovement, flushQueue } = useOfflineQueueStore();

  const [mode, setMode] = useState<ActionMode>('out_single');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [qtyText, setQtyText] = useState('1');
  const [reason, setReason] = useState<'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED'>('OUT_CONSUMPTION');
  const [unitMode, setUnitMode] = useState<UnitMode>('BASE');
  const [note, setNote] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [showAuditLink, setShowAuditLink] = useState(false);
  const [anomalyPending, setAnomalyPending] = useState<{
    message: string;
    payload: MovementCreateInput;
  } | null>(null);
  const [shiftQuantities, setShiftQuantities] = useState<Record<number, number>>({});
  const trackWidthRef = useRef(1);

  useEffect(() => {
    if (!isManager && mode === 'stockin') {
      setMode('out_single');
    }
  }, [isManager, mode]);

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: () => api.listProducts(),
  });

  const products = productsQuery.data || [];
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q)),
    );
  }, [products, productSearch]);

  const activeProduct = useMemo(
    () =>
      filteredProducts.find((p) => p.id === selectedProductId) ||
      filteredProducts[0] ||
      products.find((p) => p.id === selectedProductId) ||
      products[0] ||
      null,
    [filteredProducts, products, selectedProductId],
  );

  const productChipOptions = useMemo<ChipOption[]>(
    () =>
      filteredProducts.map((p) => ({
        key: String(p.id),
        label: `${p.name} (${formatNumber(p.current_stock)} ${p.unit})`,
      })),
    [filteredProducts],
  );

  const numericQty = useMemo(() => {
    const parsed = Number(qtyText.replace(',', '.'));
    if (Number.isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  }, [qtyText]);

  const supportsPackMode = Boolean(
    activeProduct &&
      activeProduct.tracking_type === 'PACK_BREAK' &&
      activeProduct.pack_unit &&
      activeProduct.pack_conversion_rate > 1,
  );
  const effectiveUnitMode: UnitMode = supportsPackMode ? unitMode : 'BASE';
  const activeUnitLabel =
    effectiveUnitMode === 'PACK' && activeProduct?.pack_unit
      ? activeProduct.pack_unit
      : activeProduct?.unit || 'ĐV';

  const unitModeOptions = useMemo<ChipOption[]>(() => {
    if (!activeProduct) return [{ key: 'BASE', label: 'Đơn vị lẻ' }];
    return [
      { key: 'BASE', label: `Đơn vị lẻ (${activeProduct.unit})` },
      {
        key: 'PACK',
        label: `Nguyên ${activeProduct.pack_unit || 'Thùng'} (×${activeProduct.pack_conversion_rate})`,
      },
    ];
  }, [activeProduct]);

  const baseDeltaQty = useMemo(() => {
    if (!activeProduct) return 0;
    if (effectiveUnitMode === 'PACK' && activeProduct.pack_conversion_rate > 1) {
      return Number((numericQty * activeProduct.pack_conversion_rate).toFixed(3));
    }
    return Number(numericQty.toFixed(3));
  }, [activeProduct, effectiveUnitMode, numericQty]);

  const isStockIn = mode === 'stockin';
  const sliderBaseMax = useMemo(() => {
    if (isStockIn) {
      return effectiveUnitMode === 'PACK' || activeProduct?.unit === 'Thùng' ? 50 : 100;
    }
    const stock = activeProduct?.current_stock || 0;
    const availInUnit =
      effectiveUnitMode === 'PACK' && activeProduct && activeProduct.pack_conversion_rate > 1
        ? Math.floor(stock / activeProduct.pack_conversion_rate)
        : stock;
    return Math.max(10, Math.min(100, Math.ceil(availInUnit || 20)));
  }, [isStockIn, effectiveUnitMode, activeProduct]);

  const effectiveSliderMax = Math.max(sliderBaseMax, Math.ceil(numericQty || 1));
  const sliderRatio = Math.max(0, Math.min(1, numericQty / effectiveSliderMax));

  const updateFromTouchX = useCallback(
    (locX: number) => {
      const clamped = Math.max(0, Math.min(1, locX / Math.max(1, trackWidthRef.current)));
      const nextVal = Math.max(1, Math.round(clamped * sliderBaseMax));
      setQtyText(String(nextVal));
    },
    [sliderBaseMax],
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

  const adjustQty = useCallback(
    (delta: number) => {
      void triggerLightHaptic();
      const next = Math.max(1, Math.round((numericQty + delta) * 100) / 100);
      setQtyText(String(next));
    },
    [numericQty],
  );

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
    void queryClient.invalidateQueries({ queryKey: ['movements-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['forecast-overview'] });
  }, [queryClient]);

  const submitMovementPayload = useCallback(
    async (payload: MovementCreateInput, product: Product) => {
      setSubmitting(true);
      setStatusMsg(null);
      setShowAuditLink(false);
      try {
        const created = await api.createMovement(payload);
        await triggerSuccessHaptic();
        setAnomalyPending(null);
        setNote('');
        setQtyText(payload.movement_type === 'IN_PURCHASE' ? '5' : '1');
        const beforeVal =
          typeof created.balance_before === 'number'
            ? created.balance_before
            : Number((created.balance_after - created.quantity_delta).toFixed(3));
        const deltaStr =
          created.quantity_delta > 0
            ? `+${formatNumber(created.quantity_delta)}`
            : formatNumber(created.quantity_delta);
        setStatusMsg(
          `Đã ghi sổ (${user?.full_name || 'Hệ thống'}): "${product.name}" từ ${formatNumber(beforeVal)} → (${deltaStr} ${product.unit}) → Còn ${formatNumber(created.balance_after)} ${product.unit}.`,
        );
        setShowAuditLink(true);
        refreshAll();
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          await triggerWarningHaptic();
          setAnomalyPending({ message: err.message, payload });
          return;
        }
        if (isOfflineNetworkError(err)) {
          await enqueueMovement(product.name, product.unit, payload);
          setStatusMsg(
            `Mất kết nối: Đã lưu giao dịch "${product.name}" vào hàng đợi Offline để đồng bộ sau.`,
          );
          return;
        }
        setStatusMsg(err instanceof Error ? err.message : 'Lỗi ghi nhận giao dịch.');
      } finally {
        setSubmitting(false);
      }
    },
    [enqueueMovement, refreshAll, user?.full_name],
  );

  const handleSingleSubmit = useCallback(() => {
    if (!activeProduct) return;
    if (numericQty <= 0) {
      setStatusMsg('Số lượng phải lớn hơn 0.');
      return;
    }
    const mvType: MovementCreateInput['movement_type'] = isStockIn ? 'IN_PURCHASE' : reason;
    const payload: MovementCreateInput = {
      product_id: activeProduct.id,
      movement_type: mvType,
      quantity: numericQty,
      unit_mode: effectiveUnitMode,
      note:
        note.trim() ||
        (isStockIn
          ? 'Chủ kho nhập thêm hàng'
          : reason === 'OUT_DAMAGE_EXPIRED'
            ? 'Ghi nhận hàng hỏng / hủy'
            : undefined),
      idempotency_key: createIdempotencyKey(isStockIn ? 'in' : 'out'),
      confirm_anomaly: false,
    };
    void submitMovementPayload(payload, activeProduct);
  }, [activeProduct, numericQty, isStockIn, reason, effectiveUnitMode, note, submitMovementPayload]);

  const handleBarcodeScan = useCallback(
    (code: string) => {
      setScannerOpen(false);
      const found = products.find(
        (p) => p.barcode === code || p.sku.toUpperCase() === code.toUpperCase(),
      );
      if (!found) {
        setStatusMsg(`Không tìm thấy sản phẩm khớp mã "${code}".`);
        return;
      }
      setProductSearch('');
      setSelectedProductId(found.id);
      setStatusMsg(`Đã chọn "${found.name}" qua mã vạch ${code}.`);
    },
    [products],
  );

  const handleShiftChange = useCallback((productId: number, nextQty: number) => {
    setShiftQuantities((prev) => ({ ...prev, [productId]: nextQty }));
  }, []);

  const shiftSummary = useMemo(() => {
    let selectedItems = 0;
    let totalQty = 0;
    for (const qty of Object.values(shiftQuantities)) {
      if (qty > 0) {
        selectedItems += 1;
        totalQty += qty;
      }
    }
    return { selectedItems, totalQty: Number(totalQty.toFixed(3)) };
  }, [shiftQuantities]);

  const handleSubmitShiftBatch = useCallback(async () => {
    const entries = Object.entries(shiftQuantities).filter(([, qty]) => qty > 0);
    if (entries.length === 0) {
      setStatusMsg('Hãy tăng số lượng ít nhất 1 mặt hàng đã tiêu trong ca.');
      return;
    }

    const batchItems: MovementCreateInput[] = entries.map(([pidStr, qty]) => ({
      product_id: Number(pidStr),
      movement_type: 'OUT_CONSUMPTION',
      quantity: qty,
      unit_mode: 'BASE',
      note: 'Chốt tiêu thụ cuối ca',
      idempotency_key: createIdempotencyKey(`shift-${pidStr}`),
      confirm_anomaly: true,
    }));

    setSubmitting(true);
    setStatusMsg(null);
    setShowAuditLink(false);
    try {
      const res = await api.createBatchMovements(batchItems);
      await triggerSuccessHaptic();
      setShiftQuantities({});
      setStatusMsg(
        `Đã chốt ca thành công ${res.processed_count} mặt hàng vào sổ cái kiểm kê (${user?.full_name}).`,
      );
      setShowAuditLink(true);
      refreshAll();
    } catch (err) {
      if (isOfflineNetworkError(err)) {
        for (const item of batchItems) {
          const prod = products.find((p) => p.id === item.product_id);
          await enqueueMovement(prod?.name || `SP #${item.product_id}`, prod?.unit || 'ĐV', item);
        }
        setShiftQuantities({});
        setStatusMsg(`Đang Offline: Đã đưa ${batchItems.length} dòng chốt ca vào hàng đợi đồng bộ.`);
      } else {
        setStatusMsg(err instanceof Error ? err.message : 'Lỗi chốt ca.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [shiftQuantities, products, enqueueMovement, refreshAll, user?.full_name]);

  const singleFormSections = ['picker', 'slider', 'preview'];

  const renderSingleForm = useCallback(
    ({ item }: { item: string }) => {
      if (item === 'picker') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                1. Chọn mặt hàng cần {isStockIn ? 'Nhập thêm' : 'Xuất kho'}
              </Text>
              <ActionButton
                label="Quét mã"
                icon="barcode-outline"
                variant="secondary"
                onPress={() => setScannerOpen(true)}
              />
            </View>
            <TextInput
              value={productSearch}
              onChangeText={setProductSearch}
              placeholder="Tìm nhanh theo tên hoặc SKU..."
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
            {productChipOptions.length > 0 ? (
              <ChipRow
                options={productChipOptions}
                selectedKey={activeProduct ? String(activeProduct.id) : ''}
                onSelect={(k) => {
                  setSelectedProductId(Number(k));
                  setUnitMode('BASE');
                }}
              />
            ) : (
              <Text style={[styles.subText, { color: theme.textMuted }]}>
                Không có mặt hàng khớp từ khóa "{productSearch}".
              </Text>
            )}
          </View>
        );
      }

      if (item === 'slider') {
        const fillColor = isStockIn
          ? theme.primary
          : reason === 'OUT_DAMAGE_EXPIRED'
            ? theme.danger
            : theme.secondary;

        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>
                2. {isStockIn ? 'Kéo thanh hoặc điền số lượng Nhập' : 'Kéo thanh hoặc điền số lượng Xuất'}
              </Text>
              <StatusPill
                text={`${isStockIn ? '+' : '-'}${formatNumber(numericQty)} ${activeUnitLabel}`}
                tone={isStockIn ? 'primary' : reason === 'OUT_DAMAGE_EXPIRED' ? 'danger' : 'warning'}
              />
            </View>

            {!isStockIn ? (
              <View style={styles.gapXs}>
                <Text style={[styles.subText, { color: theme.textMuted }]}>Lý do xuất kho:</Text>
                <ChipRow
                  options={OUT_REASON_OPTIONS}
                  selectedKey={reason}
                  onSelect={(k) => setReason(k as 'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED')}
                />
              </View>
            ) : null}

            {supportsPackMode && activeProduct ? (
              <View style={styles.gapXs}>
                <Text style={[styles.subText, { color: theme.textMuted }]}>Đơn vị thao tác:</Text>
                <ChipRow
                  options={unitModeOptions}
                  selectedKey={effectiveUnitMode}
                  onSelect={(k) => setUnitMode(k as UnitMode)}
                />
              </View>
            ) : null}

            <View
              {...panResponder.panHandlers}
              onLayout={(e) => {
                trackWidthRef.current = Math.max(1, e.nativeEvent.layout.width);
              }}
              accessibilityLabel="Thanh trượt chọn số lượng xuất nhập"
              style={styles.sliderTouchArea}
            >
              <View
                pointerEvents="none"
                style={[styles.sliderTrack, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
              >
                {sliderRatio > 0 ? (
                  <View style={[styles.sliderFill, { flex: sliderRatio, backgroundColor: fillColor }]} />
                ) : null}
                {1 - sliderRatio > 0 ? (
                  <View style={[styles.sliderRemain, { flex: 1 - sliderRatio }]} />
                ) : null}
              </View>
            </View>

            <View style={styles.rowBetween}>
              <Text style={[styles.scaleLabel, { color: theme.textMuted }]}>0</Text>
              <Text style={[styles.scaleLabel, { color: theme.textMuted }]}>
                {Math.round(effectiveSliderMax / 2)}
              </Text>
              <Text style={[styles.scaleLabel, { color: theme.textMuted }]}>
                {effectiveSliderMax} {activeUnitLabel}
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
                accessibilityLabel="Ô điền số lượng xuất nhập"
                placeholder="0"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.numberInput,
                  {
                    backgroundColor: theme.surfaceAlt,
                    color: theme.text,
                    borderColor: fillColor,
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
                    backgroundColor: isStockIn ? theme.primarySoft : theme.secondarySoft,
                    borderColor: fillColor,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons name="add" size={22} color={fillColor} />
              </Pressable>
            </View>

            {isStockIn ? (
              <View style={styles.presetRow}>
                <ActionButton label="+5" variant="outline" style={styles.flexOne} onPress={() => adjustQty(5)} />
                <ActionButton label="+10" variant="outline" style={styles.flexOne} onPress={() => adjustQty(10)} />
                <ActionButton label="+20" variant="outline" style={styles.flexOne} onPress={() => adjustQty(20)} />
                <ActionButton label="+50" variant="outline" style={styles.flexOne} onPress={() => adjustQty(50)} />
              </View>
            ) : (
              <View style={styles.presetRow}>
                <ActionButton label="1" variant="outline" style={styles.flexOne} onPress={() => setQtyText('1')} />
                <ActionButton label="2" variant="outline" style={styles.flexOne} onPress={() => setQtyText('2')} />
                <ActionButton label="5" variant="outline" style={styles.flexOne} onPress={() => setQtyText('5')} />
                <ActionButton label="10" variant="outline" style={styles.flexOne} onPress={() => setQtyText('10')} />
              </View>
            )}

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={
                isStockIn
                  ? 'Ghi chú nhập lô (VD: Nhập sỉ đầu tuần, NCC giao...)'
                  : 'Ghi chú xuất kho (VD: Ca sáng bán lẻ, đơn khách sỉ...)'
              }
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
          </View>
        );
      }

      if (!activeProduct) return null;
      const beforeStock = activeProduct.current_stock;
      const signedDelta = isStockIn ? baseDeltaQty : -baseDeltaQty;
      const projectedStock = Number((beforeStock + signedDelta).toFixed(3));
      const negativeBlocked = Boolean(!isStockIn && projectedStock < 0 && !store?.allow_negative_stock);

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            3. Kiểm tra minh bạch trước khi lưu sổ
          </Text>

          <View
            style={[
              styles.previewCard,
              {
                backgroundColor: isStockIn ? theme.primarySoft : theme.surfaceAlt,
                borderColor: negativeBlocked ? theme.danger : theme.border,
              },
            ]}
          >
            <Text style={[styles.previewProduct, { color: theme.text }]}>{activeProduct.name}</Text>
            <View style={styles.mathRow}>
              <View style={styles.mathCell}>
                <Text style={[styles.mathLabel, { color: theme.textMuted }]}>Tồn hiện tại</Text>
                <Text style={[styles.mathValue, { color: theme.text }]}>
                  {formatNumber(beforeStock)} {activeProduct.unit}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={theme.textMuted} />
              <View style={styles.mathCell}>
                <Text style={[styles.mathLabel, { color: theme.textMuted }]}>
                  {isStockIn ? 'Nhập thêm' : 'Xuất đi'}
                </Text>
                <Text style={[styles.mathValue, { color: isStockIn ? theme.primary : theme.danger }]}>
                  {isStockIn ? `+${formatNumber(baseDeltaQty)}` : `-${formatNumber(baseDeltaQty)}`}{' '}
                  {activeProduct.unit}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={theme.textMuted} />
              <View style={styles.mathCell}>
                <Text style={[styles.mathLabel, { color: theme.textMuted }]}>Tồn mới</Text>
                <Text
                  style={[
                    styles.mathValue,
                    { color: negativeBlocked ? theme.danger : theme.text },
                  ]}
                >
                  {formatNumber(projectedStock)} {activeProduct.unit}
                </Text>
              </View>
            </View>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Người ghi sổ: {user?.full_name} ({isManager ? 'Chủ kho' : 'Nhân viên'}) · Tự động lưu vào Lịch sử Kiểm kê
            </Text>
            {negativeBlocked ? (
              <Text style={[styles.warnText, { color: theme.danger }]}>
                Số lượng xuất vượt quá tồn hiện có ({formatNumber(beforeStock)} {activeProduct.unit}).
              </Text>
            ) : null}
          </View>

          {anomalyPending ? (
            <View style={[styles.anomalyBox, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
              <Text style={[styles.anomalyText, { color: theme.text }]}>{anomalyPending.message}</Text>
              <View style={styles.presetRow}>
                <ActionButton
                  label="Hủy (Gõ nhầm)"
                  variant="outline"
                  style={styles.flexOne}
                  onPress={() => setAnomalyPending(null)}
                />
                <ActionButton
                  label="Chắc chắn xuất"
                  variant="danger"
                  style={styles.flexOne}
                  loading={submitting}
                  onPress={() => {
                    void submitMovementPayload(
                      { ...anomalyPending.payload, confirm_anomaly: true },
                      activeProduct,
                    );
                  }}
                />
              </View>
            </View>
          ) : null}

          <ActionButton
            label={
              isStockIn
                ? `Xác nhận Nhập +${formatNumber(baseDeltaQty)} ${activeProduct.unit}`
                : reason === 'OUT_DAMAGE_EXPIRED'
                  ? `Ghi nhận Hàng hỏng -${formatNumber(baseDeltaQty)} ${activeProduct.unit}`
                  : `Xác nhận Xuất -${formatNumber(baseDeltaQty)} ${activeProduct.unit}`
            }
            icon={isStockIn ? 'arrow-down-circle-outline' : 'checkmark-done-outline'}
            variant={isStockIn ? 'primary' : reason === 'OUT_DAMAGE_EXPIRED' ? 'danger' : 'secondary'}
            loading={submitting}
            disabled={numericQty <= 0 || negativeBlocked}
            onPress={handleSingleSubmit}
          />
        </View>
      );
    },
    [
      theme,
      isStockIn,
      productSearch,
      productChipOptions,
      activeProduct,
      reason,
      numericQty,
      activeUnitLabel,
      supportsPackMode,
      unitModeOptions,
      effectiveUnitMode,
      panResponder.panHandlers,
      sliderRatio,
      effectiveSliderMax,
      qtyText,
      note,
      adjustQty,
      baseDeltaQty,
      store?.allow_negative_stock,
      user?.full_name,
      isManager,
      anomalyPending,
      submitting,
      submitMovementPayload,
      handleSingleSubmit,
    ],
  );

  const renderShiftRow = useCallback(
    ({ item }: { item: Product }) => (
      <ShiftItemRow
        product={item}
        qty={shiftQuantities[item.id] || 0}
        onChangeQty={handleShiftChange}
      />
    ),
    [shiftQuantities, handleShiftChange],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.topBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <ChipRow
          options={isManager ? MANAGER_MODE_TABS : STAFF_MODE_TABS}
          selectedKey={mode}
          onSelect={(k) => {
            setStatusMsg(null);
            setShowAuditLink(false);
            setAnomalyPending(null);
            const nextMode = k as ActionMode;
            setMode(nextMode);
            if (nextMode === 'stockin') {
              setQtyText('5');
            } else if (nextMode === 'out_single') {
              setQtyText('1');
            }
          }}
        />
        <View style={[styles.roleNoticeBar, { backgroundColor: theme.surfaceAlt }]}>
          <Ionicons
            name={isManager ? 'shield-checkmark-outline' : 'person-outline'}
            size={18}
            color={isManager ? theme.primary : theme.secondary}
          />
          <Text style={[styles.roleNoticeText, { color: theme.textMuted }]}>
            {user?.full_name} (@{user?.username}) ·{' '}
            {isManager
              ? 'Chủ kho: Được phép Xuất tiêu hao & Nhập thêm hàng'
              : 'Nhân viên: Xuất tiêu hao theo ca (Chỉ Chủ kho được Nhập thêm hàng)'}
          </Text>
        </View>
        {pending.length > 0 ? (
          <ActionButton
            label={`Đang có ${pending.length} giao dịch Offline — Đồng bộ ngay`}
            variant="warning"
            icon="cloud-upload-outline"
            onPress={() => void flushQueue().then(refreshAll)}
          />
        ) : null}
        {statusMsg ? (
          <View style={[styles.statusBox, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
            <Text style={[styles.statusMsg, { color: theme.text }]}>{statusMsg}</Text>
            {showAuditLink ? (
              <Pressable
                onPress={() => setActiveTab('stocktake')}
                accessibilityRole="button"
                accessibilityLabel="Xem lịch sử sửa đổi ở mục Kiểm kê"
                style={({ pressed }) => [styles.auditLinkBtn, { opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.auditLinkText, { color: theme.primary }]}>
                  Xem lịch sử sửa đổi trong mục Kiểm kê →
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {mode === 'out_batch' ? (
        <View style={styles.flexOne}>
          <FlatList
            data={products}
            renderItem={renderShiftRow}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
          />
          <View style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Đã chọn: {shiftSummary.selectedItems} mặt hàng · Tổng trừ ca: -{formatNumber(shiftSummary.totalQty)} ĐV
            </Text>
            <ActionButton
              label="Gửi Chốt tiêu thụ cuối ca"
              icon="send-outline"
              variant="secondary"
              loading={submitting}
              disabled={shiftSummary.selectedItems === 0}
              onPress={() => void handleSubmitShiftBatch()}
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={singleFormSections}
          renderItem={renderSingleForm}
          keyExtractor={(i) => i}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Quét mã sản phẩm Xuất / Nhập"
        onScan={handleBarcodeScan}
        onClose={() => setScannerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  topBar: {
    padding: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.sm,
  },
  roleNoticeBar: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  roleNoticeText: { fontSize: 12, flex: 1 },
  statusBox: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  statusMsg: { fontSize: 13, fontWeight: '500', lineHeight: 19 },
  auditLinkBtn: {
    minHeight: TOUCH_MIN,
    justifyContent: 'center',
  },
  auditLinkText: { fontSize: 13, fontWeight: '700' },
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
  shiftCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  gapXs: { gap: SPACING.xs },
  sectionTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', flex: 1 },
  subText: { fontSize: 13, lineHeight: 18 },
  presetRow: { flexDirection: 'row', gap: SPACING.sm },
  input: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
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
  previewCard: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  previewProduct: { fontSize: 14, fontWeight: '700' },
  mathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.xs,
  },
  mathCell: { flex: 1, alignItems: 'center', gap: 2 },
  mathLabel: { fontSize: 11 },
  mathValue: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  warnText: { fontSize: 12, fontWeight: '600' },
  anomalyBox: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  anomalyText: { fontSize: 13, fontWeight: '500' },
  stepperWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stepBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepVal: {
    fontSize: 17,
    fontWeight: '700',
    minWidth: TOUCH_MIN,
    textAlign: 'center',
  },
  bottomBar: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
});
