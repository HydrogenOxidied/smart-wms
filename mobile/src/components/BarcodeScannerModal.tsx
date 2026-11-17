import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACING, TOUCH_MIN } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { triggerSuccessHaptic } from '../utils/formatters';
import { ActionButton } from './CommonUI';

interface SampleBarcode {
  code: string;
  label: string;
}

const DEMO_BARCODES: SampleBarcode[] = [
  { code: '8934588013010', label: 'Sữa tươi DalatMilk' },
  { code: '8935024189912', label: 'Bơ lạt Anchor' },
  { code: '8936112090112', label: 'Ly giấy 12oz (Bịch)' },
  { code: '8935024180025', label: 'Cà phê Arabica' },
  { code: '2000011002017', label: 'Ống hút giấy (Nội bộ)' },
];

const SampleCodeButton = React.memo(
  ({
    item,
    onPick,
  }: {
    item: SampleBarcode;
    onPick: (code: string) => void;
  }) => {
    const theme = useTheme();
    return (
      <Pressable
        onPress={() => onPick(item.code)}
        accessibilityRole="button"
        accessibilityLabel={`Thử quét mã ${item.label}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [
          styles.sampleCard,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={[styles.sampleTitle, { color: theme.text }]} numberOfLines={1}>
          {item.label}
        </Text>
        <Text style={[styles.sampleCode, { color: theme.secondary }]} numberOfLines={1}>
          {item.code}
        </Text>
      </Pressable>
    );
  },
);

export function BarcodeScannerModal({
  visible,
  title = 'Quét mã vạch sản phẩm',
  onScan,
  onClose,
}: {
  visible: boolean;
  title?: string;
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  useEffect(() => {
    if (visible && Platform.OS !== 'web' && permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const emitCode = useCallback(
    (raw: string) => {
      const cleaned = raw.trim();
      if (!cleaned) return;
      const now = Date.now();
      if (lastScanRef.current.code === cleaned && now - lastScanRef.current.time < 1200) {
        return;
      }
      lastScanRef.current = { code: cleaned, time: now };
      void triggerSuccessHaptic();
      setManualCode('');
      onScan(cleaned);
    },
    [onScan],
  );

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (result.data) {
        emitCode(result.data);
      }
    },
    [emitCode],
  );

  const renderSample = useCallback(
    ({ item }: { item: SampleBarcode }) => <SampleCodeButton item={item} onPick={emitCode} />,
    [emitCode],
  );

  const keyExtractor = useCallback((item: SampleBarcode) => item.code, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
        <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.surface }]}>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.headerSub, { color: theme.textMuted }]}>
              Hỗ trợ EAN-13, UPC, Code128 và QR nội bộ
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Đóng máy quét"
            android_ripple={{ color: theme.ripple }}
            style={({ pressed }) => [
              styles.closeBtn,
              { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
        </View>

        <View style={styles.cameraArea}>
          {Platform.OS !== 'web' && permission?.granted ? (
            <CameraView
              style={styles.cameraFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
              }}
              onBarcodeScanned={handleBarcodeScanned}
            />
          ) : (
            <View style={[styles.cameraFallback, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
              <Ionicons name="barcode-outline" size={44} color={theme.primary} />
              <Text style={[styles.fallbackTitle, { color: theme.text }]}>
                {Platform.OS === 'web'
                  ? 'Chế độ mô phỏng máy quét trên Web/PC'
                  : 'Chưa có quyền truy cập Camera'}
              </Text>
              <Text style={[styles.fallbackDesc, { color: theme.textMuted }]}>
                {Platform.OS === 'web'
                  ? 'Nhập mã vạch bên dưới hoặc chạm nhanh vào mã mẫu để kiểm thử.'
                  : 'Cấp quyền Camera để quét trực tiếp, hoặc nhập tay mã bên dưới.'}
              </Text>
              {Platform.OS !== 'web' && !permission?.granted ? (
                <ActionButton
                  label="Cấp quyền Camera"
                  icon="camera-outline"
                  onPress={() => void requestPermission()}
                />
              ) : null}
            </View>
          )}
        </View>

        <View style={[styles.manualPanel, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
            Quét nhanh bằng mã mẫu (Demo Hội đồng):
          </Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={DEMO_BARCODES}
            renderItem={renderSample}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.sampleList}
          />

          <View style={styles.manualRow}>
            <TextInput
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="Hoặc nhập mã vạch / SKU..."
              placeholderTextColor={theme.textMuted}
              onSubmitEditing={() => emitCode(manualCode)}
              returnKeyType="done"
              style={[
                styles.input,
                {
                  backgroundColor: theme.surfaceAlt,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
            />
            <ActionButton
              label="Xác nhận"
              onPress={() => emitCode(manualCode)}
              accessibilityLabel="Xác nhận mã vạch nhập tay"
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    gap: SPACING.md,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerSub: {
    fontSize: 12,
  },
  closeBtn: {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraArea: {
    flex: 1,
    padding: SPACING.lg,
  },
  cameraFill: {
    flex: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  cameraFallback: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.xl,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  fallbackTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  fallbackDesc: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 320,
  },
  manualPanel: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    gap: SPACING.md,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  sampleList: {
    gap: SPACING.sm,
  },
  sampleCard: {
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    justifyContent: 'center',
  },
  sampleTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  sampleCode: {
    fontSize: 12,
  },
  manualRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: TOUCH_MIN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    fontSize: 15,
  },
});
