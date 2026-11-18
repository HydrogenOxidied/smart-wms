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
import {
  ActionButton,
  ChipOption,
  ChipRow,
  SegmentedToggle,
  StatusPill,
} from '../components/CommonUI';
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
  { key: 'out_single', label: 'Xuất kho (-)' },
  { key: 'stockin', label: 'Nhập kho (+)' },
  { key: 'out_batch', label: 'Chốt cuối ca' },
];

const STAFF_MODE_TABS: ChipOption[] = [
  { key: 'out_single', label: 'Xuất kho (-)' },
  { key: 'out_batch', label: 'Chốt cuối ca' },
];

const OUT_REASON_OPTIONS: ChipOption[] = [
  { key: 'OUT_CONSUMPTION', label: 'Tiêu hao / Bán' },
  { key: 'OUT_DAMAGE_EXPIRED', label: 'Hàng hỏng / Hủy' },
];

const SINGLE_FORM_SECTIONS = ['picker', 'controls'];

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
          <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
            {product.name}
          </Text>
          <Text style={[styles.subText, { color: qty > 0 ? theme.danger : theme.textMuted }]}>
            Tồn: {formatNumber(product.current_stock)} {product.unit}
            {qty > 0 ? ` → Còn: ${formatNumber(afterQty)} ${product.unit}` : ''}
          </Text>
        </View>

        <View style={styles.stepperWrap}>
          <Pressable
            onPress={() => {
              void triggerLightHaptic();
              onChangeQty(product.id, Math.max(0, qty - 1));
            }}
            accessibilityRole="button"
            accessibilityLabel={`Giảm số lượng ${product.name}`}
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
            accessibilityLabel={`Tăng số lượng ${product.name}`}
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
  const focusedMovementProductId = useUiStore((s) => s.focusedMovementProductId);
  const pending = useOfflineQueueStore((s) => s.pending);
  const isSyncing = useOfflineQueueStore((s) => s.isSyncing);
  const enqueueMovements = useOfflineQueueStore((s) => s.enqueueMovements);
  const syncPendingMovements = useOfflineQueueStore((s) => s.syncPendingMovements);

  const pendingForStore = useMemo(
    () => (store ? pending.filter((p) => p.store_id === store.id) : []),
    [pending, store],
  );

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

  useEffect(() => {
    if (focusedMovementProductId) {
      setSelectedProductId(focusedMovementProductId);
      setProductSearch('');
      setUnitMode('BASE');
      if (mode === 'out_batch') {
        setMode('out_single');
      }
      useUiStore.setState({ focusedMovementProductId: null });
    }
  }, [focusedMovementProductId, mode]);

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
        label: `${p.name} · ${formatNumber(p.current_stock)} ${p.unit}`,
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
      { key: 'BASE', label: `Lẻ (${activeProduct.unit})` },
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
          `Đã lưu: "${product.name}" (${formatNumber(beforeVal)} ${deltaStr} → ${formatNumber(created.balance_after)} ${product.unit}).`,
        );
        setShowAuditLink(true);
        refreshAll();
      } catch (err) {
        if (isOfflineNetworkError(err) && user && store) {
          const offlinePayload: MovementCreateInput = {
            ...payload,
            occurred_at: payload.occurred_at || new Date().toISOString(),
          };
          const { updatedProducts, createdMovements } = await enqueueMovements(
            [offlinePayload],
            user,
            store.id,
          );
          queryClient.setQueryData(['products'], updatedProducts);
          await triggerSuccessHaptic();
          setAnomalyPending(null);
          setNote('');
          setQtyText(payload.movement_type === 'IN_PURCHASE' ? '5' : '1');
          const synthetic = createdMovements[0];
          const beforeVal =
            typeof synthetic?.balance_before === 'number'
              ? synthetic.balance_before
              : product.current_stock;
          const deltaVal = synthetic?.quantity_delta ?? 0;
          const afterVal =
            synthetic?.balance_after ?? Number((beforeVal + deltaVal).toFixed(3));
          const deltaStr = deltaVal > 0 ? `+${formatNumber(deltaVal)}` : formatNumber(deltaVal);
          setStatusMsg(
            `Đã lưu Offline: "${product.name}" (${formatNumber(beforeVal)} ${deltaStr} → ${formatNumber(afterVal)} ${product.unit}) — tự đồng bộ khi có mạng.`,
          );
          setShowAuditLink(true);
          refreshAll();
          return;
        }
        if (err instanceof ApiHttpError && err.status === 409) {
          await triggerWarningHaptic();
          setAnomalyPending({ message: err.message, payload });
          return;
        }
        setStatusMsg(err instanceof Error ? err.message : 'Lỗi ghi nhận giao dịch.');
      } finally {
        setSubmitting(false);
      }
    },
    [refreshAll, user, store, enqueueMovements, queryClient],
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
        setStatusMsg(`Không tìm thấy sản phẩm mã "${code}".`);
        return;
      }
      setProductSearch('');
      setSelectedProductId(found.id);
      setStatusMsg(`Đã chọn "${found.name}".`);
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
      setStatusMsg('Chọn ít nhất 1 mặt hàng cần xuất cuối ca.');
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
      setStatusMsg(`Đã chốt ca ${res.processed_count} mặt hàng vào sổ cái.`);
      setShowAuditLink(true);
      refreshAll();
    } catch (err) {
      if (isOfflineNetworkError(err) && user && store) {
        const baseMs = Date.now();
        const stampedItems = batchItems.map((it, idx) => ({
          ...it,
          occurred_at: new Date(baseMs + idx).toISOString(),
        }));
        const { updatedProducts } = await enqueueMovements(stampedItems, user, store.id);
        queryClient.setQueryData(['products'], updatedProducts);
        await triggerSuccessHaptic();
        setShiftQuantities({});
        setStatusMsg(
          `Đã lưu Offline chốt ca ${stampedItems.length} mặt hàng — tự đồng bộ khi có mạng.`,
        );
        setShowAuditLink(true);
        refreshAll();
        return;
      }
      setStatusMsg(err instanceof Error ? err.message : 'Lỗi chốt ca.');
    } finally {
      setSubmitting(false);
    }
  }, [shiftQuantities, refreshAll, user, store, enqueueMovements, queryClient]);

  const renderSingleForm = useCallback(
    ({ item }: { item: string }) => {
      if (products.length === 0) {
        if (item !== 'picker') return null;
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Kho chưa có mặt hàng</Text>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              {isManager
                ? 'Hãy thêm mặt hàng đầu tiên trong Kho hàng trước khi thực hiện Xuất / Nhập.'
                : 'Kho hiện chưa có mặt hàng nào. Vui lòng chờ Chủ kho thêm sản phẩm trước khi xuất kho.'}
            </Text>
            {isManager ? (
              <ActionButton
                label="Mở Kho hàng để thêm sản phẩm →"
                icon="cube-outline"
                onPress={() => setActiveTab('inventory')}
              />
            ) : null}
          </View>
        );
      }

      if (item === 'picker') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Mặt hàng</Text>
            <View style={styles.searchRow}>
              <View
                style={[
                  styles.searchBox,
                  { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
                ]}
              >
                <Ionicons name="search-outline" size={18} color={theme.textMuted} />
                <TextInput
                  value={productSearch}
                  onChangeText={setProductSearch}
                  placeholder="Tìm tên hoặc mã SKU..."
                  placeholderTextColor={theme.textMuted}
                  style={[styles.searchInput, { color: theme.text }]}
                />
              </View>
              <Pressable
                onPress={() => setScannerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Quét mã vạch chọn sản phẩm"
                android_ripple={{ color: theme.ripple }}
                style={({ pressed }) => [
                  styles.scanBtn,
                  { backgroundColor: theme.secondary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Ionicons name="barcode-outline" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
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
                Không khớp mặt hàng nào.
              </Text>
            )}
          </View>
        );
      }

      if (!activeProduct) return null;

      const fillColor = isStockIn
        ? theme.primary
        : reason === 'OUT_DAMAGE_EXPIRED'
          ? theme.danger
          : theme.secondary;

      const beforeStock = activeProduct.current_stock;
      const signedDelta = isStockIn ? baseDeltaQty : -baseDeltaQty;
      const projectedStock = Number((beforeStock + signedDelta).toFixed(3));
      const negativeBlocked = Boolean(!isStockIn && projectedStock < 0 && !store?.allow_negative_stock);

      return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Số lượng ({activeUnitLabel})</Text>
            <StatusPill
              text={`${isStockIn ? '+' : '-'}${formatNumber(numericQty)} ${activeUnitLabel}`}
              tone={isStockIn ? 'primary' : reason === 'OUT_DAMAGE_EXPIRED' ? 'danger' : 'warning'}
            />
          </View>

          {!isStockIn ? (
            <SegmentedToggle
              options={OUT_REASON_OPTIONS}
              selectedKey={reason}
              onSelect={(k) => setReason(k as 'OUT_CONSUMPTION' | 'OUT_DAMAGE_EXPIRED')}
            />
          ) : null}

          {supportsPackMode ? (
            <SegmentedToggle
              options={unitModeOptions}
              selectedKey={effectiveUnitMode}
              onSelect={(k) => setUnitMode(k as UnitMode)}
            />
          ) : null}

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
              inputMode="decimal"
              selectTextOnFocus
              accessibilityLabel="Ô điền số lượng"
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

          <View
            {...panResponder.panHandlers}
            onLayout={(e) => {
              trackWidthRef.current = Math.max(1, e.nativeEvent.layout.width);
            }}
            accessibilityLabel="Thanh trượt chọn số lượng"
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
            placeholder="Ghi chú (tùy chọn)..."
            placeholderTextColor={theme.textMuted}
            style={[
              styles.input,
              { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
            ]}
          />

          <View
            style={[
              styles.previewCard,
              {
                backgroundColor: isStockIn ? theme.primarySoft : theme.surfaceAlt,
                borderColor: negativeBlocked ? theme.danger : theme.border,
              },
            ]}
          >
            <View style={styles.mathRow}>
              <View style={styles.mathCell}>
                <Text style={[styles.mathLabel, { color: theme.textMuted }]}>Tồn trước</Text>
                <Text style={[styles.mathValue, { color: theme.text }]}>
                  {formatNumber(beforeStock)} {activeProduct.unit}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={theme.textMuted} />
              <View style={styles.mathCell}>
                <Text style={[styles.mathLabel, { color: theme.textMuted }]}>
                  {isStockIn ? 'Nhập' : 'Xuất'}
                </Text>
                <Text style={[styles.mathValue, { color: isStockIn ? theme.primary : theme.danger }]}>
                  {isStockIn ? `+${formatNumber(baseDeltaQty)}` : `-${formatNumber(baseDeltaQty)}`}{' '}
                  {activeProduct.unit}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={theme.textMuted} />
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
            {negativeBlocked ? (
              <Text style={[styles.warnText, { color: theme.danger }]}>
                Vượt quá tồn hiện có ({formatNumber(beforeStock)} {activeProduct.unit}).
              </Text>
            ) : null}
          </View>

          {anomalyPending ? (
            <View style={[styles.anomalyBox, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
              <Text style={[styles.anomalyText, { color: theme.text }]}>{anomalyPending.message}</Text>
              <View style={styles.presetRow}>
                <ActionButton
                  label="Hủy"
                  variant="outline"
                  style={styles.flexOne}
                  onPress={() => setAnomalyPending(null)}
                />
                <ActionButton
                  label="Xác nhận xuất"
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
                  ? `Ghi nhận Hỏng -${formatNumber(baseDeltaQty)} ${activeProduct.unit}`
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
      products.length,
      isManager,
      theme,
      setActiveTab,
      productSearch,
      productChipOptions,
      activeProduct,
      isStockIn,
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
        <SegmentedToggle
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
        {statusMsg ? (
          <View style={[styles.statusBox, { backgroundColor: theme.primarySoft, borderColor: theme.primary }]}>
            <Text style={[styles.statusMsg, { color: theme.text }]}>{statusMsg}</Text>
            {showAuditLink ? (
              <Pressable
                onPress={() => setActiveTab('stocktake')}
                accessibilityRole="button"
                accessibilityLabel="Xem lịch sử tại Kiểm kê"
                style={({ pressed }) => [styles.auditLinkBtn, { opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[styles.auditLinkText, { color: theme.primary }]}>
                  Xem lịch sử tại Kiểm kê →
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {pendingForStore.length > 0 ? (
          <ActionButton
            label={`Đồng bộ ngay (${pendingForStore.length})`}
            icon="cloud-upload-outline"
            variant="outline"
            loading={isSyncing}
            onPress={() => {
              void syncPendingMovements(store?.id).then((res) => {
                if (res.synced > 0) {
                  setStatusMsg(`Đã đồng bộ ${res.synced} giao dịch Offline lên máy chủ.`);
                  refreshAll();
                } else {
                  setStatusMsg('Chưa kết nối được máy chủ để đồng bộ.');
                }
              });
            }}
          />
        ) : null}
      </View>

      {mode === 'out_batch' ? (
        <View style={styles.flexOne}>
          <FlatList
            data={products}
            renderItem={renderShiftRow}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Text style={[styles.subText, { color: theme.textMuted }]}>
                  Chưa có mặt hàng nào để chốt ca.
                </Text>
              </View>
            }
          />
          <View style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            <Text style={[styles.subText, { color: theme.textMuted }]}>
              Đã chọn: {shiftSummary.selectedItems} SP · Tổng trừ: -{formatNumber(shiftSummary.totalQty)}
            </Text>
            <ActionButton
              label="Gửi Chốt cuối ca"
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
          data={SINGLE_FORM_SECTIONS}
          renderItem={renderSingleForm}
          keyExtractor={(i) => i}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <BarcodeScannerModal
        visible={scannerOpen}
        title="Quét mã sản phẩm"
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
  statusBox: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 4,
  },
  statusMsg: { fontSize: 13, fontWeight: '500' },
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
    width: '100%',
    overflow: 'hidden',
  },
  searchRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
    width: '100%',
  },
  searchBox: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: TOUCH_MIN,
    fontSize: 15,
  },
  scanBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
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
  sectionTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600' },
  subText: { fontSize: 13, lineHeight: 18 },
  presetRow: { flexDirection: 'row', gap: SPACING.sm },
  input: {
    width: '100%',
    minWidth: 0,
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
    width: '100%',
  },
  stepperBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  numberInput: {
    flex: 1,
    minWidth: 0,
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
    gap: SPACING.xs,
  },
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
  emptyBox: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
});
