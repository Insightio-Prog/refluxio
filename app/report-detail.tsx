import { Ionicons } from '@expo/vector-icons';
import { Outfit_300Light, Outfit_400Regular, Outfit_700Bold, Outfit_900Black, useFonts } from '@expo-google-fonts/outfit';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AppModal from '@/components/AppModal';

import { generateDailyReportStreaming, GeminiOverwhelmedError } from '@/services/ai-service';
import { getLastMonthlyReview, type MonthlyReviewReport } from '@/services/monthly-agent';
import { getYesterdayISO } from '@/utils/date-utils';
import { prepareAiContext } from '@/utils/prepare-ai-context';
import { addLog as addLogToStore } from '@/hooks/use-log-store';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { APP_RADIUS } from '@/constants/theme';

type ReportData = {
  headline: string;
  body: string;
  detectiveLog?: string[];
  strategy: string[];
  promoteRecommendations?: { id: string; label: string; reason: string; occurrences?: number; confidence?: number }[];
  needMoreInfo?: { question: string; answeredAtTs?: number; answerLogId?: string };
  dailyRiskGuide?: Record<string, number>;
  promotionChoices?: Record<string, 'yes' | 'no'>;
};

const BG = '#f8fafc';
const DARK = '#0f172a';
const REPORT_CARD = '#dbe4f0';
const SLATE = '#475569';
const BORDER = '#e2e8f0';

function reportKickerForDayIso(dayIso: string): string {
  const d = new Date(dayIso + 'T12:00:00');
  const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
  return `DAILY REPORT · ${datePart}`;
}

function reportTitleForDayIso(dayIso: string): string {
  if (dayIso === getYesterdayISO()) return 'Yesterday';
  const d = new Date(dayIso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long' });
}

function shortDateTabLabel(dayIso: string): string {
  const d = new Date(dayIso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const SLEEP_LOG_STORAGE_KEY = 'heartburn.sleepLog.v1';

type SleepEntry = {
  dayIso: string;
  bedtime: string;
  wakeTime: string;
  nightSymptoms: ('none' | 'heartburn' | 'cough' | 'disrupted')[];
};

function safeParseReportData(raw: unknown): ReportData | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.headline !== 'string' || typeof parsed.body !== 'string') return null;
    const strategy = Array.isArray(parsed.strategy) ? parsed.strategy.filter((x: any) => typeof x === 'string') : [];
    const detectiveLog = Array.isArray(parsed.detectiveLog) ? parsed.detectiveLog.filter((x: any) => typeof x === 'string') : undefined;
    const promoteRecommendations = Array.isArray(parsed.promoteRecommendations)
      ? parsed.promoteRecommendations
          .map((x: any) => {
            if (!x || typeof x !== 'object') return null;
            if (typeof x.id !== 'string' || typeof x.label !== 'string' || typeof x.reason !== 'string') return null;
            return {
              id: x.id,
              label: x.label,
              reason: x.reason,
              ...(typeof x.occurrences === 'number' ? { occurrences: x.occurrences } : {}),
              ...(typeof x.confidence === 'number' ? { confidence: x.confidence } : {}),
            };
          })
          .filter(Boolean)
      : undefined;
    const needMoreInfo =
      parsed.needMoreInfo && typeof parsed.needMoreInfo === 'object' && typeof parsed.needMoreInfo.question === 'string'
        ? {
            question: parsed.needMoreInfo.question,
            ...(typeof parsed.needMoreInfo.answeredAtTs === 'number' ? { answeredAtTs: parsed.needMoreInfo.answeredAtTs } : {}),
            ...(typeof parsed.needMoreInfo.answerLogId === 'string' ? { answerLogId: parsed.needMoreInfo.answerLogId } : {}),
          }
        : typeof parsed.needMoreInfoQuestion === 'string'
          ? { question: parsed.needMoreInfoQuestion }
          : undefined;

    const dailyRiskGuide =
      parsed.dailyRiskGuide && typeof parsed.dailyRiskGuide === 'object' && !Array.isArray(parsed.dailyRiskGuide)
        ? (parsed.dailyRiskGuide as Record<string, number>)
        : undefined;

    const promotionChoices =
      parsed.promotionChoices && typeof parsed.promotionChoices === 'object' && !Array.isArray(parsed.promotionChoices)
        ? (parsed.promotionChoices as Record<string, 'yes' | 'no'>)
        : undefined;

    return { headline: parsed.headline, body: parsed.body, strategy, detectiveLog, promoteRecommendations, needMoreInfo, dailyRiskGuide, promotionChoices };
  } catch {
    return null;
  }
}

const POTENTIAL_TRIGGERS_STORAGE_KEY = 'heartburn.potentialTriggers.v1';
const PENDING_INVESTIGATION_STORAGE_KEY = 'heartburn.pendingInvestigation.v1';

