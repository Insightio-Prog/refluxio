import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { usePathname } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { updateLog } from '@/hooks/use-log-store';
import { APP_RADIUS } from '@/constants/theme';
import {
  PENDING_POSITION_CHECK_STORAGE_KEY,
  subscribePendingPositionCheck,
  type PendingPositionCheck,
} from '@/utils/pending-position-check';

const CARD = '#ffffff';
const BORDER = '#e2e8f0';
const HEADER_DARK = '#0f172a';

const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

type MealBodyPositionPrimary = 'upright' | 'seated' | 'lying';

function formatMealBodyPosition(primary: MealBodyPositionPrimary, sub?: string): string {
  if (primary === 'upright') return 'Upright / Standing';
  if (primary === 'seated') {
    if (sub === 'upright') return 'Seated (Upright)';
    if (sub === 'slouched') return 'Seated (Slouched)';
    return 'Seated';
  }
  if (sub === 'flat') return 'Lying Down (Lying Flat)';
  if (sub === 'elevated') return 'Lying Down (Elevated)';
  return 'Lying Down';
}

async function readPendingPositionCheck(): Promise<PendingPositionCheck | null | 'too_soon'> {
  const raw = await AsyncStorage.getItem(PENDING_POSITION_CHECK_STORAGE_KEY);
  if (!raw?.trim()) return null;

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    await AsyncStorage.removeItem(PENDING_POSITION_CHECK_STORAGE_KEY);
    return null;
  }

  const p = parsed as Record<string, unknown>;
  const mealId = typeof p.mealId === 'string' && p.mealId.trim() ? p.mealId.trim() : null;
  const mealName = typeof p.mealName === 'string' ? p.mealName : null;
  const loggedTs =
    typeof p.loggedTs === 'number' && Number.isFinite(p.loggedTs) ? p.loggedTs : null;

  if (!mealId || mealName === null || loggedTs === null) {
    await AsyncStorage.removeItem(PENDING_POSITION_CHECK_STORAGE_KEY);
    return null;
  }

  const elapsed = Date.now() - loggedTs;
  if (elapsed < MIN_AGE_MS) return 'too_soon';
  if (elapsed >= MAX_AGE_MS) {
    await AsyncStorage.removeItem(PENDING_POSITION_CHECK_STORAGE_KEY);
    return null;
  }

  return { mealId, mealName, loggedTs };
}

