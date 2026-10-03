import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APP_RADIUS } from '@/constants/theme';
import { LOGO_FONT_LIGHT, LOGO_FONT_STRONG } from '@/constants/fonts';

const HEADER_DARK = '#0f172a';
const BG = '#f8fafc';
const CARD = '#ffffff';
const DARK = '#0f172a';
const SLATE = '#475569';
const MUTED = '#94a3b8';
const BORDER = '#e2e8f0';
const BRAND_BLUE = '#0f172a';
const RISK_RED = '#991b1b';

const POTENTIAL_TRIGGERS_KEY = 'heartburn.potentialTriggers.v1';
const PENDING_INVESTIGATION_KEY = 'heartburn.pendingInvestigation.v1';

type PotentialTrigger = {
  id: string;
  label: string;
  strikeCount: number;
  status?: string;
  lastSeenTs?: number;
  lastReason?: string;
};

type PendingInvestigationItem = {
  id: string;
  label: string;
  occurrences: number;
  confidence: number;
};

function parsePotentialTriggers(raw: string | null): PotentialTrigger[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        const row = t as Record<string, unknown>;
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        const label = typeof row.label === 'string' ? row.label.trim() : '';
        if (!id || !label) return null;
        const strikeCount =
          typeof row.strikeCount === 'number' && Number.isFinite(row.strikeCount) ? row.strikeCount : 0;
        return {
          id,
          label,
          strikeCount,
          ...(typeof row.status === 'string' ? { status: row.status } : {}),
          ...(typeof row.lastSeenTs === 'number' ? { lastSeenTs: row.lastSeenTs } : {}),
          ...(typeof row.lastReason === 'string' ? { lastReason: row.lastReason } : {}),
        } satisfies PotentialTrigger;
      })
      .filter(Boolean) as PotentialTrigger[];
  } catch {
    return [];
  }
}

function parsePendingItems(raw: string | null): PendingInvestigationItem[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return [];
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        const label = typeof row.label === 'string' ? row.label.trim() : '';
        if (!id || !label) return null;
        const occurrences =
          typeof row.occurrences === 'number' && Number.isFinite(row.occurrences) ? row.occurrences : 0;
        const confidence =
          typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : 0;
        return { id, label, occurrences, confidence } satisfies PendingInvestigationItem;
      })
      .filter(Boolean) as PendingInvestigationItem[];
  } catch {
    return [];
  }
}

function formatConfidencePercent(confidence: number): number {
  const n = confidence > 1 ? confidence : confidence * 100;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function triggerIdFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-');
}

