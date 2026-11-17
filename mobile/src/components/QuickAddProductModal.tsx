import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/apiClient';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { DuplicateWarningItem, Product, TrackingType } from '../types/wms';
import { triggerSuccessHaptic } from '../utils/formatters';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { ActionButton, ChipOption, ChipRow } from './CommonUI';

const UNIT_OPTIONS: ChipOption[] = [
  { key: 'Thùng', label: 'Thùng' },
  { key: 'Hũ', label: 'Hũ' },
  { key: 'Cái', label: 'Cái' },
  { key: 'Hộp', label: 'Hộp' },
  { key: 'Bịch', label: 'Bịch' },
  { key: 'Chai', label: 'Chai' },
  { key: 'Kg', label: 'Kg' },
  { key: 'Túi', label: 'Túi' },
];

const TRACKING_OPTIONS: ChipOption[] = [
  { key: 'STANDARD', label: 'Đếm chuẩn' },
  { key: 'PACK_BREAK', label: 'Xé lẻ Thùng→Cái' },
  { key: 'CONSUMABLE', label: 'Vật tư ước lượng %' },
];

const DuplicateItemRow = React.memo(({ item }: { item: DuplicateWarningItem }) => {
  const theme = useTheme();
  return (
    <View style={[styles.dupRow, { backgroundColor: theme.warningSoft }]}>
      <Text style={[styles.dupTitle, { color: theme.text }]} numberOfLines={1}>
        Đã có: {item.name} ({item.current_stock} {item.unit})
      </Text>
    </View>
  );
});

