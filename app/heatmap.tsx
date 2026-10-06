import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AppModal from '@/components/AppModal';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { useLogs } from '@/hooks/use-log-store';
import { getConfirmedItems, type ConfirmedItem, type DetectiveDaySummary } from '@/services/ai-service';
import { getProtectiveFactors, type ProtectiveFactor } from '@/services/monthly-agent';
import {
  getCalendarStats,
  getDailyLogPresence,
  getDailyScores,
  getEnvironmentExposures,
  getIngredientCorrelations,
  getMedicationEffectiveness,
  getPollenSymptomCorrelation,
  getTimeOfDayGrid,
  getWeekSummary,
} from '@/utils/insights-engine';
import {
  loadPollenHistory,
  type PollenHistoryEntry,
  type PollenLevel,
} from '@/utils/pollen-service';
import { colorHex } from '@/utils/risk-engine';
import { APP_RADIUS } from '@/constants/theme';

const DARK_NAV = '#0f172a';
/** Header / onboarding “brand blue” (slate). */
const BRAND_BLUE = DARK_NAV;
// Match Home screen background for consistent app chrome.
const BG_PAGE = '#f8fafc';
const SLATE = '#64748b';
const SLATE_MUTED = '#94a3b8';
const BORDER = '#e2e8f0';

/** Calendar 30-day overview severity scale (clear → severe). */
const SEVERITY_CLEAR = '#CBD6E5';
const SEVERITY_MILD = '#8090AE';
const SEVERITY_MODERATE = '#3D4E6E';
const SEVERITY_SEVERE = '#0F172A';

const RISK_GREEN = colorHex('green');
const RISK_ORANGE = colorHex('orange');
const RISK_RED = colorHex('red');

/** Detective day chip dot + summary card only; clear uses lightest severity swatch. */
function severityDot(s: number) {
  const x = Math.min(3, Math.max(0, s));
  if (x === 0) return SEVERITY_CLEAR;
  return overviewDayFill(x);
}

function severityLabel(s: number) {
  return (['Clear', 'Mild', 'Moderate', 'Severe'] as const)[Math.min(3, Math.max(0, s))];
}

/** Heat cells + 30-day tiles: slate-blue scale from clear → severe. */
function overviewDayFill(s: number): string {
  const x = Math.min(3, Math.max(0, s));
  if (x === 0) return SEVERITY_CLEAR;
  if (x === 1) return SEVERITY_MILD;
  if (x === 2) return SEVERITY_MODERATE;
  return SEVERITY_SEVERE;
}

function overviewDayText(s: number): string {
  const x = Math.min(3, Math.max(0, s));
  if (x === 0) return SEVERITY_SEVERE;
  return '#ffffff';
}

function heatCellColor(s: number) {
  return overviewDayFill(Math.min(3, Math.max(0, s)));
}

/** Insights tab: map 0–1 scores into calendar severity scale (clear → severe). */
function insightsBandColor01(c: number): string {
  const x = Math.min(1, Math.max(0, c));
  if (x < 0.25) return SEVERITY_CLEAR;
  if (x < 0.5) return SEVERITY_MILD;
  if (x < 0.75) return SEVERITY_MODERATE;
  return SEVERITY_SEVERE;
}

function insightsLabelOnBand(fill: string): string {
  if (fill === SEVERITY_CLEAR) return SEVERITY_MODERATE;
  if (fill === SEVERITY_MILD) return SEVERITY_MILD;
  if (fill === SEVERITY_MODERATE) return SEVERITY_MODERATE;
  if (fill === SEVERITY_SEVERE) return SEVERITY_SEVERE;
  return DARK_NAV;
}

const TIME_LABELS = ['6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm', '10pm', '12am', '2am', '4am'];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const TABS = [
  { key: 'calendar' as const, label: 'Calendar', icon: 'calendar-outline' as const },
  { key: 'insights' as const, label: 'Insights', icon: 'bar-chart-outline' as const },
  { key: 'detective' as const, label: 'Detective', icon: 'search-outline' as const },
  { key: 'environment' as const, label: 'Environment', icon: 'leaf-outline' as const },
] as const;

const POLLEN_LEVEL_HEIGHT: Record<PollenLevel, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
  very_high: 4,
};

const POLLEN_TREND_HEIGHT_PX: Record<PollenLevel, number> = {
  none: 0,
  low: 12,
  moderate: 24,
  high: 36,
  very_high: 48,
};

const POLLEN_TEAL = '#5eead4';

type PollenTypeTab = 'all' | 'tree' | 'grass' | 'weed';

const TAB_KEYS = TABS.map((t) => t.key);
type TabKey = (typeof TABS)[number]['key'];

const OVERVIEW_COLS = 7;
const DETECTIVE_SUMMARIES_STORAGE_KEY = 'heartburn.detectiveSummaries.v1';
const PENDING_INVESTIGATION_STORAGE_KEY = 'heartburn.pendingInvestigation.v1';

type PatternConfidence = {
  name: string;
  occurrences: number;
  confidence: number;
};

function localDayIso(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function labelForDayIso(dayIso: string): string {
  const [year, month, day] = dayIso.split('-').map((x) => Number.parseInt(x, 10));
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function shortEnvDayLabel(dayIso: string): string {
  const [year, month, day] = dayIso.split('-').map((x) => Number.parseInt(x, 10));
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function pollenLevelIndex(
  entry: PollenHistoryEntry | undefined,
  tab: PollenTypeTab
): number {
  if (!entry) return 0;
  if (tab === 'tree') return POLLEN_LEVEL_HEIGHT[entry.tree];
  if (tab === 'grass') return POLLEN_LEVEL_HEIGHT[entry.grass];
  if (tab === 'weed') return POLLEN_LEVEL_HEIGHT[entry.weed];
  return Math.max(
    POLLEN_LEVEL_HEIGHT[entry.tree],
    POLLEN_LEVEL_HEIGHT[entry.grass],
    POLLEN_LEVEL_HEIGHT[entry.weed]
  );
}

function pollenLevelFromIndex(index: number): PollenLevel {
  const levels: PollenLevel[] = ['none', 'low', 'moderate', 'high', 'very_high'];
  return levels[Math.min(4, Math.max(0, index))] ?? 'none';
}

function pollenTrendBarHeightPx(entry: PollenHistoryEntry | undefined, tab: PollenTypeTab): number {
  const level = pollenLevelFromIndex(pollenLevelIndex(entry, tab));
  return POLLEN_TREND_HEIGHT_PX[level];
}

function useDays30(dailyScores: Record<string, number>, logPresence: Record<string, boolean>) {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build 30 day entries ending today
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (29 - i));
      const iso = localDayIso(date.getTime());
      return {
        date,
        iso,
        score: dailyScores[iso] ?? 0,
        hasData: logPresence[iso] === true,
        day: date.getDate(),
        isToday: i === 29,
      };
    });

    // Find the day of week of the first day (0=Sun,1=Mon...6=Sat)
    // Convert to Mon-first index (Mon=0 ... Sun=6)
    const firstDay = days[0].date;
    const dowSun = firstDay.getDay(); // 0=Sun
    const dowMon = (dowSun + 6) % 7;  // Mon-first

    // Pad the front with null cells so day 1 lands in the right column
    const padded: (typeof days[0] | null)[] = [
      ...Array(dowMon).fill(null),
      ...days,
    ];

    // Chunk into rows of 7
    const rows: (typeof days[0] | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      rows.push(padded.slice(i, i + 7));
    }

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      while (lastRow.length < 7) {
        lastRow.push(null);
      }
    }

    const filteredRows = rows.filter(row => row.some(cell => cell !== null));

    return { days, rows: filteredRows };
  }, [dailyScores, logPresence]);
}

