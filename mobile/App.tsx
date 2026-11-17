import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { AppErrorBoundary, StatusPill } from './src/components/CommonUI';
import { AccountScreen } from './src/screens/AccountScreen';
import { ConsumptionScreen } from './src/screens/ConsumptionScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ForecastScreen } from './src/screens/ForecastScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { StocktakeScreen } from './src/screens/StocktakeScreen';
import { useAuthStore } from './src/store/authStore';
import { useOfflineQueueStore } from './src/store/offlineQueueStore';
import { TabKey, useUiStore } from './src/store/uiStore';
import { SPACING, TOUCH_MIN } from './src/theme/tokens';
import { useTheme } from './src/theme/useTheme';
import { triggerLightHaptic } from './src/utils/formatters';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15000,
    },
  },
});

interface NavTabDef {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const MANAGER_TABS: NavTabDef[] = [
  { key: 'dashboard', label: 'Tổng quan', icon: 'grid-outline' },
  { key: 'inventory', label: 'Kho hàng', icon: 'cube-outline' },
  { key: 'consumption', label: 'Tiêu thụ', icon: 'swap-vertical-outline' },
  { key: 'stocktake', label: 'Kiểm kê', icon: 'barcode-outline' },
  { key: 'forecast', label: 'Dự báo AI', icon: 'analytics-outline' },
];

const STAFF_TABS: NavTabDef[] = [
  { key: 'inventory', label: 'Kho hàng', icon: 'cube-outline' },
  { key: 'consumption', label: 'Tiêu thụ', icon: 'swap-vertical-outline' },
  { key: 'stocktake', label: 'Kiểm kê', icon: 'barcode-outline' },
  { key: 'account', label: 'Tài khoản', icon: 'person-circle-outline' },
];

const BottomTabButton = React.memo(
  ({
    tab,
    active,
    onSelect,
  }: {
    tab: NavTabDef;
    active: boolean;
    onSelect: (key: TabKey) => void;
  }) => {
    const theme = useTheme();
    const color = active ? theme.primary : theme.textMuted;
    return (
      <Pressable
        onPress={() => {
          void triggerLightHaptic();
          onSelect(tab.key);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Mở tab ${tab.label}`}
        android_ripple={{ color: theme.ripple }}
        style={({ pressed }) => [styles.tabItem, { opacity: pressed ? 0.78 : 1 }]}
      >
        <Ionicons name={tab.icon} size={22} color={color} />
        <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
          {tab.label}
        </Text>
      </Pressable>
    );
  },
);

function RootShell() {
  const theme = useTheme();
  const { isHydrated, user, store, hydrate } = useAuthStore();
  const { pending, hydrateQueue } = useOfflineQueueStore();
  const { activeTab, setActiveTab } = useUiStore();

  useEffect(() => {
    void hydrate();
    void hydrateQueue();
  }, [hydrate, hydrateQueue]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'MANAGER') {
      if (activeTab === 'account') {
        setActiveTab('dashboard');
      }
    } else if (activeTab === 'dashboard' || activeTab === 'forecast') {
      setActiveTab('inventory');
    }
  }, [user, activeTab, setActiveTab]);

  useEffect(() => {
    const defaultTab: TabKey = user?.role === 'MANAGER' ? 'dashboard' : 'inventory';
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (user && activeTab !== defaultTab) {
        setActiveTab(defaultTab);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [user, activeTab, setActiveTab]);

  const visibleTabs = useMemo(
    () => (user?.role === 'MANAGER' ? MANAGER_TABS : STAFF_TABS),
    [user?.role],
  );

  const renderTabItem = useCallback(
    ({ item }: { item: NavTabDef }) => (
      <BottomTabButton tab={item} active={item.key === activeTab} onSelect={setActiveTab} />
    ),
    [activeTab, setActiveTab],
  );

  if (!isHydrated) {
    return (
      <SafeAreaView style={[styles.centerWrap, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textMuted }]}>
          Đang khởi động PocketWMS...
        </Text>
      </SafeAreaView>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.appHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={styles.flexOne}>
          <Text style={[styles.appTitle, { color: theme.text }]} numberOfLines={1}>
            {store?.name || 'PocketWMS'}
          </Text>
        </View>
        <View style={styles.headerBadges}>
          {pending.length > 0 ? (
            <StatusPill text={`Offline: ${pending.length}`} tone="warning" />
          ) : null}
          <StatusPill
            text={user.role === 'MANAGER' ? 'Chủ kho' : 'Nhân viên'}
            tone={user.role === 'MANAGER' ? 'primary' : 'secondary'}
          />
        </View>
      </View>

      <View style={styles.flexOne}>
        {activeTab === 'dashboard' && user.role === 'MANAGER' ? <DashboardScreen /> : null}
        {activeTab === 'inventory' ? <InventoryScreen /> : null}
        {activeTab === 'consumption' ? <ConsumptionScreen /> : null}
        {activeTab === 'stocktake' ? <StocktakeScreen /> : null}
        {activeTab === 'forecast' && user.role === 'MANAGER' ? <ForecastScreen /> : null}
        {activeTab === 'account' ? <AccountScreen /> : null}
      </View>

      <View style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        <FlatList
          horizontal
          scrollEnabled={false}
          data={visibleTabs}
          renderItem={renderTabItem}
          keyExtractor={(t) => t.key}
          contentContainerStyle={styles.tabRow}
        />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <RootShell />
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  loadingText: { fontSize: 15 },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    gap: SPACING.sm,
  },
  appTitle: { fontSize: 17, fontWeight: '600' },
  headerBadges: { flexDirection: 'row', gap: SPACING.xs, alignItems: 'center' },
  bottomBar: {
    borderTopWidth: 1,
    minHeight: 58,
  },
  tabRow: {
    flexGrow: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: {
    minHeight: TOUCH_MIN,
    minWidth: 64,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
});
