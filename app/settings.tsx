import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { APP_RADIUS } from '@/constants/theme';

import { clearDailyReportCache } from '@/services/ai-service';
import { runMonthlyReview, shouldRunMonthlyReview } from '@/services/monthly-agent';
import { resetApp } from '@/services/storage-service';
import { confirmDialog, notify } from '@/utils/dialog';

const BG = '#f8fafc';
const DARK = '#0f172a';
const SLATE = '#475569';
const BORDER = '#e2e8f0';

const KEY_PENDING = 'heartburn.pendingInvestigation.v1';
const KEY_TRIGGERS = 'heartburn.potentialTriggers.v1';
const KEY_CACHE = 'heartburn.dailyReportCache.v1';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [isResetting, setIsResetting] = useState(false);
  const [isClearingReportCache, setIsClearingReportCache] = useState(false);
  const [runningMonthly, setRunningMonthly] = useState(false);
  const [monthlyDone, setMonthlyDone] = useState(false);

  const confirmReset = () => {
    if (isResetting) return;

    confirmDialog({
      title: 'Reset app?',
      message: 'This will clear all saved data on this device (logs, suspects, cached reports, and onboarding).',
      confirmLabel: 'Reset',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          try {
            setIsResetting(true);
            await resetApp();
            if (Platform.OS === 'web') {
              window.location.assign('/');
            } else {
              router.replace('/onboarding-triggers');
              notify('Reset complete', 'Data cleared.');
            }
          } catch (e) {
            console.error('[settings] reset failed:', e);
            notify('Reset failed', 'Could not clear storage. Please try again.');
          } finally {
            setIsResetting(false);
          }
        })();
      },
    });
  };

  const clearReportCache = () => {
    if (isClearingReportCache) return;
    void (async () => {
      try {
        setIsClearingReportCache(true);
        await clearDailyReportCache();
        notify('Memory cleared', "The detective's memory and cached reports were removed. Open the Report tab to generate a fresh one.");
      } catch (e) {
        console.error('[settings] clear report / AI state failed:', e);
        notify('Could not clear storage', 'Please try again.');
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
        <Text style={styles.headerTitle}>ADVANCED</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, styles.cardSpacing]}>
          <Text style={styles.sectionKickerMuted}>REVIEW &amp; RESET</Text>
          <Text style={styles.sectionBody}>
            Run the monthly case review, or clear the detective's memory and cached reports to start the case afresh.
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
            <Text style={styles.secondaryBtnText}>CLEAR DETECTIVE MEMORY</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionKicker}>DANGER ZONE</Text>
          <Text style={styles.sectionBody}>
            This wipes everything stored on this device and starts again.
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