function yesterdayWeekdayIndex() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return (d.getDay() + 6) % 7;
}

export default function HeatmapScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { logs } = useLogs();
  const [detectiveSummaries, setDetectiveSummaries] = useState<Record<string, DetectiveDaySummary>>({});
  const [confirmedItems, setConfirmedItems] = useState<ConfirmedItem[]>([]);
  const [protectiveFactors, setProtectiveFactors] = useState<ProtectiveFactor[]>([]);
  const [pollenHistory, setPollenHistory] = useState<PollenHistoryEntry[]>([]);
  const [pollenTypeTab, setPollenTypeTab] = useState<PollenTypeTab>('all');
  const [patterns, setPatterns] = useState<PatternConfidence[]>([]);
  const [showOverviewInfo, setShowOverviewInfo] = useState(false);
  const [showTimeOfDayInfo, setShowTimeOfDayInfo] = useState(false);
  const [showIngredientInfo, setShowIngredientInfo] = useState(false);
  const [showMedInfo, setShowMedInfo] = useState(false);
  const [showPatternInfo, setShowPatternInfo] = useState(false);
  const [showPollenTrendInfo, setShowPollenTrendInfo] = useState(false);
  const [showHighPollenInfo, setShowHighPollenInfo] = useState(false);
  const [showMonthlyPatternInfo, setShowMonthlyPatternInfo] = useState(false);
  const dailyScores = useMemo(() => getDailyScores(logs), [logs]);
  const logPresence = useMemo(() => getDailyLogPresence(logs), [logs]);
  const ingredients = useMemo(() => getIngredientCorrelations(logs), [logs]);
  const medEffectiveness = useMemo(() => getMedicationEffectiveness(logs), [logs]);
  const timeGrid = useMemo(() => getTimeOfDayGrid(logs), [logs]);
  const weekSummary = useMemo(() => getWeekSummary(logs, dailyScores), [logs, dailyScores]);
  const calendarStats = useMemo(() => getCalendarStats(dailyScores, 30, logPresence), [dailyScores, logPresence]);
  const { days: days30, rows: overviewRows } = useDays30(dailyScores, logPresence);
  const [activeTab, setActiveTab] = useState<TabKey>(
    params.initialTab === 'detective' ? 'detective' :
    params.initialTab === 'insights' ? 'insights' :
    params.initialTab === 'environment' ? 'environment' : 'calendar'
  );
  const [selectedDay, setSelectedDay] = useState(() => yesterdayWeekdayIndex());

  const environmentExposures = useMemo(() => getEnvironmentExposures(logs), [logs]);
  const pollenCorrelation = useMemo(
    () => getPollenSymptomCorrelation(pollenHistory, dailyScores),
    [pollenHistory, dailyScores]
  );
  const pollenHistoryByIso = useMemo(() => {
    const map: Record<string, PollenHistoryEntry> = {};
    for (const entry of pollenHistory) map[entry.dayIso] = entry;
    return map;
  }, [pollenHistory]);
  const monthlyEnvFactors = useMemo(
    () => protectiveFactors.filter((f) => /pollen|environment/i.test(f.label)),
    [protectiveFactors]
  );
  const recentEnvExposures = useMemo(
    () => environmentExposures.slice(-14),
    [environmentExposures]
  );

  useEffect(() => {
    getConfirmedItems().then(setConfirmedItems).catch(() => {});
    getProtectiveFactors()
      .then(setProtectiveFactors)
      .catch(() => {});
    loadPollenHistory().then(setPollenHistory).catch(() => {});
    AsyncStorage.getItem(DETECTIVE_SUMMARIES_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setDetectiveSummaries(parsed);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PENDING_INVESTIGATION_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as any;
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        const next = items
          .map((item: any) => {
            if (!item || typeof item !== 'object') return null;
            if (typeof item.label !== 'string') return null;
            const occurrences =
              typeof item.occurrences === 'number' && Number.isFinite(item.occurrences) ? item.occurrences : 0;
            const confidence =
              typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? item.confidence : 0;
            if (confidence <= 0.3) return null;
            return { name: item.label, occurrences, confidence } satisfies PatternConfidence;
          })
          .filter(Boolean) as PatternConfidence[];
        setPatterns(next);
      })
      .catch(() => {});
  }, []);

  const peakSymptomWindow = useMemo(() => {
    let peakIndex = 0;
    let peakScore = 0;
    timeGrid.forEach((row, i) => {
      const total = row.reduce((sum, score) => sum + score, 0);
      if (total > peakScore) {
        peakScore = total;
        peakIndex = i;
      }
    });
    return TIME_LABELS[peakIndex];
  }, [timeGrid]);

  const bestWorstDays = useMemo(() => {
    const entries = Object.entries(dailyScores).sort(([a], [b]) => a.localeCompare(b));
    const fallbackIso = localDayIso(Date.now());
    const fallback = { iso: fallbackIso, score: dailyScores[fallbackIso] ?? 0 };
    const best = entries.reduce(
      (cur, [iso, score]) => (score < cur.score ? { iso, score } : cur),
      fallback
    );
    const worst = entries.reduce(
      (cur, [iso, score]) => (score > cur.score ? { iso, score } : cur),
      fallback
    );
    return { best, worst };
  }, [dailyScores]);

  const selectedWeekDay = weekSummary.days[selectedDay] ?? weekSummary.days[weekSummary.days.length - 1];
  const selectedDayIso = selectedWeekDay?.dayIso ?? localDayIso(Date.now());
  const selectedSummary = detectiveSummaries[selectedDayIso];
  const selectedCaseNotes = selectedSummary?.caseNotes ?? ['No AI report generated for this day yet.'];
  const selectedTip = selectedSummary?.tip;
  const bestSummary = detectiveSummaries[bestWorstDays.best.iso];
  const worstSummary = detectiveSummaries[bestWorstDays.worst.iso];
  const confirmedTriggers = confirmedItems.filter((item) => item.verdict === 'confirmed-trigger');
  const confirmedSafe = confirmedItems.filter((item) => item.verdict === 'confirmed-safe');

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
  }, []);

  const goNextTab = useCallback(() => {
    const i = TAB_KEYS.indexOf(activeTab);
    const next = TAB_KEYS[Math.min(i + 1, TAB_KEYS.length - 1)];
    if (next !== activeTab) {
      void Haptics.selectionAsync();
      handleTabChange(next);
    }
  }, [activeTab, handleTabChange]);

  const goPrevTab = useCallback(() => {
    const i = TAB_KEYS.indexOf(activeTab);
    const next = TAB_KEYS[Math.max(i - 1, 0)];
    if (next !== activeTab) {
      void Haptics.selectionAsync();
      handleTabChange(next);
    }
  }, [activeTab, handleTabChange]);

  const tabSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-36, 36])
        .failOffsetY([-22, 22])
        .onEnd((e) => {
          const dx = e.translationX;
          const vx = e.velocityX;
          const t = 56;
          const vt = 420;
          if (dx < -t || vx < -vt) {
            runOnJS(goNextTab)();
          } else if (dx > t || vx > vt) {
            runOnJS(goPrevTab)();
          }
        }),
    [goNextTab, goPrevTab],
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topHeader}>
        <View style={[styles.topHeaderInner, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.topKicker}>LAST 30 DAYS</Text>
          <Text style={styles.topTitle} accessibilityRole="header">
            Patterns
          </Text>
        </View>

        <View style={styles.tabStrip}>
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const on = activeTab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    handleTabChange(t.key);
                  }}
                  style={({ pressed }) => [styles.tabItem, on && styles.tabItemOn, { opacity: pressed ? 0.92 : 1 }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.tabItemText, on && styles.tabItemTextOn]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <SwipeWrap gesture={tabSwipeGesture}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 16 + insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
        >
        {activeTab === 'calendar' ? (
          <View>
            <View style={[styles.card, styles.scoreBarCard]}>
              <View style={styles.scoreBarCol}>
                <Text style={styles.scoreBarValue}>{bestWorstDays.worst.score}</Text>
                <Text style={styles.scoreBarLabel}>HIGHEST</Text>
                <Text style={styles.scoreBarDate}>{labelForDayIso(bestWorstDays.worst.iso)}</Text>
              </View>

              <View style={styles.scoreBarDivider} />

              <View style={styles.scoreBarCol}>
                <Text style={styles.scoreBarValue}>{bestWorstDays.best.score}</Text>
                <Text style={styles.scoreBarLabel}>LOWEST</Text>
                <Text style={styles.scoreBarDate}>{labelForDayIso(bestWorstDays.best.iso)}</Text>
              </View>

              <View style={styles.scoreBarDivider} />

              <View style={styles.scoreBarCol}>
                <Text style={styles.scoreBarValue}>{calendarStats.avgScore.toFixed(1)}</Text>
                <Text style={styles.scoreBarLabel}>30-DAY AVG</Text>
                <Text style={styles.scoreBarDate}> </Text>
              </View>
            </View>

            <View style={[styles.card, styles.overviewCalendarCard]}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>30 DAY OVERVIEW</Text>
                  <Text style={styles.overviewClearCount}>
                    {calendarStats.clearDays} day{calendarStats.clearDays !== 1 ? 's' : ''} clear in the last 30
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowOverviewInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about the 30 day overview"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              <View style={styles.grid30}>
                {/* Day-of-week header */}
                <View style={styles.grid30Header}>
                  {['M','T','W','T','F','S','S'].map((d, i) => (
                    <Text key={i} style={styles.grid30HeaderCell}>{d}</Text>
                  ))}
                </View>
                {/* Data rows */}
                {overviewRows.map((row, ri) => (
                  <View key={ri} style={styles.grid30Row}>
                    {row.map((cell, ci) => {
                      if (cell === null) {
                        return <View key={ci} style={styles.grid30Cell} />;
                      }
                      const isClear = cell.score === 0 && cell.hasData;
                      const isNoData = cell.score === 0 && !cell.hasData;
                      const tileBg = isClear ? overviewDayFill(0) : isNoData ? BG_PAGE : overviewDayFill(cell.score);
                      const tileText = isClear ? overviewDayText(0) : isNoData ? DARK_NAV : overviewDayText(cell.score);
                      return (
                        <View
                          key={ci}
                          style={[
                            styles.grid30Cell,
                            { backgroundColor: tileBg },
                            cell.isToday && styles.grid30CellToday,
                          ]}
                        >
                          <Text style={[styles.grid30DayNum, { color: tileText }]}>{cell.day}</Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
              <View style={styles.legendRow}>
                {(
                  [
                    ['Clear', overviewDayFill(0)],
                    ['No data', BG_PAGE],
                    ['Mild', overviewDayFill(1)],
                    ['Moderate', overviewDayFill(2)],
                    ['Severe', overviewDayFill(3)],
                  ] as const
                ).map(([label, bg]) => (
                  <View key={label} style={styles.legendItem}>
                    <View style={[styles.legendSwatch, { backgroundColor: bg }]} />
                    <Text style={styles.legendText}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>SYMPTOMS BY TIME OF DAY</Text>
                <Pressable
                  onPress={() => setShowTimeOfDayInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about symptoms by time of day"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              <View style={styles.timeGridRow}>
                <View style={styles.timeLabelsCol}>
                  {TIME_LABELS.map((l) => (
                    <Text key={l} style={styles.timeLabel}>
                      {l}
                    </Text>
                  ))}
                </View>
                <View style={styles.timeGridRight}>
                  <View style={styles.dayHeaderRow}>
                    {DAY_LABELS.map((d, di) => (
                      <Text key={`dow-h-${di}`} style={styles.dayHeaderCell}>
                        {d}
                      </Text>
                    ))}
                  </View>
                  {timeGrid.map((row, ri) => (
                    <View key={ri} style={styles.timeDataRow}>
                      {row.map((val, ci) => (
                        <View key={ci} style={[styles.heatCell, { backgroundColor: heatCellColor(val) }]} />
                      ))}
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.peakNote}>
                Peak symptom window: <Text style={styles.peakStrong}>{peakSymptomWindow}</Text>
              </Text>
            </View>

            <View style={styles.bestWorstRow}>
              <View style={[styles.card, styles.statCard]}>
                <Ionicons name="checkmark-circle" size={22} color={BRAND_BLUE} style={{ marginBottom: 4 }} />
                <Text style={styles.statValue}>{labelForDayIso(bestWorstDays.best.iso)}</Text>
                <Text style={styles.statLabel}>BEST DAY</Text>
                <Text style={styles.statCardHint} numberOfLines={3}>
                  {bestSummary?.caseNotes?.[0] ?? `${severityLabel(bestWorstDays.best.score)} symptom score.`}
                </Text>
              </View>
              <View style={[styles.card, styles.statCard]}>
                <Ionicons name="alert-circle" size={22} color={RISK_RED} style={{ marginBottom: 4 }} />
                <Text style={styles.statValue}>{labelForDayIso(bestWorstDays.worst.iso)}</Text>
                <Text style={styles.statLabel}>WORST DAY</Text>
                <Text style={styles.statCardHint} numberOfLines={3}>
                  {worstSummary?.caseNotes?.[0] ?? `${severityLabel(bestWorstDays.worst.score)} symptom score.`}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {activeTab === 'insights' ? (
          <View>
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>SYMPTOM TREND — 7 DAYS</Text>
              <View style={styles.trendBars}>
                {weekSummary.days.map((d, i) => (
                  <View key={i} style={styles.trendCol}>
                    <View
                      style={[
                        styles.trendBar,
                        {
                          height: Math.max(10, d.score * 22),
                          backgroundColor: overviewDayFill(d.score),
                        },
                      ]}
                    />
                    <Text style={styles.trendDay}>{d.dateLabel.split(' ')[0]}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.improvingPill}>
                <Text style={styles.improvingText}>{weekSummary.trendLabel}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>INGREDIENT RISK CORRELATION</Text>
                <Pressable
                  onPress={() => setShowIngredientInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about ingredient risk correlation"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              <Text style={styles.ingredientHint}>Bar width = frequency · Colour = symptom correlation</Text>
              {ingredients.length ? (
                ingredients.map((ing) => {
                  const barColor = insightsBandColor01(ing.symptomCorrelation);
                  return (
                    <View key={ing.name} style={styles.ingRow}>
                      <View style={styles.ingTop}>
                        <Text style={styles.ingName}>{ing.name}</Text>
                        <Text style={styles.ingPct}>
                          {Math.round(ing.symptomCorrelation * 100)}% correlation
                        </Text>
                      </View>
                      <View style={styles.ingTrack}>
                        <View
                          style={[
                            styles.ingFill,
                            { width: `${Math.min(100, ing.symptomCorrelation * 100)}%`, backgroundColor: barColor },
                          ]}
                        />
                      </View>
                      <Text style={styles.ingFreq}>Logged {ing.frequency}x this month</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.statCardHint}>Ingredient correlations will appear after repeated logged foods.</Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>MEDICATION EFFECTIVENESS</Text>
                <Pressable
                  onPress={() => setShowMedInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about medication effectiveness"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              {medEffectiveness ? (
                <>
                  <View style={styles.medRow}>
                    <View style={styles.medBoxGood}>
                      <Text style={styles.medNumGood}>{medEffectiveness.avgWithMeds.toFixed(1)}</Text>
                      <Text style={styles.medCapGood}>AVG WITH MEDS</Text>
                    </View>
                    <Text style={styles.medArrow}>→</Text>
                    <View style={styles.medBoxBad}>
                      <Text style={styles.medNumBad}>{medEffectiveness.avgWithoutMeds.toFixed(1)}</Text>
                      <Text style={styles.medCapBad}>AVG WITHOUT</Text>
                    </View>
                  </View>
                  <Text style={styles.medFoot}>
                    Medication reduces average severity by{' '}
                    <Text style={styles.medFootStrong}>{medEffectiveness.reductionPct}%</Text>
                  </Text>
                </>
              ) : (
                <Text style={styles.statCardHint}>Not enough data yet</Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>PATTERN CONFIDENCE</Text>
                <Pressable
                  onPress={() => setShowPatternInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about pattern confidence"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              {patterns.length ? (
                patterns.map((p) => {
                  const fill = insightsBandColor01(p.confidence);
                  const pctColor = insightsLabelOnBand(fill);
                  const sub =
                    p.confidence >= 0.75
                      ? 'Promote to suspect?'
                      : p.confidence >= 0.25
                        ? 'Building confidence'
                        : 'Needs more data';
                  return (
                    <View key={p.name} style={styles.patternCard}>
                      <View style={styles.patternTop}>
                        <Text style={styles.patternName}>{p.name}</Text>
                        <Text style={[styles.patternPct, { color: pctColor }]}>{Math.round(p.confidence * 100)}%</Text>
                      </View>
                      <View style={styles.patternTrack}>
                        <View style={[styles.patternFill, { width: `${p.confidence * 100}%`, backgroundColor: fill }]} />
                      </View>
                      <Text style={styles.patternSub}>
                        {p.occurrences} occurrences — {sub}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.statCardHint}>Patterns will appear as the Detective gathers more evidence.</Text>
              )}
            </View>
          </View>
        ) : null}

        {activeTab === 'detective' ? (
          <View>
            {confirmedItems.length > 0 ? (
              <View style={styles.verdictsCard}>
                <Text style={styles.sectionLabel}>VERDICTS</Text>
                <View style={styles.verdictsRow}>
                  {confirmedTriggers.length > 0 ? (
                    <View style={styles.verdictsCol}>
                      <View style={styles.verdictsColLabelRow}>
                        <Ionicons name="warning" size={15} color="#d97706" />
                        <Text style={styles.verdictsColLabel}>Confirmed Triggers</Text>
                      </View>
                      {confirmedTriggers.map((item) => (
                        <View key={item.id}>
                          <View style={[styles.verdictPill, { backgroundColor: DARK_NAV }]}>
                            <Text style={styles.verdictPillText}>{item.label}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {confirmedSafe.length > 0 ? (
                    <View style={styles.verdictsCol}>
                      <View style={styles.verdictsColLabelRow}>
                        <Ionicons name="checkmark-circle" size={16} color="#2d6a4f" />
                        <Text style={styles.verdictsColLabel}>Confirmed Safe</Text>
                      </View>
                      {confirmedSafe.map((item) => (
                        <View key={item.id}>
                          <View style={[styles.verdictPill, { backgroundColor: RISK_GREEN }]}>
                            <Text style={styles.verdictPillText}>{item.label}</Text>
                          </View>
                          {item.safeThreshold ? (
                            <Text style={styles.verdictThreshold}>{item.safeThreshold}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {protectiveFactors.length > 0 && (
              <View style={styles.protectiveCard}>
                <Text style={styles.sectionLabel}>WHAT&apos;S WORKING</Text>
                <Text style={styles.protectiveIntro}>
                  These factors appear consistently on your clearest days.
                </Text>
                {protectiveFactors.map((f) => (
                  <View key={f.id} style={styles.protectiveRow}>
                    <View style={styles.protectivePill}>
                      <Ionicons name="checkmark-circle" size={15} color="#2d6a4f" />
                      <Text style={styles.protectivePillText}>{f.label}</Text>
                    </View>
                    <Text style={styles.protectiveMeta}>
                      Confirmed {f.monthLabel}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.detectivePickLabel}>SELECT A DAY</Text>
            <View style={styles.dayChipsRow}>
              {weekSummary.days.map((d, i) => {
                const sel = selectedDay === i;
                const score = dailyScores[d.dayIso] ?? 0;
                const dotFill = sel && score === 0 ? 'rgba(255,255,255,0.92)' : severityDot(score);
                return (
                  <Pressable
                    key={d.dayIso}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSelectedDay(i);
                    }}
                    style={[styles.dayChip, sel && styles.dayChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sel }}
                  >
                    <Text style={[styles.dayChipDow, sel && styles.dayChipDowOn]} numberOfLines={1}>
                      {d.dateLabel.split(' ')[0].toUpperCase()}
                    </Text>
                    <Text style={[styles.dayChipNum, sel && styles.dayChipNumOn]}>{d.dateLabel.split(' ')[1]}</Text>
                    <View style={[styles.dayChipDot, { backgroundColor: dotFill }]} />
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.card, styles.daySummaryHero]}>
              <View style={styles.daySummaryTop}>
                <Text style={styles.daySummaryHeroTitle}>{selectedWeekDay?.dateLabel ?? 'Today'}</Text>
              </View>
              <Text style={styles.daySummaryTopIng}>
                Top ingredient:{' '}
                <Text style={styles.daySummaryTopIngStrong}>{selectedSummary?.topIngredient ?? '—'}</Text>
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>DETECTIVE&apos;S CASE NOTES</Text>
              {selectedCaseNotes.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepLeft}>
                    <View style={styles.stepNum}>
                      <Text style={styles.stepNumText}>{i + 1}</Text>
                    </View>
                    {i < selectedCaseNotes.length - 1 ? <View style={styles.stepLine} /> : null}
                  </View>
                  <Text style={styles.stepBody}>{step}</Text>
                </View>
              ))}
            </View>

            {selectedTip ? (
              <View style={styles.tipCard}>
                <Text style={styles.tipKicker}>DETECTIVE&apos;S TIP</Text>
                <Text style={styles.tipBody}>{selectedTip}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {activeTab === 'environment' ? (
          <View>
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>ENVIRONMENT LOG</Text>
              {recentEnvExposures.length === 0 ? (
                <Text style={styles.statCardHint}>
                  Log environment exposures on the home screen to see them here.
                </Text>
              ) : (
                recentEnvExposures.map((row) => {
                  const score = dailyScores[row.dayIso] ?? 0;
                  return (
                    <View key={row.dayIso} style={styles.envLogRow}>
                      <Text style={styles.envLogDay}>{shortEnvDayLabel(row.dayIso)}</Text>
                      <View
                        style={[styles.envLogDot, { backgroundColor: overviewDayFill(score) }]}
                      />
                      <Text style={styles.envLogLabels} numberOfLines={2}>
                        {row.labels.join(', ')}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>POLLEN TREND — 7 DAYS</Text>
                <Pressable
                  onPress={() => setShowPollenTrendInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about pollen trend"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              {pollenHistory.length === 0 ? (
                <Text style={styles.statCardHint}>
                  Pollen data will appear here after your first outdoor log.
                </Text>
              ) : (
                <>
                  <View style={styles.pollenTypeTabRow}>
                    {(['all', 'tree', 'grass', 'weed'] as const).map((key) => {
                      const on = pollenTypeTab === key;
                      return (
                        <Pressable
                          key={key}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setPollenTypeTab(key);
                          }}
                          style={[styles.pollenTypePill, on && styles.pollenTypePillOn]}
                        >
                          <Text style={[styles.pollenTypePillText, on && styles.pollenTypePillTextOn]}>
                            {key === 'all' ? 'ALL' : key.toUpperCase()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.trendBars}>
                    {weekSummary.days.map((d) => {
                      const entry = pollenHistoryByIso[d.dayIso];
                      const pollenH = pollenTrendBarHeightPx(entry, pollenTypeTab);
                      const hasPollen = pollenH > 0;
                      const symptomH = Math.max(10, Math.min(3, Math.max(0, d.score)) * 22);
                      return (
                        <View key={d.dayIso} style={styles.trendCol}>
                          <View style={styles.pollenTrendPair}>
                            <View
                              style={[
                                styles.pollenTrendBar,
                                {
                                  height: hasPollen ? pollenH : 10,
                                  backgroundColor: hasPollen ? POLLEN_TEAL : BG_PAGE,
                                },
                              ]}
                            />
                            <View
                              style={[
                                styles.pollenTrendBar,
                                {
                                  height: symptomH,
                                  backgroundColor: d.score > 0 ? overviewDayFill(d.score) : BG_PAGE,
                                },
                              ]}
                            />
                          </View>
                          <Text style={styles.trendDay}>{d.dateLabel.split(' ')[0]}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.pollenTrendLegendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendSwatch, { backgroundColor: POLLEN_TEAL }]} />
                      <Text style={styles.pollenTrendLegendText}>Pollen level</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View
                        style={[styles.legendSwatch, { backgroundColor: overviewDayFill(1) }]}
                      />
                      <Text style={styles.pollenTrendLegendText}>Symptom score</Text>
                    </View>
                  </View>
                </>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>HIGH POLLEN DAYS</Text>
                <Pressable
                  onPress={() => setShowHighPollenInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about high pollen days"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              {pollenCorrelation ? (
                <>
                  <View style={styles.statsRow}>
                    <View style={[styles.statCard, { marginBottom: 0 }]}>
                      <Text style={styles.statValue}>{pollenCorrelation.highPollenAvg}</Text>
                      <Text style={styles.statLabel}>High Pollen Days</Text>
                    </View>
                    <View style={[styles.statCard, { marginBottom: 0 }]}>
                      <Text style={styles.statValue}>{pollenCorrelation.lowPollenAvg}</Text>
                      <Text style={styles.statLabel}>Low Pollen Days</Text>
                    </View>
                  </View>
                  <Text style={styles.pollenCorrFoot}>
                    Based on {pollenCorrelation.sampleSize} days of combined data.
                  </Text>
                  {pollenCorrelation.highPollenAvg > pollenCorrelation.lowPollenAvg + 0.3 ? (
                    <Text style={styles.pollenCorrWarn}>
                      Your symptoms tend to be worse on high pollen days.
                    </Text>
                  ) : (
                    <Text style={styles.pollenCorrNeutral}>
                      No clear pollen–symptom link in your data yet.
                    </Text>
                  )}
                </>
              ) : (
                <View style={styles.envCollectingWrap}>
                  <Ionicons name="leaf-outline" size={28} color="#cbd5e1" />
                  <Text style={styles.envCollectingTitle}>Collecting data</Text>
                  <Text style={styles.envCollectingSub}>
                    Check back after a few weeks of pollen tracking.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, styles.sectionLabelInHeader]}>MONTHLY PATTERN</Text>
                <Pressable
                  onPress={() => setShowMonthlyPatternInfo(true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sectionInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Learn about monthly pattern"
                >
                  <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
                </Pressable>
              </View>
              {monthlyEnvFactors.length > 0 ? (
                monthlyEnvFactors.map((f) => (
                  <View key={f.id} style={styles.protectiveRow}>
                    <View style={styles.envMonthlyPill}>
                      <Ionicons name="checkmark" size={14} color="#ffffff" />
                      <Text style={styles.envMonthlyPillText}>{f.label}</Text>
                    </View>
                    <Text style={styles.protectiveMeta}>Confirmed {f.monthLabel}</Text>
                  </View>
                ))
              ) : (
                <View style={styles.envCollectingWrap}>
                  <Ionicons name="time-outline" size={28} color="#cbd5e1" />
                  <Text style={styles.envCollectingTitle}>Collecting data</Text>
                  <Text style={styles.envCollectingSub}>
                    Monthly patterns appear after 28+ days of logging.
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : null}
        </ScrollView>
      </SwipeWrap>

      <AppModal
        visible={showOverviewInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOverviewInfo(false)}
      >
        <Pressable
          style={styles.infoModalBackdrop}
          onPress={() => setShowOverviewInfo(false)}
        >
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="calendar-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>30 Day Overview</Text>
                <Pressable onPress={() => setShowOverviewInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A colour-coded grid showing every day of the past 30 days. Each cell represents one day and is coloured based on your worst symptom that day.</Text>
              </View>
              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>READING THE COLOURS</Text>
                <Text style={styles.infoModalSectionText}>Light blue-grey means a fully clear day with no symptoms logged. Grey means no data was logged that day. Progressively darker blues indicate mild, moderate, and severe symptom days respectively.</Text>
              </View>
              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>Look for patterns across the week columns — do symptoms cluster on certain days? A run of light cells is your clear streak. Use this view alongside the Detective tab to understand what changed on darker days.</Text>
              </View>

              <Pressable
                onPress={() => setShowOverviewInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showTimeOfDayInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTimeOfDayInfo(false)}
      >
        <Pressable
          style={styles.infoModalBackdrop}
          onPress={() => setShowTimeOfDayInfo(false)}
        >
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="time-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>Symptoms by Time of Day</Text>
                <Pressable onPress={() => setShowTimeOfDayInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A heatmap grid showing when during the day your symptoms tend to occur, broken down by day of the week. Rows are 2-hour time windows, columns are days Monday to Sunday.</Text>
              </View>
              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>READING THE GRID</Text>
                <Text style={styles.infoModalSectionText}>A coloured cell means a symptom was logged in that time window on that day of the week. Darker colours mean more severe symptoms. Empty cells mean no symptoms were logged in that window.</Text>
              </View>
              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>The &quot;Peak symptom window&quot; below the grid tells you when you are most likely to experience symptoms. If your peak is in the morning, consider what you ate or drank the night before. If it is after meals, look at portion sizes and eating pace. This view is most useful after 2 or more weeks of logging.</Text>
              </View>

              <Pressable
                onPress={() => setShowTimeOfDayInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showIngredientInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowIngredientInfo(false)}
      >
        <Pressable style={styles.infoModalBackdrop} onPress={() => setShowIngredientInfo(false)}>
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="bar-chart-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>Ingredient Risk Correlation</Text>
                <Pressable onPress={() => setShowIngredientInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A list of ingredients you have logged this month, ranked by how often symptoms appeared within 6 hours of eating them.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>READING THE BAR AND COLOUR</Text>
                <Text style={styles.infoModalSectionText}>The bar colour shows symptom correlation — light blue-grey means low, progressively darker blues mean moderate and high. An ingredient logged 8 times at 25% correlation appeared before symptoms twice out of those eight occasions.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>IMPORTANT TO UNDERSTAND</Text>
                <Text style={styles.infoModalSectionText}>Correlation is not the same as cause. An item appearing here does not mean it definitely triggered your symptoms — portion size, stress, or other foods eaten that day all play a role. This list is where the Detective starts investigating, not a verdict.</Text>
              </View>

              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>Focus on items with both high correlation and high frequency — those are the ones worth paying attention to. A single item at 50% means it appeared before one symptom in two logs. That is early signal, not confirmed evidence.</Text>
              </View>

              <Pressable
                onPress={() => setShowIngredientInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showMedInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMedInfo(false)}
      >
        <Pressable style={styles.infoModalBackdrop} onPress={() => setShowMedInfo(false)}>
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="medkit-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>Medication Effectiveness</Text>
                <Pressable onPress={() => setShowMedInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A comparison of your average symptom severity on days when you took medication versus days when you did not, based on your logged data.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>HOW TO READ IT</Text>
                <Text style={styles.infoModalSectionText}>The left number is your average symptom score on days with medication. The right number is your average without. A lower left number means medication is helping. The percentage below shows by how much.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT COUNTS AS MEDICATION?</Text>
                <Text style={styles.infoModalSectionText}>Any log from your Meds tab counts — Gaviscon, Omeprazole, Lansoprazole, and others. The comparison only runs when there is enough data on both sides, which is why it shows &quot;Not enough data yet&quot; early on.</Text>
              </View>

              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>If the reduction percentage is low or the two numbers are similar, it may be worth discussing your current medication with a doctor. This is not a medical recommendation — it is a personal pattern from your own logs to help inform that conversation.</Text>
              </View>

              <Pressable
                onPress={() => setShowMedInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showPatternInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPatternInfo(false)}
      >
        <Pressable style={styles.infoModalBackdrop} onPress={() => setShowPatternInfo(false)}>
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="search-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>Pattern Confidence</Text>
                <Pressable onPress={() => setShowPatternInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A list of ingredients and behaviours the AI detective is actively investigating as potential triggers, along with how confident it currently is based on your logged data.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT THE PERCENTAGE MEANS</Text>
                <Text style={styles.infoModalSectionText}>Confidence builds each time an item appears before symptoms, and drops slightly when you consume it without any symptoms following. It is not a simple count — it accounts for how consistently the item correlates with bad days.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>THE THRESHOLDS</Text>
                <Text style={styles.infoModalSectionText}>Under 40% means the AI is still gathering evidence. 40–69% means a pattern is forming and worth watching. 70% and above with 3 or more occurrences is when the AI will recommend promoting the item to your confirmed trigger list.</Text>
              </View>

              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>Items in the 40–69% range are your watch list. Try reducing them one at a time and logging carefully — if confidence drops, that is a good sign. If it keeps climbing, you have likely found a real trigger.</Text>
              </View>

              <Pressable
                onPress={() => setShowPatternInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showPollenTrendInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPollenTrendInfo(false)}
      >
        <Pressable style={styles.infoModalBackdrop} onPress={() => setShowPollenTrendInfo(false)}>
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="leaf-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>Pollen Trend</Text>
                <Pressable onPress={() => setShowPollenTrendInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A dual bar chart showing your pollen exposure and symptom score side by side for each day of the past 7 days. Teal bars are pollen level, darker green bars are your symptom score for that day.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>READING THE POLLEN SCALE</Text>
                <Text style={[styles.infoModalSectionText, { marginBottom: 12 }]}>Pollen bar height represents one of five levels. This is what each height means:</Text>
                <View style={styles.pollenScaleRow}>
                  {([
                    { label: 'None', height: 0 },
                    { label: 'Low', height: 12 },
                    { label: 'Moderate', height: 24 },
                    { label: 'High', height: 36 },
                    { label: 'Very High', height: 48 },
                  ] as const).map((level) => (
                    <View key={level.label} style={styles.pollenScaleCol}>
                      <View style={styles.pollenScaleBarWrap}>
                        <View
                          style={[
                            styles.pollenScaleBar,
                            {
                              height: level.height > 0 ? level.height : 4,
                              backgroundColor: level.height > 0 ? POLLEN_TEAL : BORDER,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.pollenScaleLabel}>{level.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHY THEY DON&apos;T ALWAYS MATCH</Text>
                <Text style={styles.infoModalSectionText}>A high pollen bar on a day with no symptom bar does not mean pollen had no effect — you may not have logged symptoms, or your body&apos;s reaction can be delayed. The pattern becomes more meaningful over several weeks.</Text>
              </View>

              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>Look for days where both bars are tall — those are your clearest pollen-symptom correlation days. Use the TREE / GRASS / WEED filters to narrow down which type of pollen you react to most.</Text>
              </View>

              <Pressable
                onPress={() => setShowPollenTrendInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showHighPollenInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHighPollenInfo(false)}
      >
        <Pressable style={styles.infoModalBackdrop} onPress={() => setShowHighPollenInfo(false)}>
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="analytics-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>High Pollen Days</Text>
                <Pressable onPress={() => setShowHighPollenInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>A comparison of your average symptom severity on high pollen days versus low pollen days, calculated from all your combined pollen and symptom data.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT COUNTS AS HIGH POLLEN?</Text>
                <Text style={styles.infoModalSectionText}>Any day where the recorded pollen level was High or Very High. Low pollen days are those recorded as None or Low. The section needs at least 3 days of each type before it shows a comparison — which is why it shows &quot;Collecting data&quot; early on.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>HOW TO READ IT</Text>
                <Text style={styles.infoModalSectionText}>If the high pollen average is notably larger than the low pollen average, pollen is likely a contributing factor to your symptoms. If they are similar, your symptoms are probably driven more by food and other triggers than by pollen.</Text>
              </View>

              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>This is one of the most useful sections for separating environmental from dietary triggers. If your high pollen score is consistently higher, focus on your Itchy Eyes and Sneezing symptom logs alongside your ENV entries — the Detective will start building that correlation over time.</Text>
              </View>

              <Pressable
                onPress={() => setShowHighPollenInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <AppModal
        visible={showMonthlyPatternInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMonthlyPatternInfo(false)}
      >
        <Pressable style={styles.infoModalBackdrop} onPress={() => setShowMonthlyPatternInfo(false)}>
          <View style={styles.infoModalCenter}>
            <Pressable style={styles.infoModalCard} onPress={() => {}}>
              <View style={styles.infoModalHeaderRow}>
                <View style={styles.infoModalIconWrap}>
                  <Ionicons name="calendar-outline" size={16} color={DARK_NAV} />
                </View>
                <Text style={[styles.infoModalTitle, { flex: 1, marginLeft: 10 }]}>Monthly Pattern</Text>
                <Pressable onPress={() => setShowMonthlyPatternInfo(false)} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color={DARK_NAV} />
                </Pressable>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS IT?</Text>
                <Text style={styles.infoModalSectionText}>Protective factors and environmental patterns identified by the monthly AI review — things that correlate with your better days, specifically related to pollen and environment.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHAT IS A PROTECTIVE FACTOR?</Text>
                <Text style={styles.infoModalSectionText}>The opposite of a trigger. If certain environmental conditions consistently appear on your symptom-free days — low pollen, no dusty environments, no air conditioning — the monthly agent surfaces them here as things that may be helping you.</Text>
              </View>

              <View style={styles.infoModalSection}>
                <Text style={styles.infoModalSectionLabel}>WHEN DOES IT APPEAR?</Text>
                <Text style={styles.infoModalSectionText}>The monthly agent runs after 28 or more days of data. It looks across all your daily summaries and identifies patterns that are too slow-moving to spot day to day.</Text>
              </View>

              <View style={[styles.infoModalSection, styles.infoModalSectionHighlight]}>
                <Text style={[styles.infoModalSectionLabel, styles.infoModalSectionLabelHighlight]}>HOW TO USE IT</Text>
                <Text style={[styles.infoModalSectionText, styles.infoModalSectionTextHighlight]}>Think of these as conditions worth preserving rather than just triggers to avoid. If &quot;low pollen days&quot; appears here, the AI is telling you your clearest days tend to cluster when pollen is down — useful context for planning ahead during high season.</Text>
              </View>

              <Pressable
                onPress={() => setShowMonthlyPatternInfo(false)}
                style={({ pressed }) => [styles.infoModalCloseBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.infoModalCloseBtnText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </AppModal>

      <BottomSafeAreaShield />
    </View>
  );
}

// On web the pan handler sets touch-action:none and blocks native touch scrolling, so only wrap on native.
function SwipeWrap({ gesture, children }: { gesture: ReturnType<typeof Gesture.Pan>; children: React.ReactElement }) {
  if (Platform.OS === 'web') return children;
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 14 },
  topHeader: {
    backgroundColor: BG_PAGE,
    paddingBottom: 10,
  },
  topHeaderInner: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  topKicker: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    letterSpacing: 1,
    color: '#94a3b8',
    marginBottom: 6,
  },
  topTitle: {
    fontFamily: 'OutfitBold',
    fontSize: 32,
    color: DARK_NAV,
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    zIndex: 2,
  },
  tabStrip: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: APP_RADIUS,
    padding: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: APP_RADIUS,
  },
  tabItemOn: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tabItemText: { fontFamily: 'OutfitBlack', fontSize: 12, color: '#64748b' },
  tabItemTextOn: { color: DARK_NAV },
  card: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.5,
    color: SLATE_MUTED,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
    alignItems: 'stretch',
  },
  statCard: { flex: 1, alignItems: 'center', marginBottom: 0, paddingVertical: 12, paddingHorizontal: 8 },
  scoreBarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  scoreBarCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  scoreBarDivider: {
    width: 1,
    height: 54,
    backgroundColor: BORDER,
  },
  scoreBarValue: {
    fontFamily: 'OutfitBlack',
    fontSize: 24,
    color: DARK_NAV,
    lineHeight: 28,
  },
  scoreBarLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.1,
    color: SLATE_MUTED,
  },
  scoreBarDate: {
    fontFamily: 'Outfit',
    fontSize: 11,
    color: SLATE_MUTED,
    textAlign: 'center',
    marginTop: 1,
  },
  overviewClearCount: {
    fontFamily: 'Outfit',
    fontSize: 11,
    color: SLATE,
    marginTop: 2,
  },
  sectionLabelInHeader: {
    marginBottom: 0,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionInfoBtn: {
    width: 28,
    height: 28,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  infoModalCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  infoModalCard: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 16,
    elevation: 6,
  },
  infoModalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoModalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoModalTitle: {
    fontFamily: 'OutfitBlack',
    fontSize: 16,
    color: DARK_NAV,
  },
  infoModalSection: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoModalSectionHighlight: {
    backgroundColor: RISK_GREEN,
    borderColor: RISK_GREEN,
  },
  infoModalSectionLabelHighlight: {
    color: '#fff',
  },
  infoModalSectionTextHighlight: {
    color: '#fff',
  },
  infoModalSectionLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 9,
    letterSpacing: 1,
    color: SLATE,
    marginBottom: 6,
  },
  infoModalSectionText: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: '#334155',
    lineHeight: 20,
  },
  infoModalCloseBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: APP_RADIUS,
    backgroundColor: RISK_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoModalCloseBtnText: {
    fontFamily: 'OutfitBlack',
    fontSize: 12,
    letterSpacing: 1,
    color: '#fff',
  },
  pollenScaleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  pollenScaleCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  pollenScaleBarWrap: {
    height: 52,
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
  },
  pollenScaleBar: {
    width: 14,
    borderTopLeftRadius: APP_RADIUS,
    borderTopRightRadius: APP_RADIUS,
  },
  pollenScaleLabel: {
    fontFamily: 'Outfit',
    fontSize: 8,
    color: SLATE_MUTED,
    textAlign: 'center',
  },
  statValue: { fontFamily: 'OutfitBlack', fontSize: 20, color: DARK_NAV },
  statLabel: {
    marginTop: 2,
    fontFamily: 'OutfitBlack',
    fontSize: 9,
    color: SLATE_MUTED,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  statCardHint: {
    marginTop: 6,
    fontFamily: 'Outfit',
    fontSize: 10,
    lineHeight: 14,
    color: SLATE,
    textAlign: 'center',
  },
  overviewCalendarCard: {
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  grid30: {
    width: '100%',
    gap: 3,
  },
  grid30Header: {
    flexDirection: 'row',
    gap: 3,
    marginBottom: 2,
  },
  grid30HeaderCell: {
    flex: 1,
    fontFamily: 'OutfitBlack',
    fontSize: 8,
    color: SLATE_MUTED,
    textAlign: 'center',
  },
  grid30Row: {
    flexDirection: 'row',
    gap: 3,
  },
  grid30Cell: {
    flex: 1,
    height: 28,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  grid30CellToday: {
    borderWidth: 2,
    borderColor: DARK_NAV,
  },
  grid30DayNum: {
    fontFamily: 'OutfitBlack',
    fontSize: 9,
  },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: APP_RADIUS, borderWidth: 1, borderColor: BORDER },
  legendText: { fontFamily: 'OutfitBold', fontSize: 9, color: SLATE },
  timeGridRow: { flexDirection: 'row', gap: 6 },
  timeLabelsCol: { paddingTop: 16, gap: 3 },
  timeLabel: { height: 18, width: 32, fontFamily: 'OutfitBold', fontSize: 8, color: SLATE_MUTED, textAlign: 'right' },
  timeGridRight: { flex: 1 },
  dayHeaderRow: { flexDirection: 'row', marginBottom: 4, gap: 3 },
  dayHeaderCell: { flex: 1, textAlign: 'center', fontFamily: 'OutfitBlack', fontSize: 9, color: SLATE_MUTED },
  timeDataRow: { flexDirection: 'row', gap: 3, marginBottom: 3 },
  heatCell: { flex: 1, height: 18, borderRadius: APP_RADIUS},
  peakNote: {
    marginTop: 10,
    fontFamily: 'Outfit',
    fontSize: 11,
    color: SLATE,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  peakStrong: { fontFamily: 'OutfitBold', color: DARK_NAV, fontStyle: 'normal' },
  bestWorstRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  trendBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 86, paddingBottom: 4 },
  trendCol: { flex: 1, alignItems: 'center', gap: 4 },
  trendBar: { width: '100%', borderTopLeftRadius: APP_RADIUS, borderTopRightRadius: APP_RADIUS},
  trendDay: { fontFamily: 'OutfitBold', fontSize: 9, color: DARK_NAV },
  pollenTrendPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    width: '100%',
  },
  pollenTrendBar: {
    flex: 1,
    maxWidth: 16,
    borderTopLeftRadius: APP_RADIUS,
    borderTopRightRadius: APP_RADIUS,
    minHeight: 0,
  },
  pollenTypeTabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pollenTypePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: APP_RADIUS,
    backgroundColor: 'transparent',
  },
  pollenTypePillOn: {
    backgroundColor: '#0f172a',
  },
  pollenTypePillText: {
    fontFamily: 'Outfit',
    fontSize: 11,
    letterSpacing: 0.5,
    color: '#94a3b8',
  },
  pollenTypePillTextOn: {
    fontFamily: 'OutfitBold',
    color: '#ffffff',
  },
  pollenTrendLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 10,
  },
  pollenTrendLegendText: {
    fontFamily: 'Outfit',
    fontSize: 11,
    color: SLATE,
  },
  envCollectingWrap: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  envCollectingTitle: {
    marginTop: 8,
    fontFamily: 'OutfitBold',
    fontSize: 14,
    color: '#64748b',
  },
  envCollectingSub: {
    marginTop: 4,
    fontFamily: 'Outfit',
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 12,
    lineHeight: 17,
  },
  improvingPill: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: SEVERITY_CLEAR,
    borderRadius: APP_RADIUS,
  },
  improvingText: { fontFamily: 'OutfitBold', fontSize: 11, color: SEVERITY_SEVERE, textAlign: 'center' },
  ingredientHint: { fontFamily: 'Outfit', fontSize: 10, color: SLATE_MUTED, marginBottom: 12 },
  ingRow: { marginBottom: 10 },
  ingTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  ingName: { fontFamily: 'OutfitBold', fontSize: 12, color: DARK_NAV },
  ingPct: { fontFamily: 'OutfitBlack', fontSize: 10, color: DARK_NAV },
  ingTrack: { height: 8, backgroundColor: '#f1f5f9', borderRadius: APP_RADIUS, overflow: 'hidden' },
  ingFill: { height: '100%', borderRadius: APP_RADIUS},
  ingFreq: { fontFamily: 'Outfit', fontSize: 9, color: SLATE_MUTED, marginTop: 2 },
  medRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  medBoxGood: {
    flex: 1,
    padding: 12,
    backgroundColor: SEVERITY_CLEAR,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
  },
  medNumGood: { fontFamily: 'OutfitBlack', fontSize: 22, color: SEVERITY_SEVERE },
  medCapGood: { fontFamily: 'OutfitBlack', fontSize: 10, color: SEVERITY_MODERATE, marginTop: 2 },
  medArrow: { fontSize: 18, color: SLATE },
  medBoxBad: {
    flex: 1,
    padding: 12,
    backgroundColor: SEVERITY_SEVERE,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
  },
  medNumBad: { fontFamily: 'OutfitBlack', fontSize: 22, color: '#ffffff' },
  medCapBad: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#ffffff', marginTop: 2 },
  medFoot: { marginTop: 10, fontFamily: 'Outfit', fontSize: 11, color: SLATE, textAlign: 'center', fontStyle: 'italic' },
  medFootStrong: { fontFamily: 'OutfitBold', color: SEVERITY_MODERATE, fontStyle: 'normal' },
  patternCard: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: BG_PAGE,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
  },
  patternTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  patternName: { flex: 1, fontFamily: 'OutfitBold', fontSize: 12, color: DARK_NAV, paddingRight: 8 },
  patternPct: { fontFamily: 'OutfitBlack', fontSize: 11 },
  patternTrack: { height: 6, backgroundColor: '#fff', borderRadius: APP_RADIUS, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  patternFill: { height: '100%', borderRadius: APP_RADIUS},
  patternSub: { fontFamily: 'Outfit', fontSize: 9, color: SLATE_MUTED, marginTop: 4 },
  detectivePickLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.2,
    color: SLATE_MUTED,
    marginBottom: 10,
    marginLeft: 4,
  },
  verdictsCard: {
    borderRadius: APP_RADIUS,
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 14,
  },
  verdictsRow: { flexDirection: 'row', gap: 12 },
  verdictsCol: { flex: 1 },
  verdictsColLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  verdictsColLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    color: DARK_NAV,
  },
  verdictPill: {
    borderRadius: APP_RADIUS,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  verdictPillText: {
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: '#fff',
  },
  verdictThreshold: {
    fontFamily: 'Outfit',
    fontSize: 9,
    color: SLATE_MUTED,
    marginBottom: 6,
  },
  protectiveCard: {
    borderRadius: APP_RADIUS,
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 14,
  },
  protectiveIntro: {
    fontFamily: 'Outfit',
    fontSize: 12,
    color: SLATE,
    marginBottom: 12,
    lineHeight: 18,
  },
  protectiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  protectivePill: {
    borderRadius: APP_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: 'rgba(45, 106, 79, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(45, 106, 79, 0.35)',
  },
  protectivePillText: {
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: '#2d6a4f',
  },
  protectiveMeta: {
    fontFamily: 'Outfit',
    fontSize: 10,
    color: SLATE_MUTED,
  },
  dayChipsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 14,
    width: '100%',
  },
  dayChip: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  dayChipOn: { borderColor: DARK_NAV, backgroundColor: DARK_NAV },
  dayChipDow: { fontFamily: 'OutfitBlack', fontSize: 8, color: SLATE_MUTED, letterSpacing: 0.2, textAlign: 'center' },
  dayChipDowOn: { color: 'rgba(255,255,255,0.65)' },
  dayChipNum: { fontFamily: 'OutfitBlack', fontSize: 13, color: DARK_NAV, marginTop: 2 },
  dayChipNumOn: { color: '#fff' },
  dayChipDot: { width: 6, height: 6, borderRadius: APP_RADIUS, marginTop: 4 },
  daySummaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  daySummaryHero: {},
  daySummaryHeroTitle: {
    fontFamily: 'OutfitBlack',
    fontSize: 15,
    color: DARK_NAV,
    flex: 1,
    paddingRight: 8,
  },
  daySummaryTopIng: {
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: DARK_NAV,
  },
  daySummaryTopIngStrong: {
    color: DARK_NAV,
    fontFamily: 'OutfitBlack',
  },
  stepRow: { flexDirection: 'row', gap: 12, paddingBottom: 14 },
  stepLeft: { alignItems: 'center', width: 24 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: APP_RADIUS,
    backgroundColor: DARK_NAV,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#fff' },
  stepLine: { width: 1, flex: 1, backgroundColor: BORDER, marginTop: 4, minHeight: 20 },
  stepBody: { flex: 1, fontFamily: 'OutfitBold', fontSize: 13, color: '#334155', lineHeight: 20, paddingTop: 2 },
  tipCard: {
    borderRadius: APP_RADIUS,
    padding: 16,
    backgroundColor: DARK_NAV,
    marginBottom: 8,
  },
  tipKicker: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  tipBody: { fontFamily: 'OutfitBold', fontSize: 13, lineHeight: 20, color: 'rgba(255,255,255,0.88)' },
  envLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  envLogDay: {
    width: 52,
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: DARK_NAV,
  },
  envLogDot: { width: 8, height: 8, borderRadius: APP_RADIUS},
  envLogLabels: {
    flex: 1,
    fontFamily: 'Outfit',
    fontSize: 12,
    color: SLATE,
    lineHeight: 16,
  },
  pollenCorrFoot: {
    marginTop: 8,
    fontFamily: 'Outfit',
    fontSize: 11,
    color: SLATE,
    textAlign: 'center',
  },
  pollenCorrWarn: {
    marginTop: 10,
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: RISK_RED,
    textAlign: 'center',
    lineHeight: 16,
  },
  envMonthlyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: APP_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: RISK_GREEN,
    borderWidth: 1,
    borderColor: RISK_GREEN,
  },
  envMonthlyPillText: {
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: '#ffffff',
  },
  pollenCorrNeutral: {
    marginTop: 10,
    fontFamily: 'Outfit',
    fontSize: 11,
    color: SLATE_MUTED,
    textAlign: 'center',
    lineHeight: 16,
  },
});