export default function MealPositionBottomSheet() {
  const pathname = usePathname();
  const sheetRef = useRef<BottomSheetModal>(null);
  const recheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionCheckRef = useRef<PendingPositionCheck | null>(null);

  const [positionCheck, setPositionCheck] = useState<PendingPositionCheck | null>(null);
  const [selectedMealPositionPrimary, setSelectedMealPositionPrimary] =
    useState<MealBodyPositionPrimary | undefined>(undefined);
  const [selectedMealPositionSub, setSelectedMealPositionSub] = useState<string | undefined>(undefined);
  const [isSavingMealPosition, setIsSavingMealPosition] = useState(false);

  positionCheckRef.current = positionCheck;

  const clearRecheckTimeout = useCallback(() => {
    if (recheckTimeoutRef.current) {
      clearTimeout(recheckTimeoutRef.current);
      recheckTimeoutRef.current = null;
    }
  }, []);

  const presentSheet = useCallback(() => {
    requestAnimationFrame(() => {
      sheetRef.current?.present();
    });
  }, []);

  const refreshPendingPositionCheck = useCallback(async () => {
    clearRecheckTimeout();
    try {
      const pending = await readPendingPositionCheck();

      if (pending === 'too_soon') {
        const raw = await AsyncStorage.getItem(PENDING_POSITION_CHECK_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { loggedTs?: number };
          const loggedTs = typeof parsed.loggedTs === 'number' ? parsed.loggedTs : null;
          if (loggedTs != null) {
            const waitMs = MIN_AGE_MS - (Date.now() - loggedTs) + 500;
            recheckTimeoutRef.current = setTimeout(() => {
              void refreshPendingPositionCheck();
            }, waitMs);
          }
        }
        return;
      }

      if (!pending) {
        setPositionCheck(null);
        return;
      }

      setPositionCheck(pending);
      presentSheet();
    } catch {
      setPositionCheck(null);
    }
  }, [clearRecheckTimeout, presentSheet]);

  useEffect(() => {
    void refreshPendingPositionCheck();
    const unsub = subscribePendingPositionCheck(() => {
      void refreshPendingPositionCheck();
    });
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPendingPositionCheck();
    });
    return () => {
      unsub();
      appStateSub.remove();
      clearRecheckTimeout();
    };
  }, [refreshPendingPositionCheck, clearRecheckTimeout]);

  useEffect(() => {
    if (pathname === '/' || pathname === '/(tabs)' || pathname?.endsWith('/index')) return;
    void refreshPendingPositionCheck();
  }, [pathname, refreshPendingPositionCheck]);

  useEffect(() => {
    if (!positionCheck) return;
    setSelectedMealPositionPrimary(undefined);
    setSelectedMealPositionSub(undefined);
  }, [positionCheck?.mealId, positionCheck?.loggedTs]);

  useEffect(() => {
    if (positionCheck) return;
    sheetRef.current?.dismiss();
  }, [positionCheck]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
    ),
    [],
  );

  const canSaveMealPosition = useMemo(() => {
    if (!selectedMealPositionPrimary) return false;
    if (selectedMealPositionPrimary === 'upright') return true;
    return Boolean(selectedMealPositionSub);
  }, [selectedMealPositionPrimary, selectedMealPositionSub]);

  const clearPendingPositionStorage = async () => {
    try {
      await AsyncStorage.removeItem(PENDING_POSITION_CHECK_STORAGE_KEY);
    } catch {}
  };

  const handleSkipMealPositionCheck = async () => {
    await clearPendingPositionStorage();
    setPositionCheck(null);
    setSelectedMealPositionPrimary(undefined);
    setSelectedMealPositionSub(undefined);
  };

  const handleSaveMealPositionCheck = async () => {
    if (!positionCheck || !canSaveMealPosition || isSavingMealPosition) return;
    if (!selectedMealPositionPrimary) return;
    const bodyPosition = formatMealBodyPosition(selectedMealPositionPrimary, selectedMealPositionSub);
    try {
      setIsSavingMealPosition(true);
      await updateLog(positionCheck.mealId, { bodyPosition });
      await clearPendingPositionStorage();
      setPositionCheck(null);
      setSelectedMealPositionPrimary(undefined);
      setSelectedMealPositionSub(undefined);
    } catch {
    } finally {
      setIsSavingMealPosition(false);
    }
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.bottomSheetBackground}
      handleIndicatorStyle={styles.bottomSheetHandle}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      onDismiss={() => {
        if (positionCheckRef.current) {
          void handleSkipMealPositionCheck();
        }
      }}
    >
      <BottomSheetView style={styles.sheetContent}>
        <Text style={styles.kicker}>AFTER YOUR MEAL</Text>
        <Text style={styles.mealName} numberOfLines={3}>
          {positionCheck?.mealName ?? ''}
        </Text>
        <Text style={styles.helper}>
          How did you spend most of the hour after eating?
        </Text>

        <View style={styles.pillRow}>
          {(
            [
              { key: 'upright' as const, label: 'Upright / Standing', icon: 'walk-outline' as const },
              { key: 'seated' as const, label: 'Seated', icon: 'body-outline' as const },
              { key: 'lying' as const, label: 'Lying', icon: 'moon-outline' as const },
            ] as const
          ).map((opt) => {
            const selected = selectedMealPositionPrimary === opt.key;
            const iconColor = selected ? '#fff' : '#334155';
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  setSelectedMealPositionPrimary(opt.key);
                  setSelectedMealPositionSub(undefined);
                }}
                style={[styles.pill, selected ? styles.pillActive : styles.pillIdle]}
              >
                <Ionicons name={opt.icon} size={20} color={iconColor} />
                <Text style={[styles.pillText, selected ? styles.pillTextActive : null]} numberOfLines={2}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {selectedMealPositionPrimary === 'seated' ? (
          <View style={styles.subRow}>
            {(
              [
                { key: 'upright', label: 'Upright' },
                { key: 'slouched', label: 'Slouched' },
              ] as const
            ).map((sub) => {
              const subOn = selectedMealPositionSub === sub.key;
              return (
                <Pressable
                  key={sub.key}
                  onPress={() => setSelectedMealPositionSub(subOn ? undefined : sub.key)}
                  style={[styles.subPill, subOn ? styles.subPillActive : styles.subPillIdle]}
                >
                  <Text style={[styles.subPillText, subOn ? styles.subPillTextActive : null]}>
                    {sub.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {selectedMealPositionPrimary === 'lying' ? (
          <View style={styles.subRow}>
            {(
              [
                { key: 'flat', label: 'Lying Flat' },
                { key: 'elevated', label: 'Elevated' },
              ] as const
            ).map((sub) => {
              const subOn = selectedMealPositionSub === sub.key;
              return (
                <Pressable
                  key={sub.key}
                  onPress={() => setSelectedMealPositionSub(subOn ? undefined : sub.key)}
                  style={[styles.subPill, subOn ? styles.subPillActive : styles.subPillIdle]}
                >
                  <Text style={[styles.subPillText, subOn ? styles.subPillTextActive : null]}>
                    {sub.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Pressable
          onPress={() => void handleSaveMealPositionCheck()}
          disabled={!canSaveMealPosition || isSavingMealPosition}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              opacity: !canSaveMealPosition || isSavingMealPosition ? 0.5 : pressed ? 0.92 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save body position"
        >
          <Ionicons name={isSavingMealPosition ? 'time-outline' : 'save-outline'} size={18} color="#fff" />
          <Text style={styles.saveBtnText}>{isSavingMealPosition ? 'SAVING…' : 'SAVE'}</Text>
        </Pressable>

        <Pressable
          onPress={() => void handleSkipMealPositionCheck()}
          style={({ pressed }) => [{ marginTop: 14, alignSelf: 'center', opacity: pressed ? 0.75 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Skip body position"
        >
          <Text style={styles.skipText}>SKIP</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: CARD,
    borderTopLeftRadius: APP_RADIUS,
    borderTopRightRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
  },
  bottomSheetHandle: {
    backgroundColor: '#cbd5e1',
    width: 40,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  kicker: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    color: '#94a3b8',
    letterSpacing: 1,
  },
  mealName: { marginTop: 8, fontFamily: 'OutfitBlack', fontSize: 16, color: '#1e293b' },
  helper: { marginTop: 8, fontFamily: 'Outfit', fontSize: 13, color: '#64748b' },
  pillRow: { marginTop: 14, flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pillIdle: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  pillActive: { backgroundColor: '#1e293b', borderColor: '#1e293b' },
  pillText: { fontFamily: 'OutfitBlack', fontSize: 11, color: '#334155', textAlign: 'center' },
  pillTextActive: { color: '#fff' },
  subRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
  subPill: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subPillIdle: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
  subPillActive: { backgroundColor: HEADER_DARK, borderColor: HEADER_DARK },
  subPillText: { fontFamily: 'OutfitBold', fontSize: 13, color: '#64748b', textAlign: 'center' },
  subPillTextActive: { color: '#fff' },
  saveBtn: {
    marginTop: 14,
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.1, color: '#fff' },
  skipText: { fontFamily: 'Outfit', fontSize: 13, color: '#94a3b8', textAlign: 'center' },
});
