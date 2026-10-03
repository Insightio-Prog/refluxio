import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO } from '@/constants/demo';
import { loadDemoData } from '@/utils/demo-data';
import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { APP_RADIUS } from '@/constants/theme';
import { LOGO_FONT_LIGHT, LOGO_FONT_STRONG } from '@/constants/fonts';

type Intensity = 'low' | 'med' | 'high';

type TriggerRow = {
  id: string;
  label: string;
};

type PotentialTrigger = {
  id: string;
  label: string;
  strikeCount: number;
  status?: string;
  lastSeenTs?: number;
  lastReason?: string;
};

const BG = '#f8fafc';
const DARK = '#0f172a';
const SLATE = '#475569';
const BORDER = '#e2e8f0';
const CHARCOAL = '#334155';
const BRAND_BLUE = DARK;
const BRAND_GREEN = '#2d6a4f';

/** Patterns severity scale — used for suspect intensity pills. */
const SEVERITY_MILD = '#8090AE';
const SEVERITY_MODERATE = '#3D4E6E';
const SEVERITY_SEVERE = '#0F172A';

const POTENTIAL_TRIGGERS_STORAGE_KEY = 'heartburn.potentialTriggers.v1';
const HAS_COMPLETED_ONBOARDING_KEY = 'heartburn.hasCompletedOnboarding.v1';
const ONBOARDING_NOTE_KEY = 'heartburn.onboardingNote.v1';

const COMMON_TRIGGERS: TriggerRow[] = [
  { id: 'coffee', label: 'Coffee' },
  { id: 'spicy-foods', label: 'Spicy Foods' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'fatty-foods', label: 'Fatty Foods' },
  { id: 'citrus', label: 'Citrus' },
  { id: 'onions-garlic', label: 'Onions/Garlic' },
  { id: 'chocolate', label: 'Chocolate' },
];