export default function ReportDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const reportDataParam = typeof params.reportData === 'string' ? params.reportData : Array.isArray(params.reportData) ? params.reportData[0] : '';
  const generatingParam =
    typeof params.generating === 'string' ? params.generating : Array.isArray(params.generating) ? params.generating[0] : 'false';
  const isGenerating = generatingParam === 'true';
  const retryKeyParam = typeof params.retryKey === 'string' ? params.retryKey : Array.isArray(params.retryKey) ? params.retryKey[0] : '';
  const dayIsoParam = typeof params.dayIso === 'string' ? params.dayIso : Array.isArray(params.dayIso) ? params.dayIso[0] : '';
  const viewOnlyParam =
    typeof params.viewOnly === 'string'
      ? params.viewOnly === '1' || params.viewOnly === 'true'
      : Array.isArray(params.viewOnly)
        ? params.viewOnly[0] === '1' || params.viewOnly[0] === 'true'
        : false;

  const [loaded, error] = useFonts({
    OutfitLight: Outfit_300Light,
    Outfit: Outfit_400Regular,
    OutfitBold: Outfit_700Bold,
    OutfitBlack: Outfit_900Black,
  });

  const initialReport = useMemo(() => safeParseReportData(reportDataParam), [reportDataParam]);

  const [report, setReport] = useState<ReportData | null>(initialReport);
  const [loadingReport, setLoadingReport] = useState<boolean>(!initialReport);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [answerModalOpen, setAnswerModalOpen] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [isSavingAnswer, setIsSavingAnswer] = useState(false);
  const [answerToast, setAnswerToast] = useState<string | null>(null);
  const [monthlyReview, setMonthlyReview] = useState<MonthlyReviewReport | null>(null);
  const [cachedDates, setCachedDates] = useState<string[]>([]);
  const [viewingDayIso, setViewingDayIso] = useState<string>(dayIsoParam || getYesterdayISO());
  const [sleepModalOpen, setSleepModalOpen] = useState(false);
  const [sleepBedtime, setSleepBedtime] = useState('');
  const [sleepWakeTime, setSleepWakeTime] = useState('');
  const [sleepSymptoms, setSleepSymptoms] = useState<SleepEntry['nightSymptoms']>([]);
  const [sleepChecked, setSleepChecked] = useState(false);
  const [autoGenerateAttempted, setAutoGenerateAttempted] = useState(false);

  const DAILY_REPORT_CACHE_KEY = 'heartburn.dailyReportCache.v1';

  const loadCachedReportForDay = useCallback(async (dayIso: string): Promise<ReportData | null> => {
    try {
      const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidate = parsed[dayIso];
      if (!candidate) return null;
      return safeParseReportData(JSON.stringify(candidate));
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (dayIsoParam) setViewingDayIso(dayIsoParam);
  }, [dayIsoParam]);

  useFocusEffect(
    useCallback(() => {
      if (!viewOnlyParam) return;
      let alive = true;
      void (async () => {
        const dayIso = dayIsoParam || viewingDayIso || getYesterdayISO();
        const cached = await loadCachedReportForDay(dayIso);
        if (!alive) return;
        if (cached) {
          setReport(cached);
          setAutoGenerateAttempted(true);
          setLoadingReport(false);
          setLoadError(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, [dayIsoParam, loadCachedReportForDay, viewOnlyParam, viewingDayIso]),
  );

  useEffect(() => {
    getLastMonthlyReview()
      .then((review) => {
        if (!review) return;
        // Only show if generated within the last 2 days
        // (so it doesn't show stale month reviews forever)
        const age = Date.now() - review.generatedAtTs;
        if (age < 2 * 24 * 60 * 60 * 1000) {
          setMonthlyReview(review);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const allKeys = Object.keys(parsed)
          .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
          .sort()
          .reverse()
          .slice(0, 30);
        if (!cancelled && allKeys.length > 0) setCachedDates(allKeys);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistReportPatch = async (patch: Partial<ReportData>) => {
    try {
      const dayIso = viewingDayIso || dayIsoParam || getYesterdayISO();
      const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as any) : {};
      const existing = parsed?.[dayIso];
      const nextReport = { ...(existing && typeof existing === 'object' ? existing : {}), ...(report ?? {}), ...patch };
      const next = { ...(parsed && typeof parsed === 'object' ? parsed : {}), [dayIso]: nextReport };
      await AsyncStorage.setItem(DAILY_REPORT_CACHE_KEY, JSON.stringify(next));
      setReport(nextReport);
    } catch {
      // ignore
    }
  };

  const persistFullReportForDay = async (dayIso: string, fullReport: ReportData) => {
    try {
      const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as any) : {};
      const next = { ...(parsed && typeof parsed === 'object' ? parsed : {}), [dayIso]: fullReport };
      await AsyncStorage.setItem(DAILY_REPORT_CACHE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handlePromotionChoice = async (rec: { id: string; label: string; reason: string }, accept: boolean) => {
    if (accept) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Always update local state first so the card disappears immediately (no race with AsyncStorage).
    const choice: 'yes' | 'no' = accept ? 'yes' : 'no';
    setReport((prev) => {
      if (!prev) return prev;
      const nextChoices = { ...(prev.promotionChoices ?? {}), [rec.id]: choice };
      return { ...prev, promotionChoices: nextChoices };
    });

    // Persist + side effects best-effort (never block UI on storage).
    try {
      // 1) Update potentialTriggers if accepted.
      if (accept) {
        const raw = await AsyncStorage.getItem(POTENTIAL_TRIGGERS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as any) : [];
        const list = Array.isArray(parsed) ? parsed : [];
        const exists = list.some((t: any) => t && typeof t === 'object' && String(t.id) === rec.id);
        if (!exists) {
          list.unshift({
            id: rec.id,
            label: rec.label,
            strikeCount: 1,
            status: 'suspect',
            lastSeenTs: Date.now(),
            lastReason: 'Promoted from Pending Investigation',
          });
          await AsyncStorage.setItem(POTENTIAL_TRIGGERS_STORAGE_KEY, JSON.stringify(list));
        }
      }

      // 2) Remove from pending investigation either way (“clear that item from Pending JSON”).
      try {
        const rawPending = await AsyncStorage.getItem(PENDING_INVESTIGATION_STORAGE_KEY);
        const pending = rawPending ? (JSON.parse(rawPending) as any) : null;
        if (pending && typeof pending === 'object' && Array.isArray(pending.items)) {
          pending.items = pending.items.filter((x: any) => !(x && typeof x === 'object' && String(x.id) === rec.id));
          pending.updatedAtTs = Date.now();
          await AsyncStorage.setItem(PENDING_INVESTIGATION_STORAGE_KEY, JSON.stringify(pending));
        }
      } catch {
        // ignore
      }

      // 3) Persist choice in the report so it survives navigation.
      const prev = report?.promotionChoices ?? {};
      await persistReportPatch({ promotionChoices: { ...prev, [rec.id]: choice } });
    } catch {
      // Ignore (non-critical). Local state is already updated.
    }
  };

  const handleSelectDate = async (iso: string) => {
    setViewingDayIso(iso);
    setLoadError(null);
    try {
      const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
      if (!raw) {
        setReport(null);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidate = parsed[iso];
      if (!candidate) {
        setReport(null);
        return;
      }
      const next = safeParseReportData(JSON.stringify(candidate));
      setReport(next);
    } catch {
      setReport(null);
    }
  };

  const openAnswerModal = () => {
    const prefix = '[REPORT_REPLY] ';
    setAnswerText(prefix);
    setAnswerModalOpen(true);
  };

  const closeAnswerModal = () => {
    setAnswerModalOpen(false);
    setAnswerText('');
    setIsSavingAnswer(false);
  };

  const saveAnswer = async () => {
    const text = answerText.trim();
    if (!text || isSavingAnswer) return;
    try {
      setIsSavingAnswer(true);
      const item = await addLogToStore(text, 'note');
      if (report?.needMoreInfo?.question) {
        await persistReportPatch({
          needMoreInfo: { question: report.needMoreInfo.question, answeredAtTs: Date.now(), answerLogId: item.id },
        });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeAnswerModal();
      setAnswerToast('Saved');
      setTimeout(() => setAnswerToast(null), 1200);
    } finally {
      setIsSavingAnswer(false);
    }
  };

  const checkSleepLogged = async (dayIso: string): Promise<boolean> => {
    try {
      const raw = await AsyncStorage.getItem(SLEEP_LOG_STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as SleepEntry[];
      return Array.isArray(parsed) && parsed.some((e) => e.dayIso === dayIso);
    } catch {
      return false;
    }
  };

  const saveSleepEntry = async (entry: SleepEntry): Promise<void> => {
    try {
      const raw = await AsyncStorage.getItem(SLEEP_LOG_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as SleepEntry[]) : [];
      const existing = Array.isArray(parsed) ? parsed : [];
      const filtered = existing.filter((e) => e.dayIso !== entry.dayIso);
      filtered.unshift(entry);
      await AsyncStorage.setItem(SLEEP_LOG_STORAGE_KEY, JSON.stringify(filtered.slice(0, 30)));
    } catch {}
  };

  const handleSleepSubmit = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const dayIso = getYesterdayISO();
    await saveSleepEntry({
      dayIso,
      bedtime: sleepBedtime.trim(),
      wakeTime: sleepWakeTime.trim(),
      nightSymptoms: sleepSymptoms,
    });
    setSleepModalOpen(false);
    setSleepChecked(true);
  };

  const handleSleepSkip = () => {
    setSleepModalOpen(false);
    setSleepChecked(true);
  };

  const toggleSleepSymptom = (sym: SleepEntry['nightSymptoms'][number]) => {
    if (sym === 'none') {
      setSleepSymptoms(['none']);
      return;
    }
    setSleepSymptoms((prev) => {
      const withoutNone = prev.filter((s) => s !== 'none');
      if (withoutNone.includes(sym)) {
        const next = withoutNone.filter((s) => s !== sym);
        return next;
      }
      return [...withoutNone, sym];
    });
  };

  useEffect(() => {
    // If we were passed a report explicitly, just show it.
    if (initialReport) {
      setReport(initialReport);
      setLoadingReport(false);
      setLoadError(null);
      return;
    }

    const dayIso = viewingDayIso || dayIsoParam || getYesterdayISO();
    let cancelled = false;

    (async () => {
      setLoadError(null);

      let cached: ReportData | null = null;
      let cacheKeyExists = false;
      try {
        const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const allKeys = Object.keys(parsed ?? {})
            .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
            .sort()
            .reverse()
            .slice(0, 30);
          if (allKeys.length > 0) setCachedDates(allKeys);
          const candidate = parsed[dayIso];
          if (candidate) {
            cacheKeyExists = true;
            cached = safeParseReportData(JSON.stringify(candidate));
          }
        }
      } catch {
        // ignore cache read errors
      }

      if (cached && !cancelled) {
        setReport(cached);
        setAutoGenerateAttempted(true);
        setLoadingReport(false);
        return;
      }

      const shouldGenerate =
        !viewOnlyParam &&
        !cacheKeyExists &&
        (isGenerating ||
          retryNonce > 0 ||
          (!autoGenerateAttempted && dayIso === getYesterdayISO()));

      if (!shouldGenerate) {
        setReport(null);
        setLoadingReport(false);
        return;
      }

      if (!sleepChecked) {
        const yesterdayIso = getYesterdayISO();
        const alreadyLogged = await checkSleepLogged(yesterdayIso);
        if (!alreadyLogged) {
          setSleepModalOpen(true);
          setLoadingReport(false);
          return;
        }
        setSleepChecked(true);
      }

      if (!cancelled) setAutoGenerateAttempted(true);
      setLoadingReport(true);
      setLoadError(null);

      try {
        const yesterdayIso = getYesterdayISO();
        const nowTs = Date.now();
        const sleepRaw = await AsyncStorage.getItem(SLEEP_LOG_STORAGE_KEY);
        const sleepEntries = sleepRaw ? (JSON.parse(sleepRaw) as SleepEntry[]) : [];
        const todaySleep = Array.isArray(sleepEntries) ? sleepEntries.find((e) => e.dayIso === yesterdayIso) : null;
        const ctx = await prepareAiContext({ lookbackDays: 1, symptomLookbackHours: 6, nowTs, dayOffsetDays: 1 });
        if (todaySleep) {
          ctx.notes = [
            ...(ctx.notes ?? []),
            {
              id: `sleep-${yesterdayIso}`,
              ts: Date.now(),
              iso: yesterdayIso,
              text: `[SLEEP LOG] Bedtime: ${todaySleep.bedtime || 'not logged'}. Wake time: ${todaySleep.wakeTime || 'not logged'}. Night symptoms: ${todaySleep.nightSymptoms.length ? todaySleep.nightSymptoms.join(', ') : 'none'}.`,
            },
          ];
        }
        setReport({ headline: 'The Gut Check', body: '', strategy: [] });
        const next = await generateDailyReportStreaming(ctx, (partial) => {
          if (cancelled) return;
          setReport((prev) => ({
            headline: prev?.headline ?? 'The Gut Check',
            body: partial,
            strategy: prev?.strategy ?? [],
            detectiveLog: prev?.detectiveLog,
            promoteRecommendations: prev?.promoteRecommendations,
            needMoreInfo: prev?.needMoreInfo,
            dailyRiskGuide: prev?.dailyRiskGuide,
            promotionChoices: prev?.promotionChoices,
          }));
        });
        if (cancelled) return;
        setReport(next);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLoadingReport(false);
        setLoadError(null);
        await persistFullReportForDay(yesterdayIso, next);
      } catch (e) {
        if (cancelled) return;
        setLoadingReport(false);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        if (e instanceof GeminiOverwhelmedError) {
          setLoadError(e.message);
        } else {
          const msg =
            e && typeof e === 'object' && 'message' in e && typeof (e as any).message === 'string'
              ? (e as any).message
              : 'Something went wrong generating the report. Please try again.';
          setLoadError(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    autoGenerateAttempted,
    dayIsoParam,
    initialReport,
    isGenerating,
    retryKeyParam,
    retryNonce,
    sleepChecked,
    viewingDayIso,
    viewOnlyParam,
  ]);

  if (!loaded && !error) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={DARK} />
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      {answerToast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{answerToast}</Text>
        </View>
      ) : null}

      <View style={[styles.topHeader, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.topKicker}>{reportKickerForDayIso(viewingDayIso)}</Text>
        <Text style={styles.topTitle} accessibilityRole="header">
          {reportTitleForDayIso(viewingDayIso)}
        </Text>
      </View>

      {cachedDates.length > 1 ? (
        <View style={styles.tabStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayTabBar}
          >
            {cachedDates.map((iso) => {
              const isActive = iso === viewingDayIso;
              return (
                <Pressable
                  key={iso}
                  onPress={() => void handleSelectDate(iso)}
                  style={({ pressed }) => [
                    styles.dayTabItem,
                    isActive && styles.dayTabItemOn,
                    { opacity: pressed ? 0.92 : 1 },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={[styles.dayTabText, isActive && styles.dayTabTextOn]}>
                    {shortDateTabLabel(iso)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {loadingReport ? (
        <View style={[styles.root, styles.center, { paddingBottom: insets.bottom + 80 }]}>
          <View style={styles.loadingGraphic}>
            <Ionicons name="search-outline" size={28} color={DARK} />
          </View>
          <Text style={styles.loadingTitle}>The Detective is gathering evidence...</Text>
          <Text style={styles.loadingSub}>Cross-referencing yesterday’s logs with your suspect list.</Text>
          <ActivityIndicator style={{ marginTop: 14 }} size="large" color={DARK} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 16 + insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          {loadError ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Couldn’t generate report</Text>
              <Text style={styles.emptyBody}>{loadError}</Text>
              <Pressable
                onPress={() => setRetryNonce((n) => n + 1)}
                style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.92 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Retry generating report"
              >
                <Ionicons name="refresh" size={18} color={DARK} />
                <Text style={styles.retryBtnText}>RETRY</Text>
              </Pressable>
            </View>
          ) : report ? (
          <>
            <View style={styles.reportTile}>
              <Text style={styles.reportTileHeadline}>{report.headline || 'The Gut Check'}</Text>
              <Text style={styles.reportTileBody}>{report.body || ''}</Text>
            </View>

            {report.promoteRecommendations?.length ? (
              <View style={styles.promoWrap}>
                <Text style={styles.promoTitle}>PROMOTE TO SUSPECT?</Text>
                {report.promoteRecommendations
                  .filter((r) => !(report.promotionChoices && report.promotionChoices[r.id]))
                  .slice(0, 1)
                  .map((r) => (
                    <View key={r.id} style={styles.promoCard}>
                      <Text style={styles.promoBody}>
                        <Text style={styles.promoIngredient}>{r.label}</Text> looks suspicious. Add to your Suspect List?
                      </Text>
                      <Text style={styles.promoReason}>{r.reason}</Text>

                      <View style={styles.promoBtnRow}>
                        <Pressable
                          onPress={() => void handlePromotionChoice(r, true)}
                          style={({ pressed }) => [styles.promoBtn, styles.promoBtnOutline, { opacity: pressed ? 0.92 : 1 }]}
                        >
                          <Text style={styles.promoBtnOutlineText}>YES</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void handlePromotionChoice(r, false)}
                          style={({ pressed }) => [styles.promoBtn, styles.promoBtnOutline, { opacity: pressed ? 0.92 : 1 }]}
                        >
                          <Text style={styles.promoBtnOutlineText}>NO</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
              </View>
            ) : null}

            {report.needMoreInfo?.question ? (
              <View style={styles.questionCard}>
                <Text style={styles.questionTitle}>NEED MORE INFO</Text>
                <Text style={styles.questionBody}>{report.needMoreInfo.question}</Text>
                <Pressable
                  onPress={openAnswerModal}
                  disabled={Boolean(report.needMoreInfo?.answeredAtTs)}
                  style={({ pressed }) => [
                    styles.answerBtn,
                    report.needMoreInfo?.answeredAtTs ? styles.answerBtnAnswered : null,
                    { opacity: report.needMoreInfo?.answeredAtTs ? 0.6 : pressed ? 0.92 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Answer the Detective"
                >
                  {report.needMoreInfo?.answeredAtTs ? (
                    <View style={styles.answeredRow}>
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={styles.answerBtnAnsweredText}>ANSWERED</Text>
                    </View>
                  ) : (
                    <Text style={styles.answerBtnText}>ANSWER THE DETECTIVE</Text>
                  )}
                </Pressable>
              </View>
            ) : null}

            {report.detectiveLog && report.detectiveLog.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>DETECTIVE LOG</Text>
                <Text style={[styles.body, { marginTop: 10 }]}>
                  {report.detectiveLog[0]}
                </Text>
              </View>
            )}

            {report.strategy?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>STRATEGY</Text>
                {report.strategy.map((line, si) => (
                  <View key={`st-${si}`} style={styles.bulletRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={() => router.push({ pathname: '/(tabs)/patterns', params: { initialTab: 'detective' } })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="View Patterns"
              style={({ pressed }) => [styles.detectiveBtn, { opacity: pressed ? 0.88 : 1 }]}
            >
              <Ionicons name="search-outline" size={16} color={DARK} />
              <Text style={styles.detectiveBtnText}>VIEW PATTERNS</Text>
            </Pressable>

            {monthlyReview && (
              <View style={styles.monthlyCard}>
                <View style={styles.monthlyHeader}>
                  <Ionicons name="search-circle" size={20} color="#fff" />
                  <Text style={styles.monthlyHeaderText}>
                    30-DAY CASE REVIEW
                  </Text>
                  <Text style={styles.monthlyHeaderSub}>
                    {monthlyReview.monthLabel}
                  </Text>
                </View>

                <Text style={styles.monthlySummary}>
                  {monthlyReview.summary}
                </Text>

                {monthlyReview.topPattern ? (
                  <View style={styles.monthlyPatternCard}>
                    <Text style={styles.monthlyPatternKicker}>
                      TOP PATTERN
                    </Text>
                    <Text style={styles.monthlyPatternText}>
                      {monthlyReview.topPattern}
                    </Text>
                  </View>
                ) : null}

                {monthlyReview.protectiveFactors.length > 0 && (
                  <View style={styles.monthlySection}>
                    <Text style={styles.monthlySectionLabel}>
                      ✅ WORKING FOR YOU
                    </Text>
                    {monthlyReview.protectiveFactors.map((f, i) => (
                      <Text key={i} style={styles.monthlySectionItem}>
                        · {f}
                      </Text>
                    ))}
                  </View>
                )}

                {monthlyReview.removed.length > 0 && (
                  <View style={styles.monthlySection}>
                    <Text style={styles.monthlySectionLabel}>
                      🗑️ CLEARED FROM INVESTIGATION
                    </Text>
                    {monthlyReview.removed.map((r, i) => (
                      <Text key={i} style={styles.monthlySectionItem}>
                        · {r}
                      </Text>
                    ))}
                  </View>
                )}

                <View style={styles.monthlyStatsRow}>
                  <View style={styles.monthlyStatBox}>
                    <Text style={styles.monthlyStatNum}>
                      {monthlyReview.clearDays}
                    </Text>
                    <Text style={styles.monthlyStatLabel}>CLEAR DAYS</Text>
                  </View>
                  {monthlyReview.worstTrigger !== '—' && (
                    <View style={[styles.monthlyStatBox, styles.monthlyStatBoxBad]}>
                      <Text style={[styles.monthlyStatNum, { color: '#fff' }]}>
                        ⚠️
                      </Text>
                      <Text style={[styles.monthlyStatLabel, { color: 'rgba(255,255,255,0.7)' }]}>
                        {monthlyReview.worstTrigger}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </>
          ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Couldn’t open report</Text>
            <Text style={styles.emptyBody}>
              {viewingDayIso === getYesterdayISO()
                ? 'No report was found for yesterday yet. Tap below to generate one from your logs.'
                : 'No report was found for this day.'}
            </Text>
            {viewingDayIso === getYesterdayISO() ? (
              <Pressable
                onPress={() => setRetryNonce((n) => n + 1)}
                style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.92 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Generate report"
              >
                <Ionicons name="sparkles-outline" size={18} color={DARK} />
                <Text style={styles.retryBtnText}>GENERATE REPORT</Text>
              </Pressable>
            ) : null}
          </View>
          )}
        </ScrollView>
      )}

      <AppModal visible={answerModalOpen} transparent animationType="fade" onRequestClose={closeAnswerModal}>
        <View style={styles.answerBackdrop}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15, 23, 42, 0.72)' }]} />
          )}
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAnswerModal} />

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.answerCenter}>
            <Pressable style={styles.answerCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.answerHeaderRow}>
                <Text style={styles.answerTitle}>New Case Note</Text>
                <Pressable
                  onPress={closeAnswerModal}
                  hitSlop={12}
                  style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close answer"
                >
                  <Ionicons name="close" size={22} color={DARK} />
                </Pressable>
              </View>

              <Text style={styles.answerHelp}>Ask a question or add context for tomorrow&apos;s report.</Text>

              <TextInput
                value={answerText}
                onChangeText={setAnswerText}
                placeholder="Type your answer…"
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
                autoCorrect
                style={styles.answerInput}
              />

              <Pressable
                onPress={() => void saveAnswer()}
                disabled={!answerText.trim() || isSavingAnswer}
                style={({ pressed }) => [
                  styles.saveAnswerBtn,
                  { opacity: !answerText.trim() || isSavingAnswer ? 0.5 : pressed ? 0.92 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save answer"
              >
                <Ionicons name={isSavingAnswer ? 'time-outline' : 'save-outline'} size={18} color="#fff" />
                <Text style={styles.saveAnswerBtnText}>{isSavingAnswer ? 'SAVING…' : 'SAVE'}</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </AppModal>

      <AppModal visible={sleepModalOpen} transparent animationType="slide" onRequestClose={handleSleepSkip}>
        <View style={styles.answerBackdrop}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15, 23, 42, 0.72)' }]} />
          )}

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.answerCenter}>
            <Pressable style={styles.answerCard} onPress={() => { /* absorb taps */ }}>
              <Text style={styles.answerTitle}>Before we generate your report…</Text>
              <Text style={styles.answerHelp}>
                How did you sleep last night? This helps the Detective spot overnight patterns.
              </Text>

              <View style={styles.sleepTimeRow}>
                <TextInput
                  value={sleepBedtime}
                  onChangeText={setSleepBedtime}
                  placeholder="Bedtime, e.g. 23:00"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  style={styles.sleepTimeInput}
                />
                <TextInput
                  value={sleepWakeTime}
                  onChangeText={setSleepWakeTime}
                  placeholder="Wake, e.g. 07:00"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  style={styles.sleepTimeInput}
                />
              </View>

              <View style={styles.sleepSymptomRow}>
                {(['none', 'heartburn', 'cough', 'disrupted'] as const).map((sym) => {
                  const label = sym === 'none' ? 'None' : sym.charAt(0).toUpperCase() + sym.slice(1);
                  const selected = sleepSymptoms.includes(sym);
                  return (
                    <Pressable
                      key={sym}
                      onPress={() => toggleSleepSymptom(sym)}
                      style={[styles.unitPill, selected && styles.unitPillSelected]}
                    >
                      <Text style={[styles.unitPillText, selected && styles.unitPillTextSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.sleepBtnRow}>
                <Pressable
                  onPress={() => void handleSleepSubmit()}
                  style={({ pressed }) => [styles.saveAnswerBtn, styles.sleepBtnFlex, { opacity: pressed ? 0.92 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Save sleep log and continue"
                >
                  <Text style={styles.saveAnswerBtnText}>SAVE & CONTINUE</Text>
                </Pressable>
                <Pressable
                  onPress={handleSleepSkip}
                  style={({ pressed }) => [styles.sleepGhostBtn, styles.sleepBtnFlex, { opacity: pressed ? 0.92 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Skip sleep log"
                >
                  <Text style={styles.sleepGhostBtnText}>SKIP</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </AppModal>

      <BottomSafeAreaShield />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  root: { flex: 1, backgroundColor: BG },
  toast: {
    position: 'absolute',
    top: 90,
    left: 40,
    right: 40,
    backgroundColor: '#22c55e',
    padding: 12,
    borderRadius: APP_RADIUS,
    zIndex: 2000,
    alignItems: 'center',
  },
  toastText: { color: '#fff', fontFamily: 'OutfitBlack', fontSize: 12 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: BG,
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
    color: DARK,
  },
  tabStrip: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 8,
    backgroundColor: BG,
  },
  dayTabBar: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: APP_RADIUS,
    padding: 4,
    borderWidth: 1,
    borderColor: BORDER,
  },
  dayTabItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: APP_RADIUS,
  },
  dayTabItemOn: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  dayTabText: { fontFamily: 'OutfitBlack', fontSize: 12, color: '#64748b' },
  dayTabTextOn: { color: DARK },
  content: { padding: 16, paddingBottom: 40 },
  reportTile: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  reportTileHeadline: {
    fontFamily: 'OutfitBlack',
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: DARK,
  },
  reportTileBody: {
    marginTop: 10,
    fontFamily: 'Outfit',
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  headline: { fontFamily: 'OutfitBlack', fontSize: 26, letterSpacing: -0.6, color: DARK },
  body: { marginTop: 12, fontFamily: 'Outfit', fontSize: 16, lineHeight: 24, color: SLATE },
  loadingGraphic: {
    width: 74,
    height: 74,
    borderRadius: APP_RADIUS,
    backgroundColor: REPORT_CARD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  loadingTitle: { marginTop: 18, fontFamily: 'OutfitBlack', fontSize: 16, color: DARK, textAlign: 'center' },
  loadingSub: { marginTop: 8, fontFamily: 'Outfit', fontSize: 13, lineHeight: 18, color: SLATE, textAlign: 'center', maxWidth: 280 },
  section: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226,232,240,0.8)',
    paddingTop: 14,
  },
  sectionTitle: { fontFamily: 'OutfitBlack', fontSize: 11, letterSpacing: 1.1, color: '#94a3b8' },
  bulletRow: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: { fontFamily: 'OutfitBlack', color: DARK, width: 14, lineHeight: 22 },
  bulletText: { flex: 1, fontFamily: 'OutfitBold', fontSize: 14, lineHeight: 22, color: SLATE },
  detectiveBtn: {
    marginTop: 20,
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: REPORT_CARD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  detectiveBtnText: {
    fontFamily: 'OutfitBlack',
    fontSize: 12,
    letterSpacing: 1,
    color: DARK,
  },
  monthlyCard: {
    marginTop: 24,
    borderRadius: APP_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  monthlyHeader: {
    backgroundColor: '#0f172a',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  monthlyHeaderText: {
    fontFamily: 'OutfitBlack',
    fontSize: 12,
    letterSpacing: 1.2,
    color: '#fff',
    flex: 1,
  },
  monthlyHeaderSub: {
    fontFamily: 'Outfit',
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
  },
  monthlySummary: {
    padding: 16,
    fontFamily: 'Outfit',
    fontSize: 15,
    lineHeight: 23,
    color: SLATE,
    backgroundColor: '#fff',
  },
  monthlyPatternCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: BG,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
  },
  monthlyPatternKicker: {
    fontFamily: 'OutfitBlack',
    fontSize: 9,
    letterSpacing: 1.2,
    color: '#94a3b8',
    marginBottom: 4,
  },
  monthlyPatternText: {
    fontFamily: 'OutfitBold',
    fontSize: 13,
    lineHeight: 19,
    color: DARK,
  },
  monthlySection: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#fff',
  },
  monthlySectionLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 9,
    letterSpacing: 1.1,
    color: '#94a3b8',
    marginBottom: 6,
  },
  monthlySectionItem: {
    fontFamily: 'Outfit',
    fontSize: 13,
    lineHeight: 20,
    color: SLATE,
  },
  monthlyStatsRow: {
    flexDirection: 'row',
    gap: 0,
  },
  monthlyStatBox: {
    flex: 1,
    padding: 14,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
  },
  monthlyStatBoxBad: {
    backgroundColor: '#7f1d1d',
  },
  monthlyStatNum: {
    fontFamily: 'OutfitBlack',
    fontSize: 22,
    color: '#166534',
  },
  monthlyStatLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 8,
    letterSpacing: 1,
    color: '#166534',
    marginTop: 2,
    textAlign: 'center',
  },
  empty: {
    marginTop: 24,
    padding: 16,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  emptyTitle: { fontFamily: 'OutfitBlack', fontSize: 16, color: DARK },
  emptyBody: { marginTop: 8, fontFamily: 'Outfit', fontSize: 14, lineHeight: 20, color: SLATE },
  retryBtn: {
    marginTop: 14,
    height: 48,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#f1f5f9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  retryBtnText: { fontFamily: 'OutfitBlack', color: DARK, fontSize: 12, letterSpacing: 1 },

  promoWrap: { marginTop: 16 },
  promoTitle: { fontFamily: 'OutfitBlack', fontSize: 11, letterSpacing: 1.1, color: '#94a3b8' },
  promoCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  promoBody: { fontFamily: 'Outfit', fontSize: 14, lineHeight: 20, color: SLATE },
  promoIngredient: { fontFamily: 'OutfitBlack', color: DARK },
  promoReason: { marginTop: 8, fontFamily: 'OutfitBold', fontSize: 12, lineHeight: 18, color: '#64748b' },
  promoBtnRow: { marginTop: 12, flexDirection: 'row', gap: 10 },
  promoBtn: { flex: 1, height: 46, borderRadius: APP_RADIUS, alignItems: 'center', justifyContent: 'center' },
  promoBtnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.45)' },
  promoBtnOutlineText: { fontFamily: 'OutfitBlack', color: DARK, letterSpacing: 1 },

  questionCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  questionTitle: { fontFamily: 'OutfitBlack', fontSize: 11, letterSpacing: 1.1, color: '#94a3b8' },
  questionBody: { marginTop: 8, fontFamily: 'OutfitBold', fontSize: 14, lineHeight: 20, color: DARK },
  questionHint: { marginTop: 8, fontFamily: 'Outfit', fontSize: 12, lineHeight: 18, color: SLATE },
  answerBtn: {
    marginTop: 12,
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.1, color: '#fff' },
  answerBtnAnswered: {
    backgroundColor: DARK,
    borderColor: DARK,
  },
  answeredRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  answerBtnAnsweredText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.1, color: '#fff' },

  answerBackdrop: { flex: 1 },
  answerCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  answerCard: { backgroundColor: '#fff', borderRadius: APP_RADIUS, padding: 16, borderWidth: 1, borderColor: BORDER },
  answerHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  answerTitle: { fontFamily: 'OutfitBlack', fontSize: 16, color: DARK },
  answerHelp: { marginTop: 8, fontFamily: 'Outfit', fontSize: 13, lineHeight: 18, color: '#64748b' },
  answerInput: {
    marginTop: 12,
    minHeight: 160,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: APP_RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Outfit',
    fontSize: 14,
    color: DARK,
    backgroundColor: BG,
  },
  saveAnswerBtn: {
    marginTop: 14,
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: DARK,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveAnswerBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.1, color: '#fff' },

  sleepTimeRow: { marginTop: 12, flexDirection: 'row', gap: 10 },
  sleepTimeInput: {
    flex: 1, minWidth: 0,
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: APP_RADIUS,
    paddingHorizontal: 12,
    fontFamily: 'Outfit',
    fontSize: 13,
    color: DARK,
    backgroundColor: BG,
  },
  sleepSymptomRow: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unitPill: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPillSelected: {
    backgroundColor: DARK,
    borderColor: DARK,
  },
  unitPillText: {
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: '#64748b',
  },
  unitPillTextSelected: {
    color: '#fff',
  },
  sleepBtnRow: { marginTop: 14, flexDirection: 'row', gap: 10 },
  sleepBtnFlex: { flex: 1, marginTop: 0 },
  sleepGhostBtn: {
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sleepGhostBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.1, color: DARK },
});