export default function ManageTriggersScreen() {
  const insets = useSafeAreaInsets();
  const [investigationItems, setInvestigationItems] = useState<PendingInvestigationItem[]>([]);
  const [triggers, setTriggers] = useState<PotentialTrigger[]>([]);
  const [newTriggerLabel, setNewTriggerLabel] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [triggersRaw, pendingRaw] = await Promise.all([
        AsyncStorage.getItem(POTENTIAL_TRIGGERS_KEY),
        AsyncStorage.getItem(PENDING_INVESTIGATION_KEY),
      ]);
      setTriggers(parsePotentialTriggers(triggersRaw));
      setInvestigationItems(parsePendingItems(pendingRaw));
    } catch {
      setTriggers([]);
      setInvestigationItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveTriggers = async (next: PotentialTrigger[]) => {
    setTriggers(next);
    try {
      await AsyncStorage.setItem(POTENTIAL_TRIGGERS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleDeleteTrigger = (id: string) => {
    const next = triggers.filter((t) => t.id !== id);
    void saveTriggers(next);
  };

  const handleAddTrigger = () => {
    const label = newTriggerLabel.trim();
    if (!label) return;
    const id = triggerIdFromLabel(label);
    if (!id) return;
    if (triggers.some((t) => t.id === id)) {
      setNewTriggerLabel('');
      return;
    }
    const entry: PotentialTrigger = {
      id,
      label,
      strikeCount: 1,
      status: 'suspect',
      lastSeenTs: Date.now(),
      lastReason: 'Added manually',
    };
    void saveTriggers([entry, ...triggers]);
    setNewTriggerLabel('');
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={HEADER_DARK} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backBtn, { top: insets.top + 12, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>

        <View style={styles.brandLockup} pointerEvents="none">
          <Text style={styles.brandTitle} accessibilityRole="header">
            <Text style={styles.brandTitleStrong}>Reflux</Text>
            <Text style={styles.brandTitleLight}>io</Text>
          </Text>
          <Text style={styles.brandTagline}>TRACK · IDENTIFY · HEAL</Text>
        </View>

        <View style={styles.headerSideSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 16 + insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>UNDER INVESTIGATION</Text>
        {loading ? null : investigationItems.length === 0 ? (
          <Text style={styles.emptyText}>No items under investigation right now.</Text>
        ) : (
          investigationItems.map((item) => (
            <View key={item.id} style={styles.investigationCard}>
              <View style={styles.investigationIconWrap}>
                <Ionicons name="search-outline" size={20} color={SLATE} />
              </View>
              <View style={styles.investigationText}>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.rowSub}>
                  {item.occurrences} {item.occurrences === 1 ? 'occurrence' : 'occurrences'} ·{' '}
                  {formatConfidencePercent(item.confidence)}% confidence
                </Text>
              </View>
            </View>
          ))
        )}

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>SUSPECT LIST</Text>
        <View style={styles.card}>
          {loading ? null : triggers.length === 0 ? (
            <Text style={styles.emptyInCard}>No suspects on your list yet.</Text>
          ) : (
            triggers.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <View style={styles.rowDivider} /> : null}
                <View style={styles.suspectRow}>
                  <View style={styles.flameIconWrap}>
                    <Ionicons name="flame-outline" size={20} color={BRAND_BLUE} />
                  </View>
                  <View style={styles.suspectText}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <Text style={styles.rowSub}>
                      {item.strikeCount} {item.strikeCount === 1 ? 'strike' : 'strikes'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleDeleteTrigger(item.id)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.label}`}
                  >
                    <Ionicons name="trash-outline" size={20} color={RISK_RED} />
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>

        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>ADD A TRIGGER</Text>
        <View style={styles.card}>
          <TextInput
            value={newTriggerLabel}
            onChangeText={setNewTriggerLabel}
            placeholder="e.g. Fizzy drinks, Mint..."
            placeholderTextColor={MUTED}
            autoCapitalize="words"
            autoCorrect={false}
            style={styles.addInput}
            accessibilityLabel="New trigger name"
          />
          <Pressable
            onPress={handleAddTrigger}
            disabled={!newTriggerLabel.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              { opacity: !newTriggerLabel.trim() ? 0.5 : pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add trigger"
          >
            <Text style={styles.addBtnText}>+ Add</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HEADER_DARK },
  header: {
    backgroundColor: HEADER_DARK,
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSideSpacer: { width: 40, height: 40 },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  brandLockup: { alignItems: 'center', flex: 1 },
  brandTitle: { fontSize: 34, color: '#fff', letterSpacing: -0.8, lineHeight: 36 },
  brandTitleStrong: { fontFamily: LOGO_FONT_STRONG },
  brandTitleLight: { fontFamily: LOGO_FONT_LIGHT, color: '#2d6a4f' },
  brandTagline: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 3,
    marginTop: 8,
  },
  scroll: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingTop: 20 },
  sectionTitle: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.2,
    color: MUTED,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitleSpaced: { marginTop: 8 },
  emptyText: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: SLATE,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  emptyInCard: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: SLATE,
  },
  investigationCard: {
    backgroundColor: CARD,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  investigationIconWrap: {
    width: 36,
    height: 36,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  investigationText: { flex: 1 },
  card: {
    backgroundColor: CARD,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
  },
  suspectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flameIconWrap: {
    width: 36,
    height: 36,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suspectText: { flex: 1 },
  rowLabel: { fontFamily: 'OutfitBlack', fontSize: 14, color: DARK },
  rowSub: { fontFamily: 'Outfit', fontSize: 12, color: SLATE, marginTop: 3, lineHeight: 16 },
  rowDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addInput: {
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: APP_RADIUS,
    paddingHorizontal: 12,
    fontFamily: 'Outfit',
    fontSize: 14,
    color: DARK,
    backgroundColor: BG,
  },
  addBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: APP_RADIUS,
    backgroundColor: HEADER_DARK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addBtnText: {
    fontFamily: 'OutfitBlack',
    fontSize: 13,
    letterSpacing: 0.5,
    color: '#fff',
  },
});