export function QuickAddProductModal({
  visible,
  liteMode,
  onClose,
  onCreated,
}: {
  visible: boolean;
  liteMode: boolean;
  onClose: () => void;
  onCreated: (product: Product) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [currentStock, setCurrentStock] = useState('20');
  const [unit, setUnit] = useState('Cái');
  const [trackingType, setTrackingType] = useState<TrackingType>('STANDARD');
  const [packUnit, setPackUnit] = useState('Bịch');
  const [packRate, setPackRate] = useState('50');
  const [capacityRef, setCapacityRef] = useState('500');
  const [showAdvanced, setShowAdvanced] = useState(!liteMode);
  const [barcode, setBarcode] = useState('');
  const [category, setCategory] = useState('Vật tư nhỏ lẻ');
  const [minStock, setMinStock] = useState('5');
  const [leadTime, setLeadTime] = useState('3');
  const [unitCost, setUnitCost] = useState('0');
  const [shelf, setShelf] = useState('');
  const [supplier, setSupplier] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateWarningItem[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setShowAdvanced(!liteMode);
  }, [liteMode, visible]);

  useEffect(() => {
    const trimmed = name.trim();
    if (!visible || trimmed.length < 2) {
      setDuplicates([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .checkDuplicates(trimmed)
        .then(setDuplicates)
        .catch(() => setDuplicates([]));
    }, 280);
    return () => clearTimeout(timer);
  }, [name, visible]);

  const resetForm = useCallback(() => {
    setName('');
    setCurrentStock('20');
    setUnit('Cái');
    setTrackingType('STANDARD');
    setBarcode('');
    setDuplicates([]);
    setErrorMsg(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setErrorMsg('Vui lòng nhập tên mặt hàng.');
      return;
    }
    const stockNum = Number(currentStock.replace(',', '.'));
    if (Number.isNaN(stockNum) || stockNum < 0) {
      setErrorMsg('Số lượng tồn ban đầu không hợp lệ.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const created = await api.createProduct({
        name: name.trim(),
        unit: unit.trim() || 'Cái',
        current_stock: stockNum,
        tracking_type: trackingType,
        pack_unit: trackingType === 'PACK_BREAK' ? packUnit.trim() || 'Bịch' : undefined,
        pack_conversion_rate:
          trackingType === 'PACK_BREAK' ? Math.max(1, Number(packRate) || 10) : 1,
        capacity_reference:
          trackingType === 'CONSUMABLE'
            ? Math.max(stockNum, Number(capacityRef) || 200)
            : undefined,
        barcode: barcode.trim() || undefined,
        category: category.trim() || 'Chung',
        min_stock_level: Math.max(0, Number(minStock) || 5),
        lead_time_days: Math.max(1, Math.round(Number(leadTime) || 3)),
        unit_cost: Math.max(0, Number(unitCost) || 0),
        shelf_location: shelf.trim() || undefined,
        supplier_name: supplier.trim() || undefined,
      });
      await triggerSuccessHaptic();
      resetForm();
      onCreated(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tạo mặt hàng.');
    } finally {
      setSaving(false);
    }
  }, [
    name,
    currentStock,
    unit,
    trackingType,
    packUnit,
    packRate,
    capacityRef,
    barcode,
    category,
    minStock,
    leadTime,
    unitCost,
    shelf,
    supplier,
    resetForm,
    onCreated,
  ]);

  const renderDup = useCallback(
    ({ item }: { item: DuplicateWarningItem }) => <DuplicateItemRow item={item} />,
    [],
  );

  const dupKey = useCallback((item: DuplicateWarningItem) => String(item.id), []);

  const formSections = [
    'core',
    duplicates.length > 0 ? 'dups' : 'no-dups',
    'tracking',
    showAdvanced ? 'advanced' : 'collapsed',
  ];

  const renderFormSection = useCallback(
    ({ item }: { item: string }) => {
      if (item === 'core') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Thông tin cơ bản</Text>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Tên mặt hàng *</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ví dụ: Mắm tép chưng thịt, Túi nilon..."
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Tồn kho ban đầu *</Text>
            <TextInput
              value={currentStock}
              onChangeText={setCurrentStock}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Đơn vị tính *</Text>
            <ChipRow options={UNIT_OPTIONS} selectedKey={unit} onSelect={setUnit} />
          </View>
        );
      }

      if (item === 'dups') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.warning }]}>
            <Text style={[styles.warnHeader, { color: theme.warning }]}>
              Mặt hàng tương tự đã có trong kho:
            </Text>
            <FlatList data={duplicates} renderItem={renderDup} keyExtractor={dupKey} />
          </View>
        );
      }

      if (item === 'tracking') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Kiểu quản lý mặt hàng</Text>
            <ChipRow
              options={TRACKING_OPTIONS}
              selectedKey={trackingType}
              onSelect={(k) => setTrackingType(k as TrackingType)}
            />

            {trackingType === 'PACK_BREAK' ? (
              <View style={styles.subBox}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  Đơn vị bao/thùng & Số lượng quy đổi (VD: 1 Bịch = 50 Cái)
                </Text>
                <View style={styles.splitRow}>
                  <TextInput
                    value={packUnit}
                    onChangeText={setPackUnit}
                    placeholder="Bịch / Thùng"
                    placeholderTextColor={theme.textMuted}
                    style={[
                      styles.input,
                      styles.halfInput,
                      { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                    ]}
                  />
                  <TextInput
                    value={packRate}
                    onChangeText={setPackRate}
                    keyboardType="numeric"
                    placeholder="50"
                    placeholderTextColor={theme.textMuted}
                    style={[
                      styles.input,
                      styles.halfInput,
                      { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {trackingType === 'CONSUMABLE' ? (
              <View style={styles.subBox}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  Định mức đầy 100% (dùng khi kiểm kê ước lượng theo %)
                </Text>
                <TextInput
                  value={capacityRef}
                  onChangeText={setCapacityRef}
                  keyboardType="numeric"
                  placeholder="500"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                  ]}
                />
              </View>
            ) : null}

            <Pressable
              onPress={() => setShowAdvanced((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Mở rộng tùy chọn nâng cao"
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => [
                styles.toggleAdvBtn,
                { borderColor: theme.border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.toggleAdvText, { color: theme.secondary }]}>
                {showAdvanced
                  ? 'Thu gọn tùy chọn nâng cao'
                  : 'Tùy chọn nâng cao (Mã vạch, Mức tối thiểu, Kệ, NCC)'}
              </Text>
              <Ionicons
                name={showAdvanced ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={theme.secondary}
              />
            </Pressable>
          </View>
        );
      }

      if (item === 'advanced') {
        return (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              Mã vạch (bỏ trống để tự sinh mã QR nội bộ)
            </Text>
            <View style={styles.splitRow}>
              <TextInput
                value={barcode}
                onChangeText={setBarcode}
                placeholder="Quét hoặc tự động sinh"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.input,
                  styles.halfInput,
                  { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                ]}
              />
              <ActionButton
                label="Quét"
                icon="barcode-outline"
                variant="outline"
                onPress={() => setScannerOpen(true)}
              />
            </View>

            <View style={styles.splitRow}>
              <View style={styles.halfInput}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Ngưỡng tối thiểu</Text>
                <TextInput
                  value={minStock}
                  onChangeText={setMinStock}
                  keyboardType="numeric"
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                  ]}
                />
              </View>
              <View style={styles.halfInput}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Lead time (ngày)</Text>
                <TextInput
                  value={leadTime}
                  onChangeText={setLeadTime}
                  keyboardType="numeric"
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                  ]}
                />
              </View>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Danh mục</Text>
            <TextInput
              value={category}
              onChangeText={setCategory}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />

            <View style={styles.splitRow}>
              <View style={styles.halfInput}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Vị trí kệ</Text>
                <TextInput
                  value={shelf}
                  onChangeText={setShelf}
                  placeholder="Kệ A1"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                  ]}
                />
              </View>
              <View style={styles.halfInput}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Giá nhập / ĐV</Text>
                <TextInput
                  value={unitCost}
                  onChangeText={setUnitCost}
                  keyboardType="numeric"
                  style={[
                    styles.input,
                    { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
                  ]}
                />
              </View>
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>Nhà cung cấp</Text>
            <TextInput
              value={supplier}
              onChangeText={setSupplier}
              placeholder="Tên nhà cung cấp"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { backgroundColor: theme.surfaceAlt, color: theme.text, borderColor: theme.border },
              ]}
            />
          </View>
        );
      }

      return null;
    },
    [
      theme,
      name,
      currentStock,
      unit,
      duplicates,
      renderDup,
      dupKey,
      trackingType,
      packUnit,
      packRate,
      capacityRef,
      showAdvanced,
      barcode,
      minStock,
      leadTime,
      category,
      shelf,
      unitCost,
      supplier,
    ],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
        <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Thêm mặt hàng mới</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Đóng biểu mẫu thêm hàng"
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
            data={formSections}
            renderItem={renderFormSection}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />
        </KeyboardAvoidingView>

        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          {errorMsg ? <Text style={[styles.errText, { color: theme.danger }]}>{errorMsg}</Text> : null}
          <ActionButton
            label="Lưu mặt hàng mới"
            icon="checkmark-circle-outline"
            onPress={() => void handleSave()}
            loading={saving}
          />
        </View>

        <BarcodeScannerModal
          visible={scannerOpen}
          title="Quét mã vạch sản phẩm mới"
          onScan={(code) => {
            setBarcode(code);
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
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
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginTop: SPACING.xs },
  input: {
    minWidth: 0,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
  subBox: { marginTop: SPACING.xs, gap: SPACING.xs },
  splitRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  halfInput: { flex: 1, minWidth: 0 },
  toggleAdvBtn: {
    minHeight: TOUCH_MIN,
    marginTop: SPACING.sm,
    borderTopWidth: 1,
    paddingTop: SPACING.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleAdvText: { fontSize: 13, fontWeight: '600', flex: 1 },
  warnHeader: { fontSize: 13, fontWeight: '600' },
  dupRow: {
    minHeight: TOUCH_MIN,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    marginTop: SPACING.xs,
    justifyContent: 'center',
  },
  dupTitle: { fontSize: 13, fontWeight: '500' },
  footer: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
  errText: { fontSize: 13, fontWeight: '500' },
});