function normalizeId(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function intensityToStrikeCount(intensity: Intensity) {
  if (intensity === 'low') return 1;
  if (intensity === 'med') return 2;
  return 3;
}

function intensityStyle(intensity: Intensity) {
  if (intensity === 'low') return { bg: SEVERITY_MILD, fg: '#fff' };
  if (intensity === 'med') return { bg: SEVERITY_MODERATE, fg: '#fff' };
  return { bg: SEVERITY_SEVERE, fg: '#fff' };
}

export default function OnboardingTriggersScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Record<string, Intensity | null>>(() => {
    const init: Record<string, Intensity | null> = {};
    for (const t of COMMON_TRIGGERS) init[t.id] = null;
    return init;
  });

  const [customInput, setCustomInput] = useState('');
  const [customTriggers, setCustomTriggers] = useState<TriggerRow[]>([]);
  const [detectiveNote, setDetectiveNote] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);

  const allTriggers = useMemo(() => {
    const base = [...COMMON_TRIGGERS];
    for (const c of customTriggers) base.push(c);
    return base;
  }, [customTriggers]);

  const addCustom = () => {
    const label = customInput.trim();
    if (!label) return;
    const id = `custom-${normalizeId(label) || String(Date.now())}`;
    if (allTriggers.some((t) => t.id === id) || allTriggers.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
      setCustomInput('');
      return;
    }
    setCustomTriggers((prev) => [...prev, { id, label }]);
    setSelected((prev) => ({ ...prev, [id]: 'med' }));
    setCustomInput('');
  };

  const removeCustom = (id: string) => {
    setCustomTriggers((prev) => prev.filter((t) => t.id !== id));
    setSelected((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const setIntensity = (id: string, v: Intensity) => {
    setSelected((prev) => ({ ...prev, [id]: prev[id] === v ? null : v }));
  };

  const finish = async () => {
    if (isFinishing) return;
    try {
      setIsFinishing(true);
      const now = Date.now();
      const picked: PotentialTrigger[] = allTriggers
        .map((t) => {
          const intensity = selected[t.id] ?? null;
          if (!intensity) return null;
          return {
            id: t.id,
            label: t.label,
            strikeCount: intensityToStrikeCount(intensity),
            status: intensity,
            lastSeenTs: now,
            lastReason: 'Onboarding selection',
          } satisfies PotentialTrigger;
        })
        .filter(Boolean) as PotentialTrigger[];

      await AsyncStorage.setItem(POTENTIAL_TRIGGERS_STORAGE_KEY, JSON.stringify(picked));
      const note = detectiveNote.trim();
      if (note) {
        await AsyncStorage.setItem(ONBOARDING_NOTE_KEY, note);
      }
      await AsyncStorage.setItem(HAS_COMPLETED_ONBOARDING_KEY, 'true');
      router.replace('/(tabs)');
    } finally {
      // If navigation takes a moment, keep the button in "loading" state briefly.
      setTimeout(() => setIsFinishing(false), 600);
    }
  };

  const exploreWithSampleData = async () => {
    if (isFinishing) return;
    try {
      setIsFinishing(true);
      await loadDemoData();
      // Full reload so every in-memory store picks up the sample data.
      window.location.assign('/home');
    } catch (e) {
      console.error('[demo] could not load sample data', e);
      setIsFinishing(false);
    }
  };

  const skipForNow = async () => {
    if (isFinishing) return;
    try {
      setIsFinishing(true);
      await AsyncStorage.setItem(HAS_COMPLETED_ONBOARDING_KEY, 'true');
      router.replace('/(tabs)');
    } finally {
      setTimeout(() => setIsFinishing(false), 350);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80, flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.logoHeader, { paddingTop: insets.top + 12 }]}>
            <View style={styles.brandLockup}>
              <Text style={styles.brandTitle} accessibilityRole="header">
                <Text style={styles.brandTitleStrong}>Reflux</Text>
                <Text style={styles.brandTitleLight}>io</Text>
              </Text>
              <Text style={styles.brandTagline}>TRACK · IDENTIFY · HEAL</Text>
            </View>
          </View>

          {IS_DEMO ? (
            <Pressable
              onPress={() => void exploreWithSampleData()}
              style={({ pressed }) => [styles.demoCard, { opacity: isFinishing ? 0.6 : pressed ? 0.9 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Explore with sample data"
            >
              <Text style={styles.demoKicker}>JUST LOOKING?</Text>
              <Text style={styles.demoTitle}>Explore with four weeks of sample data</Text>
              <Text style={styles.demoBody}>
                See the heatmap, patterns and AI reports with a made-up history, no setup needed.
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.hero}>
            <Text style={styles.title}>Pick your main triggers</Text>
            <Text style={styles.subTitle}>Let’s identify your primary suspects to get the investigation started.</Text>
            <Text style={styles.reassuranceNote}>You can add more triggers anytime in Settings.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionKicker}>COMMON SUSPECTS</Text>

            {allTriggers.map((t) => {
              const current = selected[t.id] ?? null;
              const isCustom = t.id.startsWith('custom-');
              return (
                <View key={t.id} style={styles.row}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {t.label}
                    </Text>
                    {isCustom ? <Text style={styles.rowHint}>Custom suspect</Text> : null}
                  </View>

                  <View style={styles.pills}>
                    {(['low', 'med', 'high'] as const).map((v) => {
                      const active = current === v;
                      const c = intensityStyle(v);
                      return (
                        <Pressable
                          key={v}
                          onPress={() => setIntensity(t.id, v)}
                          style={({ pressed }) => [
                            styles.pill,
                            { backgroundColor: active ? c.bg : '#fff', borderColor: active ? 'transparent' : BORDER },
                            pressed ? { opacity: 0.9 } : null,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`${t.label} intensity ${v}`}
                        >
                          <Text style={[styles.pillText, { color: active ? c.fg : SLATE }]}>{v.toUpperCase()}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {isCustom ? (
                    <Pressable
                      onPress={() => removeCustom(t.id)}
                      hitSlop={10}
                      style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.7 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${t.label}`}
                    >
                      <Ionicons name="close" size={18} color={SLATE} />
                    </Pressable>
                  ) : (
                    <View style={{ width: 34 }} />
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionKicker}>CUSTOM SUSPECT</Text>
            <Text style={styles.helpText}>Add anything specific you already suspect (e.g., “Cola Sherbets”).</Text>

            <View style={styles.customRow}>
              <TextInput
                value={customInput}
                onChangeText={setCustomInput}
                placeholder="Type a custom suspect…"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
                autoCorrect={false}
                style={styles.input}
                onSubmitEditing={addCustom}
                returnKeyType="done"
              />
              <Pressable
                onPress={addCustom}
                style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.92 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Add custom suspect"
              >
                <Ionicons name="add" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionKicker}>DETECTIVE'S BRIEFING</Text>
            <TextInput
              value={detectiveNote}
              onChangeText={setDetectiveNote}
              placeholder="Anything the Detective should know? E.g. 'I've had GERD for 5 years, stress is a big factor for me'"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect
              style={[styles.input, styles.noteInput]}
            />
          </View>

          <View style={{ paddingBottom: insets.bottom + 16 }}>
            <Pressable
              onPress={() => void finish()}
              disabled={isFinishing}
              style={({ pressed }) => [
                styles.finishBtn,
                { opacity: isFinishing ? 0.75 : pressed ? 0.92 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Finish onboarding"
            >
              <Text style={styles.finishBtnText}>{isFinishing ? 'LOADING…' : 'FINISH'}</Text>
              <Ionicons name={isFinishing ? 'time-outline' : 'arrow-forward'} size={18} color="#fff" />
            </Pressable>

            <Pressable
              onPress={() => void skipForNow()}
              disabled={isFinishing}
              style={({ pressed }) => [
                styles.skipBtn,
                { opacity: isFinishing ? 0.6 : pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Skip onboarding for now"
            >
              <Text style={styles.skipBtnText}>Skip for now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSafeAreaShield />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  demoCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 16,
    backgroundColor: '#0f172a',
    borderRadius: APP_RADIUS,
  },
  demoKicker: { color: '#86efac', fontSize: 11, letterSpacing: 1.2, fontWeight: '700', marginBottom: 6 },
  demoTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  demoBody: { color: '#cbd5e1', fontSize: 13, lineHeight: 18 },
  safe: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 10, gap: 14 },
  logoHeader: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  brandLockup: { alignItems: 'center', gap: 8 },
  brandTitle: { fontSize: 40, letterSpacing: -1, lineHeight: 44 },
  brandTitleStrong: { fontFamily: LOGO_FONT_STRONG, color: BRAND_BLUE },
  brandTitleLight: { fontFamily: LOGO_FONT_LIGHT, color: BRAND_GREEN },
  brandTagline: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: 3.5,
    textAlign: 'center',
  },
  hero: {
    paddingTop: 10,
    paddingBottom: 6,
    alignItems: 'center',
    gap: 10,
  },
  title: { fontFamily: 'OutfitBlack', fontSize: 26, letterSpacing: -0.7, color: DARK, textAlign: 'center' },
  subTitle: { fontFamily: 'Outfit', fontSize: 13, lineHeight: 18, color: SLATE, textAlign: 'center', maxWidth: 320 },
  reassuranceNote: { marginTop: -2, fontFamily: 'OutfitBold', fontSize: 12, lineHeight: 17, color: '#64748b', textAlign: 'center', maxWidth: 320 },

  card: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  sectionKicker: { fontFamily: 'OutfitBlack', fontSize: 10, letterSpacing: 1, color: '#94a3b8' },
  helpText: { marginTop: 8, fontFamily: 'Outfit', fontSize: 13, lineHeight: 18, color: SLATE },

  row: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226,232,240,0.7)',
  },
  rowLabel: { fontFamily: 'OutfitMedium', fontSize: 14, color: CHARCOAL },
  rowHint: { marginTop: 2, fontFamily: 'OutfitBold', fontSize: 11, color: '#94a3b8' },
  pills: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pill: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontFamily: 'OutfitBlack', fontSize: 10, letterSpacing: 0.8 },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  customRow: { marginTop: 10, flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    height: 48,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    paddingHorizontal: 12,
    fontFamily: 'OutfitBold',
    fontSize: 13,
    color: DARK,
  },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: APP_RADIUS,
    backgroundColor: BRAND_BLUE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteInput: {
    marginTop: 10,
    flex: undefined,
    width: '100%',
    height: undefined,
    minHeight: 96,
    paddingTop: 12,
    paddingBottom: 12,
  },

  finishBtn: {
    marginTop: 4,
    height: 54,
    borderRadius: APP_RADIUS,
    backgroundColor: BRAND_BLUE,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  finishBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.2, color: '#fff' },

  skipBtn: {
    height: 48,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 0.6, color: SLATE },
});

