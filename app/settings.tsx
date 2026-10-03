import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { APP_RADIUS } from '@/constants/theme';

import { clearDailyReportCache } from '@/services/ai-service';
import { runMonthlyReview, shouldRunMonthlyReview } from '@/services/monthly-agent';
import { resetApp } from '@/services/storage-service';

const BG = '#f8fafc';
const DARK = '#0f172a';
const SLATE = '#475569';
const BORDER = '#e2e8f0';

const KEY_PENDING = 'heartburn.pendingInvestigation.v1';
const KEY_TRIGGERS = 'heartburn.potentialTriggers.v1';
const KEY_CACHE = 'heartburn.dailyReportCache.v1';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type MemoryRow =
  | { key: string; kind: 'empty' }
  | { key: string; kind: 'invalid'; raw: string }
  | { key: string; kind: 'ok'; summary: string; json: string };

function isoDateKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function rowFromStorageKey(storageKey: string, raw: string | null): MemoryRow {
  if (raw == null || !String(raw).trim()) {
    return { key: storageKey, kind: 'empty' };
  }
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (storageKey === KEY_PENDING) {
      const items =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { items?: unknown }).items)
          ? ((parsed as { items: unknown[] }).items ?? [])
          : [];
      const n = items.length;
      return {
        key: storageKey,
        kind: 'ok',
        summary: `${n} ${n === 1 ? 'item' : 'items'} being investigated`,
        json: JSON.stringify(parsed, null, 2),
      };
    }

    if (storageKey === KEY_TRIGGERS) {
      const list = Array.isArray(parsed) ? parsed : [];
      const n = list.length;
      return {
        key: storageKey,
        kind: 'ok',
        summary: `${n} suspect${n === 1 ? '' : 's'}`,
        json: JSON.stringify(parsed, null, 2),
      };
    }

    if (storageKey === KEY_CACHE) {
      const obj =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      const dates = obj ? isoDateKeys(obj) : [];
      const summary =
        dates.length === 0
          ? 'No dated report entries in cache object'
          : `Cached reports: ${dates.join(', ')}`;
      return {
        key: storageKey,
        kind: 'ok',
        summary,
        json: JSON.stringify(parsed, null, 2),
      };
    }

    return { key: storageKey, kind: 'ok', summary: '', json: JSON.stringify(parsed, null, 2) };
  } catch {
    return { key: storageKey, kind: 'invalid', raw: trimmed };
  }
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [isResetting, setIsResetting] = useState(false);
  const [isClearingReportCache, setIsClearingReportCache] = useState(false);
  const [runningMonthly, setRunningMonthly] = useState(false);
  const [monthlyDone, setMonthlyDone] = useState(false);
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([]);
  const [loadingMemory, setLoadingMemory] = useState(false);

  const loadAiMemory = useCallback(async () => {
    setLoadingMemory(true);
    try {
      const entries = await AsyncStorage.multiGet([KEY_PENDING, KEY_TRIGGERS, KEY_CACHE]);
      const map = Object.fromEntries(entries) as Record<string, string | null>;
      setMemoryRows([
        rowFromStorageKey(KEY_PENDING, map[KEY_PENDING] ?? null),
        rowFromStorageKey(KEY_TRIGGERS, map[KEY_TRIGGERS] ?? null),
        rowFromStorageKey(KEY_CACHE, map[KEY_CACHE] ?? null),
      ]);
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadAiMemory();
    }, [loadAiMemory]),
  );

  const confirmReset = () => {
    if (isResetting) return;

    Alert.alert(
      'Reset App?',
      'This will clear all saved data on this device (logs, suspects, cached reports, and onboarding).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setIsResetting(true);
                await resetApp();
                if (Platform.OS === 'web') {
                  window.location.assign('/');
                } else {
                  router.replace('/onboarding-triggers');
                  Alert.alert('Reset complete', 'Data cleared.');
                }
              } catch (e) {
                console.error('[settings] reset failed:', e);
                Alert.alert('Reset failed', 'Could not clear storage. Please try again.');
              } finally {
                setIsResetting(false);
              }
            })();
          },
        },
      ]
    );
  };

  const clearReportCache = () => {
    if (isClearingReportCache) return;
    void (async () => {
      try {
        setIsClearingReportCache(true);
        await clearDailyReportCache();
        Alert.alert(
          'Storage cleared',
          'Onboarding flag, triggers, pending investigation, and daily report cache were removed. You may see onboarding again; open the report after that to generate a fresh one.',
        );
      } catch (e) {
        console.error('[settings] clear report / AI state failed:', e);
        Alert.alert('Could not clear storage', 'Please try again.');
      } finally {
        setIsClearingReportCache(false);
      }
    })();
  };

  const handleRunMonthlyReview = async () => {
    if (runningMonthly) return;
    setRunningMonthly(true);
    setMonthlyDone(false);
    try {
      await shouldRunMonthlyReview();
      await runMonthlyReview();
      setMonthlyDone(true);
      setTimeout(() => setMonthlyDone(false), 1800);
    } catch {
      // ignore
    } finally {
      setRunningMonthly(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="chevron-back" size={22} color={DARK} />
        </Pressable>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, styles.cardSpacing]}>
          <Text style={styles.sectionKickerMuted}>AI MEMORY</Text>
          <Text style={styles.sectionBody}>
            Raw AsyncStorage used by the detective (pending investigation, suspects, cached reports). Refresh after
            generating a report or clearing state.
          </Text>
          <Pressable
            onPress={() => void loadAiMemory()}
            disabled={loadingMemory}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { opacity: loadingMemory ? 0.6 : pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Refresh AI memory from storage"
          >
            {loadingMemory ? (
              <ActivityIndicator size="small" color={DARK} />
            ) : (
              <Ionicons name="refresh-outline" size={18} color={DARK} />
            )}
            <Text style={styles.secondaryBtnText}>REFRESH</Text>
          </Pressable>

          {loadingMemory && memoryRows.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 16 }} color={DARK} />
          ) : (
            memoryRows.map((row) => (
              <View key={row.key} style={styles.memoryCard}>
                <Text style={styles.memoryKeyLabel} selectable>
                  {row.key}
                </Text>
                {row.kind === 'empty' ? (
                  <Text style={styles.memoryEmpty}>No data yet</Text>
                ) : row.kind === 'invalid' ? (
                  <>
                    <Text style={styles.memorySummary}>Could not parse as JSON</Text>
                    <Text style={styles.memoryMono} selectable>
                      {row.raw}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.memorySummary}>{row.summary}</Text>
                    <Text style={styles.memoryMono} selectable>
                      {row.json}
                    </Text>
                  </>
                )}
              </View>
            ))
          )}
        </View>

        <View style={[styles.card, styles.cardSpacing]}>
          <Text style={styles.sectionKickerMuted}>TESTING</Text>
          <Text style={styles.sectionBody}>
            Clears onboarding completion, potential triggers, pending investigation, and cached daily AI reports. You
            may see onboarding again; after that, open the report to fetch a new one.
          </Text>
          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowLabel}>Monthly Case Review</Text>
              <Text style={styles.settingsRowSub}>Analyse 30 days of data and trim investigation list</Text>
            </View>
            <Pressable
              onPress={() => void handleRunMonthlyReview()}
              disabled={runningMonthly}
              style={({ pressed }) => [
                styles.settingsRowAction,
                { opacity: runningMonthly ? 0.6 : pressed ? 0.92 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Run monthly case review"
            >
              {runningMonthly ? (
                <ActivityIndicator size="small" color={DARK} />
              ) : monthlyDone ? (
                <Text style={styles.doneText}>Done</Text>
              ) : (
                <Ionicons name="chevron-forward" size={18} color={DARK} />
              )}
            </Pressable>
          </View>
          <Pressable
            onPress={clearReportCache}
            disabled={isClearingReportCache}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { opacity: isClearingReportCache ? 0.6 : pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Clear report-related AsyncStorage keys for testing"
          >
            <Ionicons name="refresh-outline" size={18} color={DARK} />
            <Text style={styles.secondaryBtnText}>CLEAR REPORT &amp; AI STATE</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionKicker}>DANGER ZONE</Text>
          <Text style={styles.sectionBody}>
            For testing only. This will wipe everything stored locally and restart the app.
          </Text>

          <Pressable
            onPress={confirmReset}
            disabled={isResetting}
            style={({ pressed }) => [
              styles.dangerBtn,
              { opacity: isResetting ? 0.6 : pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Reset app and clear all data"
          >
            <Ionicons name="warning-outline" size={18} color="#fff" />
            <Text style={styles.dangerBtnText}>RESET APP &amp; CLEAR ALL DATA</Text>
          </Pressable>
        </View>
      </ScrollView>

      <BottomSafeAreaShield />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    // Use `insets.top` via inline style for cross-device consistency.
    paddingTop: 54,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  headerTitle: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.2, color: DARK },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  cardSpacing: { marginBottom: 14 },
  sectionKickerMuted: { fontFamily: 'OutfitBlack', fontSize: 10, letterSpacing: 1, color: SLATE },
  sectionKicker: { fontFamily: 'OutfitBlack', fontSize: 10, letterSpacing: 1, color: '#ef4444' },
  sectionBody: { marginTop: 8, fontFamily: 'Outfit', fontSize: 13, lineHeight: 18, color: SLATE },
  settingsRow: {
    marginTop: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsRowText: { flex: 1 },
  settingsRowLabel: { fontFamily: 'OutfitBlack', fontSize: 13, color: DARK },
  settingsRowSub: { marginTop: 4, fontFamily: 'Outfit', fontSize: 12, lineHeight: 16, color: SLATE },
  settingsRowAction: {
    width: 44,
    height: 44,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontFamily: 'OutfitBlack', fontSize: 11, color: DARK },
  dangerBtn: {
    marginTop: 14,
    height: 54,
    borderRadius: APP_RADIUS,
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#fecaca',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  dangerBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1, color: '#fff' },
  secondaryBtn: {
    marginTop: 14,
    height: 54,
    borderRadius: APP_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1, color: DARK },
  memoryCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: BORDER,
  },
  memoryKeyLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 9,
    letterSpacing: 0.3,
    color: DARK,
    marginBottom: 6,
  },
  memorySummary: { fontFamily: 'Outfit', fontSize: 12, color: SLATE, marginBottom: 6 },
  memoryEmpty: { fontFamily: 'Outfit', fontSize: 13, fontStyle: 'italic', color: '#94a3b8' },
  memoryMono: {
    fontFamily: MONO,
    fontSize: 11,
    color: SLATE,
    lineHeight: 16,
  },
});

