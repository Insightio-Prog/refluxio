import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LOGO_FONT_LIGHT, LOGO_FONT_STRONG } from '@/constants/fonts';
import { APP_RADIUS } from '@/constants/theme';
import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { addFavorite, removeFavorite, useFavorites, type FavoriteItem } from '@/hooks/use-favorites-store';
import { addLog as addLogToStore, useLogs, type SymptomSeverity } from '@/hooks/use-log-store';
import { addMedFavorite, getMedFavorites, removeMedFavorite, type MedFavorite } from '@/hooks/use-med-store';
import { addSymptomDefinition, getSymptomDefinitions, removeSymptomDefinition, type SymptomDefinition } from '@/hooks/use-symptom-store';
import {
  buildTodayIntakeTotalsFromLogs,
  colorHex,
  computeDynamicRiskMap,
  getRiskScoreForLabel,
  loadLatestDailyRiskGuide,
  loadSafeThresholds,
  scoreToColor,
} from '@/utils/risk-engine';
import {
  calculateStreak,
  getDayCount,
  getGreeting,
  getOrSetFirstUseDate,
  MOOD_OPTIONS,
  saveMoodLog,
  shouldShowMoodCheck,
  skipMoodCheck,
  type MoodOption,
} from '@/utils/home-utils';
import { getDailyScores } from '@/utils/insights-engine';
import { getYesterdayISO } from '@/utils/date-utils';
import {
  writePendingPositionCheckAfterMealLog,
} from '@/utils/pending-position-check';
import { refreshPollenIfNeeded, type PollenSnapshot } from '@/utils/pollen-service';

const BG = '#f8fafc';
const CARD = '#ffffff';
const DARK = '#0f172a';
const SLATE = '#475569';
const MUTED = '#94a3b8';
const BORDER = '#e2e8f0';
const GREEN = '#2d6a4f';
const GREEN_SOFT = '#f0fdf4';
const AMBER = '#d97706';
const RED = '#991b1b';
const HEADER_DARK = '#0f172a';

const BUILTIN_SYMPTOM_IDS = new Set([
  'jaw',
  'nose',
  'throat',
  'bloat',
  'chest',
  'itchy-eyes',
  'sneezing',
]);

const SYMPTOM_ICON_OPTIONS = [
  'fitness-outline',
  'water-outline',
  'mic-outline',
  'radio-button-on-outline',
  'heart-outline',
  'eye-outline',
  'cloudy-outline',
  'thermometer-outline',
  'bandage-outline',
  'medical-outline',
  'body-outline',
  'alert-circle-outline',
] as const;

const ENVIRONMENT_ITEMS = [
  { label: 'Smoky air', icon: 'cloud-outline' as const },
  { label: 'Dusty environment', icon: 'warning-outline' as const },
  { label: 'Air conditioning / Dry air', icon: 'snow-outline' as const },
  { label: 'Tight clothing / Belt', icon: 'shirt-outline' as const },
  { label: 'Bending / Heavy lifting', icon: 'barbell-outline' as const },
  { label: 'Intense / Core workout', icon: 'fitness-outline' as const },
  { label: 'Strong fumes / Perfume', icon: 'flask-outline' as const },
];

const ENV_INFO_COPY: Record<string, { what: string; why: string; log: string }> = {
  'Smoky air': {
    what: 'Exposure to smoke — cigarettes, bonfires, wood burners, candles, or air pollution.',
    why: 'Smoke irritates the lining of your oesophagus and throat, making existing inflammation worse and lowering your LES (the valve that keeps acid down) function over time.',
    log: 'It helps the AI spot whether bad symptom days cluster around smoke exposure, even when your diet hasn\'t changed.',
  },
  'Dusty environment': {
    what: 'Spending time somewhere with high dust levels — building work, old rooms, outdoor dusty environments.',
    why: 'Dust particles can trigger post-nasal drip, which causes you to swallow more frequently and increases throat irritation — both of which can worsen reflux symptoms.',
    log: 'Dust is easy to overlook as a trigger. Logging it helps the AI separate dietary causes from environmental ones on high-symptom days.',
  },
  'Air conditioning / Dry air': {
    what: 'Prolonged time in air-conditioned spaces or very dry environments.',
    why: 'Dry air dehydrates the mucous membranes in your throat and oesophagus, reducing their natural protective lining and making acid irritation more noticeable.',
    log: 'Symptoms in air-conditioned offices or hotels can look like food triggers. Logging this helps the AI rule out the environment before blaming your lunch.',
  },
  'Tight clothing / Belt': {
    what: 'Wearing tight waistbands, belts, shapewear, or anything that compresses your abdomen.',
    why: 'Abdominal compression physically increases the pressure inside your stomach, making it easier for acid to push up past the LES valve into your oesophagus.',
    log: 'This is one of the most under-reported triggers. If symptoms spike on certain days with no obvious food cause, clothing pressure is often the culprit.',
  },
  'Bending / Heavy lifting': {
    what: 'Activities that involve repeated bending forward or lifting heavy loads — gardening, gym, manual work.',
    why: 'Both actions increase intra-abdominal pressure and change your body\'s position relative to the stomach, making acid more likely to travel upward — especially within a few hours of eating.',
    log: 'Timing matters here. The AI can check whether symptoms follow physical exertion, helping distinguish exercise triggers from food triggers.',
  },
  'Intense / Core workout': {
    what: 'High-intensity exercise, core work, crunches, HIIT, or any training that engages the abdominal muscles heavily.',
    why: 'Core exercise contracts the abdominal muscles repeatedly, compressing the stomach. Combined with increased breathing rate and any pre-workout food, this is a common but overlooked reflux trigger.',
    log: 'Helps the AI correlate workout days with symptom spikes — and over time can identify whether the timing of your last meal before exercise is a factor.',
  },
  'Strong fumes / Perfume': {
    what: 'Exposure to strong chemical smells — perfume, cleaning products, paint, petrol, or air fresheners.',
    why: 'Strong fumes can trigger a vagal nerve response that affects oesophageal function, and chemical irritants can cause throat and airway inflammation that mimics or worsens reflux symptoms.',
    log: 'Fume exposure is often dismissed. Logging it helps the AI identify whether certain environments — offices, cleaning days, social events — are contributing to your symptoms beyond food.',
  },
};

const SYMPTOM_INFO_COPY: Record<string, { what: string; why: string; log: string }> = {
  'Itchy Eyes': {
    what: 'A symptom where the eyes feel irritated, itchy, or watery — often triggered by airborne allergens rather than food.',
    why: 'Itchy eyes are a classic sign of allergic rhinitis (hay fever). When your immune system is reacting to pollen, dust, or pet dander, it releases histamine — which also relaxes the lower oesophageal sphincter (LES), making acid reflux more likely on high-allergy days.',
    log: 'Logging itchy eyes helps the AI link your reflux flare-ups to pollen and allergy days rather than incorrectly blaming food. It is a key signal for separating environmental triggers from dietary ones.',
  },
  'Sneezing': {
    what: 'Repeated sneezing episodes, typically caused by airborne allergens like pollen, dust, or mould rather than illness.',
    why: 'Sneezing involves a sudden, forceful contraction of the diaphragm and abdominal muscles. This sharply increases intra-abdominal pressure and can push stomach acid upward past the LES — especially if you have recently eaten. On high-pollen days, repeated sneezing can directly provoke reflux symptoms.',
    log: 'Sneezing is easy to dismiss as unrelated to reflux. Logging it allows the AI to correlate your symptoms with pollen count data and allergy days, giving you a much clearer picture of what is environmental versus what is food-related.',
  },
};

const MED_SUGGESTIONS = [
  'Gaviscon',
  'Omeprazole',
  'Nexium',
  'Pepto-Bismol',
  'Rantidine',
  'Famotidine',
  'Magnesium Trisilicate',
  'Buscopan',
  'lansoprazole',
];

function getLastLoggedIcon(type: string, key?: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'meal':
      return 'restaurant-outline';
    case 'snack':
    case 'food':
    case 'drink':
      return 'cafe-outline';
    case 'med':
    case 'medication':
    case 'trigger':
      return 'medkit-outline';
    case 'symptom':
      return 'bandage-outline';
    case 'environment':
      return 'leaf-outline';
    case 'mood': {
      const moodKey = key?.trim();
      if (moodKey) {
        const match = MOOD_OPTIONS.find((m) => m.key === moodKey);
        if (match) {
          return match.ionicon as keyof typeof Ionicons.glyphMap;
        }
      }
      return 'happy-outline';
    }
    default:
      return 'ellipse-outline';
  }
}

type QuickEditTarget =
  | { kind: 'fav'; item: FavoriteItem }
  | { kind: 'med'; item: MedFavorite }
  | { kind: 'symptom'; item: SymptomDefinition };

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { logs, sortedLogs } = useLogs();
  const favorites = useFavorites();
  const [meds, setMeds] = useState<MedFavorite[]>([]);
  const [symptomDefs, setSymptomDefs] = useState<SymptomDefinition[]>([]);
  const [dailyRiskGuide, setDailyRiskGuide] = useState<Record<string, number> | null>(null);
  const [safeThresholds, setSafeThresholds] = useState<Record<string, any> | null>(null);
  const [firstUseDate, setFirstUseDate] = useState<Date>(new Date());
  const [showMoodModal, setShowMoodModal] = useState(false);
  const [selectedMood, setSelectedMood] = useState<MoodOption | null>(null);
  const [activeTab, setActiveTab] = useState<'snacks' | 'meals' | 'meds' | 'symptoms' | 'environment'>('snacks');
  const [pollenSnapshot, setPollenSnapshot] = useState<PollenSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [quickAddSuccessKey, setQuickAddSuccessKey] = useState<string | null>(null);
  const quickAddSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const moodSheetRef = useRef<BottomSheetModal>(null);
  const showMoodModalRef = useRef(showMoodModal);
  showMoodModalRef.current = showMoodModal;
  const [isMedModalOpen, setIsMedModalOpen] = useState(false);
  const [envInfoItem, setEnvInfoItem] = useState<{ label: string; icon: string } | null>(null);
  const [symptomInfoItem, setSymptomInfoItem] = useState<{ label: string; icon: string } | null>(null);
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [isSymptomModalOpen, setIsSymptomModalOpen] = useState(false);
  const [symptomName, setSymptomName] = useState('');
  const [selectedSymptomIcon, setSelectedSymptomIcon] = useState<string>(SYMPTOM_ICON_OPTIONS[0]);
  const [quickEditTarget, setQuickEditTarget] = useState<QuickEditTarget | null>(null);
  const [quickEditName, setQuickEditName] = useState('');
  const [quickEditDetail, setQuickEditDetail] = useState('');
  const [isSymptomLogModalOpen, setIsSymptomLogModalOpen] = useState(false);
  const [pendingSymptomLabel, setPendingSymptomLabel] = useState<string | null>(null);
  const [symptomLogStatus, setSymptomLogStatus] = useState<'idle' | 'saving' | 'added'>('idle');
  const [yesterdaySnippet, setYesterdaySnippet] = useState<string | null>(null);

  const loadYesterdaySnippet = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('heartburn.dailyReportCache.v1');
      if (!raw) {
        setYesterdaySnippet(null);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, { body?: string; headline?: string }>;
      const yesterdayIso = getYesterdayISO();
      const report = parsed?.[yesterdayIso];
      const body = typeof report?.body === 'string' ? report.body.trim() : '';
      if (body) {
        setYesterdaySnippet(body);
        return;
      }
      setYesterdaySnippet(null);
    } catch {
      setYesterdaySnippet(null);
    }
  }, []);

  useEffect(() => {
    getOrSetFirstUseDate().then(setFirstUseDate);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadYesterdaySnippet();
    }, [loadYesterdaySnippet]),
  );

  const loadMeds = useCallback(async () => {
    const data = await getMedFavorites();
    setMeds(data);
  }, []);

  useEffect(() => {
    void loadMeds();
    getSymptomDefinitions().then(setSymptomDefs);
  }, [loadMeds]);

  const refreshHomeScreenData = useCallback(async () => {
    const [guide, safe, pollen] = await Promise.all([
      loadLatestDailyRiskGuide(),
      loadSafeThresholds(),
      refreshPollenIfNeeded(),
    ]);
    return { guide, safe, pollen };
  }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void refreshHomeScreenData().then(({ guide, safe, pollen }) => {
      if (!alive) return;
      setDailyRiskGuide(guide);
      setSafeThresholds(safe);
      setPollenSnapshot(pollen);
    });
    return () => { alive = false; };
  }, [refreshHomeScreenData]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        void refreshHomeScreenData().then(({ guide, safe, pollen }) => {
          setDailyRiskGuide(guide);
          setSafeThresholds(safe);
          setPollenSnapshot(pollen);
        });
      }
      appStateRef.current = nextAppState;
    });
    return () => subscription.remove();
  }, [refreshHomeScreenData]);

  useFocusEffect(useCallback(() => {
    shouldShowMoodCheck().then((show) => {
      if (show) setShowMoodModal(true);
    });
  }, []));

  const renderBottomSheetBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
      />
    ),
    [],
  );

  useEffect(() => {
    if (showMoodModal) {
      moodSheetRef.current?.present();
    } else {
      moodSheetRef.current?.dismiss();
    }
  }, [showMoodModal]);

  const dailyScores = useMemo(() => getDailyScores(logs), [logs]);
  const dailyScoreSeries = useMemo(
    () =>
      Object.entries(dailyScores)
        .map(([date, score]) => ({ date, score }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [dailyScores],
  );
  const streak = useMemo(() => calculateStreak(dailyScores), [dailyScores]);
  const streakStartDate = streak.streakDays > 0
    ? new Date(Date.now() - (streak.streakDays - 1) * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'today';
  const dayCount = useMemo(() => getDayCount(firstUseDate), [firstUseDate]);
  const greeting = useMemo(() => getGreeting(), []);

  const riskScoresToday = useMemo(() => {
    const nowTs = Date.now();
    const totals = buildTodayIntakeTotalsFromLogs(sortedLogs, nowTs);
    return computeDynamicRiskMap({
      dailyRiskGuide,
      totals,
      safeThresholds: safeThresholds ?? {},
      logs: sortedLogs,
      nowTs,
    });
  }, [sortedLogs, dailyRiskGuide, safeThresholds]);

  const topRisk = useMemo(() => {
    let best: { label: string; score: number } | null = null;
    for (const [k, v] of Object.entries(riskScoresToday)) {
      if (typeof v !== 'number') continue;
      if (!best || v > best.score) best = { label: k, score: v };
    }
    return best;
  }, [riskScoresToday]);

  const lastLogged = sortedLogs[0] ?? null;

  const lastLoggedLabel = useMemo(() => {
    const raw = lastLogged?.key ?? '';
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    const preview = parts.length >= 2
      ? `${parts[0]}, ${parts[1]}` : parts[0] ?? '';
    return preview.length > 32
      ? `${preview.slice(0, 32).trim()}…` : preview;
  }, [lastLogged]);

  const lastLoggedTime = useMemo(() => {
    if (!lastLogged?.createdAt) return null;
    const d = new Date(lastLogged.createdAt);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, [lastLogged]);

  const lastLoggedIcon = lastLogged
    ? getLastLoggedIcon(lastLogged.type, lastLogged.key)
    : 'ellipse-outline';

  const mealFavs = useMemo(() =>
    favorites.filter(f => f.category === 'meal' || !f.category),
  [favorites]);

  const snackFavs = useMemo(() =>
    favorites.filter(f => f.category === 'snack'),
  [favorites]);

  const symptomsForQuickLog = useMemo(() => {
    const builtins = symptomDefs.filter((s) => BUILTIN_SYMPTOM_IDS.has(s.id));
    const custom = symptomDefs.filter((s) => s.id.startsWith('custom-'));
    return [...builtins, ...custom];
  }, [symptomDefs]);

  const suggestedMeds = useMemo(() => {
    const q = medName.trim().toLowerCase();
    if (!q) return MED_SUGGESTIONS;
    return MED_SUGGESTIONS.filter((m) => m.toLowerCase().includes(q));
  }, [medName]);

  const getLoggedTodayCount = (label: string) => {
    const key = label.trim().toLowerCase();
    if (!key) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return sortedLogs.filter((log) => {
      if (log.createdAt < start || log.createdAt >= end) return false;
      return String(log.key ?? '').toLowerCase().includes(key);
    }).length;
  };

  const statusCardContent = useMemo(() => {
    const score = topRisk?.score ?? 0;
    const tone = scoreToColor(score);
    const bg = colorHex(tone);
    if (streak.isOnStreak) {
      return {
        bg,
        icon: 'flame' as const,
        title: "You're on a clear streak",
        sub: `${streak.streakDays} day${streak.streakDays !== 1 ? 's' : ''} symptom-free · Risk score ${score}/10 today`,
        score,
        tone,
      };
    }
    if (score >= 8) {
      return {
        bg,
        icon: 'alert-circle' as const,
        title: 'High risk day',
        sub: `Risk score ${score}/10 · Log carefully today`,
        score,
        tone,
      };
    }
    if (score >= 4) {
      return {
        bg,
        icon: 'warning' as const,
        title: 'Moderate risk today',
        sub: `Risk score ${score}/10 · The detective is watching`,
        score,
        tone,
      };
    }
    return {
      bg,
      icon: 'analytics' as const,
      title: 'Keep logging',
      sub: `Day ${dayCount} of tracking · Building your pattern`,
      score,
      tone,
    };
  }, [streak, topRisk, dayCount]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1500);
  };

  const flashQuickAddSuccess = useCallback((key: string) => {
    if (quickAddSuccessTimerRef.current) clearTimeout(quickAddSuccessTimerRef.current);
    setQuickAddSuccessKey(key);
    quickAddSuccessTimerRef.current = setTimeout(() => {
      setQuickAddSuccessKey(null);
      quickAddSuccessTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (quickAddSuccessTimerRef.current) clearTimeout(quickAddSuccessTimerRef.current);
    };
  }, []);

  const handleMoodSave = async () => {
    if (!selectedMood) return;
    await saveMoodLog(selectedMood, (key, type) => addLogToStore(key, type as any));
    flashQuickAddSuccess(`mood:${selectedMood}`);
    setTimeout(() => {
      setShowMoodModal(false);
      setSelectedMood(null);
    }, 900);
  };

  const handleMoodSkip = async () => {
    await skipMoodCheck();
    setShowMoodModal(false);
    setSelectedMood(null);
  };

  const handleQuickLog = async (label: string, type: string, successKey: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const item = await addLogToStore(label, type as any);
    if (type === 'meal') {
      try {
        await writePendingPositionCheckAfterMealLog(item);
      } catch {
        // non-critical
      }
    }
    if (type === 'environment') {
      void refreshPollenIfNeeded().then(setPollenSnapshot);
    }
    flashQuickAddSuccess(successKey);
  };

  const showPollenWarning = useMemo(() => {
    if (!pollenSnapshot) return false;
    return (
      pollenSnapshot.tree === 'high' ||
      pollenSnapshot.tree === 'very_high' ||
      pollenSnapshot.grass === 'high' ||
      pollenSnapshot.grass === 'very_high' ||
      pollenSnapshot.weed === 'high' ||
      pollenSnapshot.weed === 'very_high'
    );
  }, [pollenSnapshot]);

  const closeMedModal = () => {
    setIsMedModalOpen(false);
    setMedName('');
    setMedDosage('');
  };

  const handleAddMedication = async () => {
    const name = medName.trim();
    const dosage = medDosage.trim();
    if (!name) return;
    await addMedFavorite(name, dosage || '—');
    await loadMeds();
    closeMedModal();
    showToast(`${name.toUpperCase()} ADDED`);
  };

  const closeSymptomModal = () => {
    setIsSymptomModalOpen(false);
    setSymptomName('');
    setSelectedSymptomIcon(SYMPTOM_ICON_OPTIONS[0]);
  };

  const handleAddSymptom = async () => {
    const name = symptomName.trim();
    if (!name) return;
    const next = await addSymptomDefinition(name, selectedSymptomIcon);
    setSymptomDefs(next);
    closeSymptomModal();
    showToast('Symptom Added');
  };

  const openSymptomLogModal = (label: string) => {
    setPendingSymptomLabel(label);
    setSymptomLogStatus('idle');
    setIsSymptomLogModalOpen(true);
  };

  const closeSymptomLogModal = () => {
    setIsSymptomLogModalOpen(false);
    setPendingSymptomLabel(null);
    setSymptomLogStatus('idle');
  };

  const confirmSymptomLog = async (severity: SymptomSeverity) => {
    if (!pendingSymptomLabel || symptomLogStatus !== 'idle') return;
    try {
      setSymptomLogStatus('saving');
      await addLogToStore(pendingSymptomLabel, 'symptom', { symptomSeverity: severity });
      refreshPollenIfNeeded().then(setPollenSnapshot).catch(() => {});
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      flashQuickAddSuccess(`symptom:${pendingSymptomLabel}`);
      setSymptomLogStatus('added');
      setTimeout(() => {
        closeSymptomLogModal();
      }, 650);
    } catch {
      setSymptomLogStatus('idle');
    }
  };

  const openQuickEditModal = (target: QuickEditTarget) => {
    setQuickEditTarget(target);
    if (target.kind === 'fav') {
      setQuickEditName(target.item.name);
      setQuickEditDetail('');
    } else if (target.kind === 'med') {
      setQuickEditName(target.item.name);
      setQuickEditDetail(target.item.dosage);
    } else {
      setQuickEditName(target.item.label);
      setQuickEditDetail('');
    }
  };

  const closeQuickEditModal = () => {
    setQuickEditTarget(null);
    setQuickEditName('');
    setQuickEditDetail('');
  };

  const handleSaveQuickEdit = async () => {
    if (!quickEditTarget) return;
    const name = quickEditName.trim();
    if (!name) return;

    if (quickEditTarget.kind === 'fav') {
      const item = quickEditTarget.item;
      await removeFavorite(item.id);
      await addFavorite(name, item.type, item.category, item.usualPortion, item.riskLevel);
    } else if (quickEditTarget.kind === 'med') {
      await removeMedFavorite(quickEditTarget.item.id);
      await addMedFavorite(name, quickEditDetail.trim() || '—');
      await loadMeds();
    } else {
      const nextAfterRemove = await removeSymptomDefinition(quickEditTarget.item.id);
      setSymptomDefs(nextAfterRemove);
      const next = await addSymptomDefinition(name, quickEditTarget.item.icon);
      setSymptomDefs(next);
    }

    closeQuickEditModal();
    showToast(`${name.toUpperCase()} UPDATED`);
  };

  const handleDeleteQuickEdit = async () => {
    if (!quickEditTarget) return;
    const name =
      quickEditTarget.kind === 'symptom'
        ? quickEditTarget.item.label
        : quickEditTarget.item.name;

    if (quickEditTarget.kind === 'fav') {
      await removeFavorite(quickEditTarget.item.id);
    } else if (quickEditTarget.kind === 'med') {
      const next = await removeMedFavorite(quickEditTarget.item.id);
      setMeds(next);
    } else {
      const next = await removeSymptomDefinition(quickEditTarget.item.id);
      setSymptomDefs(next);
    }

    closeQuickEditModal();
    showToast(`${name.toUpperCase()} REMOVED`);
  };

  const LogRow = ({
    name,
    sub,
    dotColor,
    leadingIcon,
    onAdd,
    onSettings,
    addSuccess,
    hideAddButton,
  }: {
    name: string;
    sub: string;
    dotColor?: string;
    leadingIcon?: keyof typeof Ionicons.glyphMap;
    onAdd?: () => void;
    onSettings?: () => void;
    addSuccess?: boolean;
    hideAddButton?: boolean;
  }) => (
    <View style={styles.logRow}>
      {leadingIcon ? (
        <View style={styles.logLeadingIcon}>
          <Ionicons name={leadingIcon} size={16} color={SLATE} />
        </View>
      ) : (
        <View style={[styles.riskSquare, { backgroundColor: dotColor ?? colorHex('green') }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.logName} numberOfLines={1}>{name}</Text>
        <Text style={styles.logSub}>{sub}</Text>
      </View>
      {onSettings ? (
        <Pressable style={styles.logSettingsBtn} onPress={onSettings}>
          <Ionicons name="settings-outline" size={16} color={MUTED} />
        </Pressable>
      ) : (
        <View style={styles.logSettingsSpacer} />
      )}
      {!hideAddButton ? (
        <Pressable
          style={[styles.logPlusBtn, addSuccess && styles.logPlusBtnSuccess]}
          onPress={onAdd}
          disabled={addSuccess}
        >
          <Ionicons
            name={addSuccess ? 'checkmark' : 'add'}
            size={16}
            color={addSuccess ? '#fff' : DARK}
          />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {toast && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        {/* New minimal header */}
        <View style={styles.newHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.newHeaderDate}>
              {new Date().toLocaleDateString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'long',
              }).toUpperCase()}
            </Text>
            <Text style={styles.newHeaderGreeting}>{greeting}.</Text>
          </View>
          <Pressable
            onPress={() => router.push('/settings')}
            style={styles.newSettingsBtn}
          >
            <Ionicons name="settings-outline" size={20} color="#64748b" />
          </Pressable>
        </View>

        {/* Risk score hero card */}
        <View style={styles.heroCard}>
          <View style={styles.heroScoreRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.heroStatusRow}>
                <View style={[styles.heroStatusDot, { backgroundColor: statusCardContent.bg }]} />
                <Text style={styles.heroStatusLabel}>{statusCardContent.title.toUpperCase()}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <Text style={styles.heroScore}>{statusCardContent.score}</Text>
                <View style={{ paddingBottom: 12 }}>
                  <Text style={styles.heroScoreSub}>risk today</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 7-day bar chart */}
          <View style={styles.heroBarChart}>
            {dailyScoreSeries.slice(-7).map((s, i) => {
              const isToday = i === dailyScoreSeries.slice(-7).length - 1;
              const barHeight = Math.max(4, ((s.score ?? 0) / 3) * 36);
              return (
                <View key={i} style={styles.heroBarCol}>
                  <View
                    style={[
                      styles.heroBar,
                      {
                        height: barHeight,
                        backgroundColor: isToday ? '#0f172a' : '#dbe4f0',
                      },
                    ]}
                  />
                  <Text style={styles.heroBarLabel}>
                    {new Date(s.date).toLocaleDateString('en-GB', { weekday: 'narrow' })}
                  </Text>
                </View>
              );
            })}
          </View>

        </View>

        {/* Streak + Last logged */}
        <View style={styles.heroStatsRow}>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatLabel}>CLEAR STREAK</Text>
            <Text style={styles.heroStatValue}>{streak.streakDays} days</Text>
            <Text style={styles.heroStatSub}>since {streakStartDate}</Text>
          </View>
          <View style={styles.heroStatCard}>
            <Text style={styles.heroStatLabel}>LAST LOGGED</Text>
            <Text style={styles.heroStatValue}>{lastLoggedTime}</Text>
            <Text style={styles.heroStatSub}>{lastLoggedLabel}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({
              pathname: '/(tabs)/report',
              params: { dayIso: getYesterdayISO(), viewOnly: '1' },
            });
          }}
          style={({ pressed }) => [styles.yesterdayCard, { opacity: pressed ? 0.92 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Open yesterday's report"
        >
          <View style={styles.yesterdayCardHeader}>
            <Ionicons name="time-outline" size={13} color={MUTED} />
            <Text style={styles.yesterdayCardLabel}>FROM YESTERDAY&apos;S REPORT</Text>
          </View>
          <Text style={styles.yesterdayCardBody}>
            {yesterdaySnippet ??
              'No report from yesterday yet. Start logging today to generate your next report.'}
          </Text>
        </Pressable>

        <View style={styles.tabCard}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabBar}
            contentContainerStyle={styles.tabBarContent}
          >
            {([
              { k: 'snacks', l: 'SNACKS' },
              { k: 'meals', l: 'MEALS' },
              { k: 'meds', l: 'MEDS' },
              { k: 'symptoms', l: 'SYMPTOMS' },
              { k: 'environment', l: 'ENV' },
            ] as const).map((t, index) => (
              <React.Fragment key={t.k}>
                {index > 0 ? <Text style={styles.tabSeparator}>|</Text> : null}
                <Pressable onPress={() => setActiveTab(t.k)} hitSlop={8}>
                  <Text
                    style={[
                      styles.tabLabel,
                      activeTab === t.k ? styles.tabLabelActive : styles.tabLabelInactive,
                    ]}
                  >
                    {t.l}
                  </Text>
                </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>

          <View style={{ padding: 12, gap: 8 }}>
            {activeTab === 'snacks' && (
              <>
                {snackFavs.slice(0, 5).map((item) => {
                  const count = getLoggedTodayCount(item.name);
                  const score = getRiskScoreForLabel(item.name, riskScoresToday);
                  const dotColor = colorHex(scoreToColor(score ?? 0));
                  return (
                    <LogRow
                      key={item.id}
                      name={item.name}
                      sub={count > 0 ? `${count} logged today` : item.category}
                      dotColor={dotColor}
                      addSuccess={quickAddSuccessKey === `fav:${item.id}`}
                      onAdd={() => void handleQuickLog(item.name, item.category, `fav:${item.id}`)}
                      onSettings={() => openQuickEditModal({ kind: 'fav', item })}
                    />
                  );
                })}
                <Pressable style={styles.addNewBtn} onPress={() => router.push('/(tabs)/log')}>
                  <Ionicons name="add" size={15} color={MUTED} />
                  <Text style={styles.addNewLabel}>ADD NEW</Text>
                </Pressable>
              </>
            )}

            {activeTab === 'meals' && (
              <>
                {mealFavs.slice(0, 5).map((item) => {
                  const count = getLoggedTodayCount(item.name);
                  const score = getRiskScoreForLabel(item.name, riskScoresToday);
                  const dotColor = colorHex(scoreToColor(score ?? 0));
                  return (
                    <LogRow
                      key={item.id}
                      name={item.name}
                      sub={count > 0 ? `${count} logged today` : item.category || 'meal'}
                      dotColor={dotColor}
                      addSuccess={quickAddSuccessKey === `fav:${item.id}`}
                      onAdd={() => void handleQuickLog(item.name, item.category || 'meal', `fav:${item.id}`)}
                      onSettings={() => openQuickEditModal({ kind: 'fav', item })}
                    />
                  );
                })}
                <Pressable style={styles.addNewBtn} onPress={() => router.push('/(tabs)/log')}>
                  <Ionicons name="add" size={15} color={MUTED} />
                  <Text style={styles.addNewLabel}>ADD NEW</Text>
                </Pressable>
              </>
            )}

            {activeTab === 'meds' && (
              <>
                {meds.slice(0, 5).map((item) => (
                  <LogRow
                    key={item.id}
                    name={item.name}
                    sub={item.dosage || 'Medication'}
                    leadingIcon={'medkit-outline' as keyof typeof Ionicons.glyphMap}
                    addSuccess={quickAddSuccessKey === `med:${item.id}`}
                    onAdd={() => void handleQuickLog(`${item.name} ${item.dosage}`.trim(), 'med', `med:${item.id}`)}
                    onSettings={() => openQuickEditModal({ kind: 'med', item })}
                  />
                ))}
                <Pressable style={styles.addNewBtn} onPress={() => setIsMedModalOpen(true)}>
                  <Ionicons name="add" size={15} color={MUTED} />
                  <Text style={styles.addNewLabel}>ADD NEW</Text>
                </Pressable>
              </>
            )}

            {activeTab === 'symptoms' && (
              <>
                {symptomsForQuickLog.map((item) => {
                  const iconName = (item.icon?.trim() || 'medkit-outline') as keyof typeof Ionicons.glyphMap;
                  const addSuccess = quickAddSuccessKey === `symptom:${item.label}`;
                  const isUserAddedSymptom = item.id.startsWith('custom-');
                  const hasInfo = Boolean(SYMPTOM_INFO_COPY[item.label]);
                  return (
                    <View key={item.id} style={styles.logRow}>
                      <View style={styles.symptomLeadingIcon}>
                        <Ionicons name={iconName} size={16} color="#0f172a" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.logName} numberOfLines={1}>{item.label}</Text>
                        <Text style={styles.logSub}>Quick log</Text>
                      </View>
                      {isUserAddedSymptom ? (
                        <Pressable
                          style={styles.logSettingsBtn}
                          onPress={() => openQuickEditModal({ kind: 'symptom', item })}
                        >
                          <Ionicons name="settings-outline" size={16} color={MUTED} />
                        </Pressable>
                      ) : (
                        <View style={styles.logSettingsSpacer} />
                      )}
                      {hasInfo ? (
                        <Pressable
                          onPress={() => setSymptomInfoItem({ label: item.label, icon: item.icon ?? 'medkit-outline' })}
                          hitSlop={8}
                          style={({ pressed }) => [styles.envInfoBtn, { opacity: pressed ? 0.6 : 1, marginRight: 6 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Learn more about ${item.label}`}
                        >
                          <Ionicons name="information-circle-outline" size={20} color="#94a3b8" />
                        </Pressable>
                      ) : null}
                      <Pressable
                        style={[styles.logPlusBtn, addSuccess && styles.logPlusBtnSuccess]}
                        onPress={() => openSymptomLogModal(item.label)}
                        disabled={addSuccess}
                      >
                        <Ionicons
                          name={addSuccess ? 'checkmark' : 'add'}
                          size={16}
                          color={addSuccess ? '#fff' : DARK}
                        />
                      </Pressable>
                    </View>
                  );
                })}
                <Pressable style={styles.addNewBtn} onPress={() => setIsSymptomModalOpen(true)}>
                  <Ionicons name="add" size={15} color={MUTED} />
                  <Text style={styles.addNewLabel}>ADD NEW</Text>
                </Pressable>
              </>
            )}

            {activeTab === 'environment' && (
              <>
                {ENVIRONMENT_ITEMS.map((item) => {
                  const count = getLoggedTodayCount(item.label);
                  return (
                    <View key={item.label} style={styles.envRowWrapper}>
                      <View style={styles.envRowInner}>
                        <LogRow
                          name={item.label}
                          sub={count > 0 ? `${count} logged today` : 'Environment'}
                          leadingIcon={item.icon}
                          addSuccess={quickAddSuccessKey === `env:${item.label}`}
                          hideAddButton
                        />
                      </View>
                      <View style={styles.envRowActions}>
                        <Pressable
                          onPress={() => setEnvInfoItem(item)}
                          hitSlop={8}
                          style={({ pressed }) => [styles.envInfoBtn, { opacity: pressed ? 0.6 : 1 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Learn more about ${item.label}`}
                        >
                          <Ionicons name="information-circle-outline" size={20} color="#94a3b8" />
                        </Pressable>
                        <Pressable
                          onPress={() => void handleQuickLog(item.label, 'environment', `env:${item.label}`)}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.envAddBtn,
                            quickAddSuccessKey === `env:${item.label}` && styles.envAddBtnSuccess,
                            { opacity: pressed ? 0.7 : 1 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Log ${item.label}`}
                        >
                          <Ionicons
                            name={quickAddSuccessKey === `env:${item.label}` ? 'checkmark' : 'add'}
                            size={18}
                            color={quickAddSuccessKey === `env:${item.label}` ? '#fff' : '#0f172a'}
                          />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      <Modal visible={isSymptomLogModalOpen} transparent animationType="fade" onRequestClose={closeSymptomLogModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeSymptomLogModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Quick Add</Text>
                <Pressable onPress={closeSymptomLogModal} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.symptomLogLead}>You are adding</Text>
              <Text style={styles.quickAddName} numberOfLines={3}>
                {pendingSymptomLabel ?? ''}
              </Text>

              <Text style={styles.quickAddHint}>Choose how strong it feels right now.</Text>

              {symptomLogStatus === 'added' ? (
                <View style={[styles.modalBtn, styles.quickAddSuccessBtn, styles.symptomLogSuccessFull]}>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.quickAddSuccessText}>LOGGED</Text>
                </View>
              ) : (
                <View style={styles.symptomSeverityStack}>
                  <Pressable
                    onPress={() => void confirmSymptomLog('mild')}
                    disabled={symptomLogStatus !== 'idle'}
                    style={({ pressed }) => [
                      styles.symptomSeverityBtn,
                      { opacity: symptomLogStatus !== 'idle' ? 0.55 : pressed ? 0.92 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Log as mild"
                  >
                    <Text style={styles.symptomSeverityBtnText}>Mild</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void confirmSymptomLog('moderate')}
                    disabled={symptomLogStatus !== 'idle'}
                    style={({ pressed }) => [
                      styles.symptomSeverityBtn,
                      { opacity: symptomLogStatus !== 'idle' ? 0.55 : pressed ? 0.92 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Log as medium"
                  >
                    <Text style={styles.symptomSeverityBtnText}>Medium</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void confirmSymptomLog('severe')}
                    disabled={symptomLogStatus !== 'idle'}
                    style={({ pressed }) => [
                      styles.symptomSeverityBtn,
                      { opacity: symptomLogStatus !== 'idle' ? 0.55 : pressed ? 0.92 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Log as severe"
                  >
                    <Text style={styles.symptomSeverityBtnText}>Severe</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={closeSymptomLogModal}
                  disabled={symptomLogStatus === 'saving'}
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnGhost,
                    { opacity: symptomLogStatus === 'saving' ? 0.5 : pressed ? 0.9 : 1 },
                  ]}
                >
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(quickEditTarget)}
        transparent
        animationType="fade"
        onRequestClose={closeQuickEditModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeQuickEditModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Edit Item</Text>
                <Pressable onPress={closeQuickEditModal} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.modalLabel}>
                {quickEditTarget?.kind === 'med' ? 'Medication name' : quickEditTarget?.kind === 'symptom' ? 'Symptom name' : 'Name'}
              </Text>
              <TextInput
                value={quickEditName}
                onChangeText={setQuickEditName}
                placeholder="Edit name"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
                autoCorrect={false}
                style={styles.modalInput}
              />

              {quickEditTarget?.kind === 'med' ? (
                <>
                  <Text style={[styles.modalLabel, { marginTop: 10 }]}>Dosage</Text>
                  <TextInput
                    value={quickEditDetail}
                    onChangeText={setQuickEditDetail}
                    placeholder="e.g. 10ml, 20mg, 30 mg"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.modalInput}
                  />
                </>
              ) : null}

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={() => void handleDeleteQuickEdit()}
                  style={({ pressed }) => [styles.modalBtn, styles.modalBtnDanger, { opacity: pressed ? 0.92 : 1 }]}
                >
                  <Text style={styles.modalBtnDangerText}>Delete</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleSaveQuickEdit()}
                  disabled={!quickEditName.trim()}
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    { opacity: !quickEditName.trim() ? 0.5 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Text style={styles.modalBtnPrimaryText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={isMedModalOpen} transparent animationType="fade" onRequestClose={closeMedModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeMedModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Add medication</Text>
                <Pressable onPress={closeMedModal} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.modalLabel}>Medication name</Text>
              <TextInput
                value={medName}
                onChangeText={setMedName}
                placeholder="Type a medication…"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
                autoCorrect={false}
                style={styles.modalInput}
              />

              <Text style={[styles.modalLabel, { marginTop: 10 }]}>Dosage</Text>
              <TextInput
                value={medDosage}
                onChangeText={setMedDosage}
                placeholder="e.g. 10ml, 20mg, 30 mg"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.modalInput}
              />

              <Text style={styles.modalSuggestionsTitle}>Suggested medications</Text>
              <View style={styles.suggestionsBox}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={{ maxHeight: 160 }}
                >
                  {suggestedMeds.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMedName(m)}
                      style={({ pressed }) => [styles.suggestionRow, { backgroundColor: pressed ? '#f1f5f9' : 'transparent' }]}
                    >
                      <Ionicons name="sparkles-outline" size={16} color="#64748b" />
                      <Text style={styles.suggestionText} numberOfLines={1}>{m}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.modalButtonsRow}>
                <Pressable onPress={closeMedModal} style={({ pressed }) => [styles.modalBtn, styles.modalBtnGhost, { opacity: pressed ? 0.9 : 1 }]}>
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAddMedication()}
                  disabled={!medName.trim()}
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    { opacity: !medName.trim() ? 0.5 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Text style={styles.modalBtnPrimaryText}>Add</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(envInfoItem)}
        transparent
        animationType="fade"
        onRequestClose={() => setEnvInfoItem(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setEnvInfoItem(null)}>
          <View style={styles.modalCenter}>
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <View style={styles.envInfoModalIconWrap}>
                  <Ionicons name="information-circle-outline" size={18} color="#0f172a" />
                </View>
                <Text style={[styles.modalTitle, { flex: 1, marginLeft: 10 }]} numberOfLines={2}>
                  {envInfoItem?.label ?? ''}
                </Text>
                <Pressable
                  onPress={() => setEnvInfoItem(null)}
                  hitSlop={12}
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              {envInfoItem && ENV_INFO_COPY[envInfoItem.label] ? (() => {
                const copy = ENV_INFO_COPY[envInfoItem.label];
                return (
                  <>
                    <View style={styles.envInfoSection}>
                      <Text style={styles.envInfoSectionLabel}>WHAT IS IT?</Text>
                      <Text style={styles.envInfoSectionText}>{copy.what}</Text>
                    </View>
                    <View style={styles.envInfoSection}>
                      <Text style={styles.envInfoSectionLabel}>WHY IT CAN TRIGGER REFLUX</Text>
                      <Text style={styles.envInfoSectionText}>{copy.why}</Text>
                    </View>
                    <View style={[styles.envInfoSection, styles.envInfoSectionHighlight]}>
                      <Text style={[styles.envInfoSectionLabel, styles.envInfoSectionLabelHighlight]}>WHY LOG IT?</Text>
                      <Text style={[styles.envInfoSectionText, styles.envInfoSectionTextHighlight]}>{copy.log}</Text>
                    </View>
                  </>
                );
              })() : null}

              <Pressable
                onPress={() => setEnvInfoItem(null)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  { marginTop: 16, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.modalBtnPrimaryText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(symptomInfoItem)}
        transparent
        animationType="fade"
        onRequestClose={() => setSymptomInfoItem(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSymptomInfoItem(null)}>
          <View style={styles.modalCenter}>
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <View style={styles.envInfoModalIconWrap}>
                  <Ionicons name="information-circle-outline" size={18} color="#0f172a" />
                </View>
                <Text style={[styles.modalTitle, { flex: 1, marginLeft: 10 }]} numberOfLines={2}>
                  {symptomInfoItem?.label ?? ''}
                </Text>
                <Pressable
                  onPress={() => setSymptomInfoItem(null)}
                  hitSlop={12}
                  style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              {symptomInfoItem && SYMPTOM_INFO_COPY[symptomInfoItem.label] ? (() => {
                const copy = SYMPTOM_INFO_COPY[symptomInfoItem.label];
                return (
                  <>
                    <View style={styles.envInfoSection}>
                      <Text style={styles.envInfoSectionLabel}>WHAT IS IT?</Text>
                      <Text style={styles.envInfoSectionText}>{copy.what}</Text>
                    </View>
                    <View style={styles.envInfoSection}>
                      <Text style={styles.envInfoSectionLabel}>WHY IT CAN TRIGGER REFLUX</Text>
                      <Text style={styles.envInfoSectionText}>{copy.why}</Text>
                    </View>
                    <View style={[styles.envInfoSection, styles.envInfoSectionHighlight]}>
                      <Text style={[styles.envInfoSectionLabel, styles.envInfoSectionLabelHighlight]}>WHY LOG IT?</Text>
                      <Text style={[styles.envInfoSectionText, styles.envInfoSectionTextHighlight]}>{copy.log}</Text>
                    </View>
                  </>
                );
              })() : null}

              <Pressable
                onPress={() => setSymptomInfoItem(null)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  { marginTop: 16, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.modalBtnPrimaryText}>GOT IT</Text>
              </Pressable>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={isSymptomModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSymptomModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeSymptomModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Add symptom</Text>
                <Pressable onPress={closeSymptomModal} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.modalLabel}>Symptom name</Text>
              <TextInput
                value={symptomName}
                onChangeText={setSymptomName}
                placeholder="e.g. Bloating"
                placeholderTextColor="#94a3b8"
                autoCapitalize="words"
                autoCorrect={false}
                style={styles.modalInput}
              />

              <Text style={[styles.modalLabel, { marginTop: 10 }]}>Icon</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.symptomIconRow}
              >
                {SYMPTOM_ICON_OPTIONS.map((iconName) => {
                  const selected = selectedSymptomIcon === iconName;
                  return (
                    <Pressable
                      key={iconName}
                      onPress={() => setSelectedSymptomIcon(iconName)}
                      style={[
                        styles.symptomIconOption,
                        selected ? styles.symptomIconOptionSelected : styles.symptomIconOptionIdle,
                      ]}
                    >
                      <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={22} color={selected ? '#fff' : '#64748b'} />
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.modalButtonsRow}>
                <Pressable onPress={closeSymptomModal} style={({ pressed }) => [styles.modalBtn, styles.modalBtnGhost, { opacity: pressed ? 0.9 : 1 }]}>
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleAddSymptom()}
                  disabled={!symptomName.trim()}
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    { opacity: !symptomName.trim() ? 0.5 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Text style={styles.modalBtnPrimaryText}>Add</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <BottomSheetModal
        ref={moodSheetRef}
        enablePanDownToClose
        backdropComponent={renderBottomSheetBackdrop}
        backgroundStyle={styles.bottomSheetBackground}
        handleIndicatorStyle={styles.bottomSheetHandle}
        onDismiss={() => {
          if (showMoodModalRef.current) {
            setShowMoodModal(false);
            setSelectedMood(null);
          }
        }}
      >
        <BottomSheetView style={styles.moodSheetContent}>
            <Text style={styles.moodTitle}>How are you feeling?</Text>
            <Text style={styles.moodSub}>
              Your mood helps the detective spot patterns
            </Text>

            <View style={styles.moodGrid}>
              {MOOD_OPTIONS.map(m => {
                const active = selectedMood === m.key;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSelectedMood(m.key);
                    }}
                    style={[
                      styles.moodBtn,
                      active && styles.moodBtnActive,
                    ]}
                  >
                    <Ionicons
                      name={m.ionicon as keyof typeof Ionicons.glyphMap}
                      size={16}
                      color={active ? '#fff' : SLATE}
                    />
                    <Text style={[
                      styles.moodLabel,
                      active && styles.moodLabelActive,
                    ]}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {quickAddSuccessKey?.startsWith('mood:') ? (
              <View
                style={[
                  styles.moodSaveBtn,
                  { backgroundColor: DARK, flexDirection: 'row', gap: 8 },
                ]}
              >
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={styles.moodSaveBtnText}>MOOD LOGGED</Text>
              </View>
            ) : (
              <Pressable
                onPress={() => void handleMoodSave()}
                disabled={!selectedMood}
                style={({ pressed }) => [
                  styles.moodSaveBtn,
                  !selectedMood && { opacity: 0.4 },
                  pressed && { opacity: 0.88 },
                ]}
              >
                <Text style={styles.moodSaveBtnText}>LOG MOOD</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => void handleMoodSkip()}
              style={{ marginTop: 12, alignItems: 'center' }}
            >
              <Text style={styles.moodSkipText}>Skip for now</Text>
            </Pressable>
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSafeAreaShield />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  body: { flex: 1, backgroundColor: BG },
  scrollContent: {
    gap: 14,
    paddingBottom: 100,
  },
  newHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  newHeaderDate: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: 1,
  },
  newHeaderGreeting: {
    fontFamily: 'OutfitBold',
    fontSize: 36,
    color: '#0f172a',
    marginTop: 2,
  },
  newSettingsBtn: {
    width: 38,
    height: 38,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    marginHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  heroScoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  heroStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  heroStatusDot: {
    width: 8,
    height: 8,
    borderRadius: APP_RADIUS,
  },
  heroStatusLabel: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#64748b',
    letterSpacing: 0.5,
  },
  heroScore: {
    fontFamily: 'OutfitBlack',
    fontSize: 64,
    color: '#0f172a',
    lineHeight: 68,
  },
  heroScoreSub: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: '#94a3b8',
    marginTop: -4,
  },
  heroBarChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginTop: 20,
    marginBottom: 4,
    height: 52,
  },
  heroBarCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  heroBar: {
    width: '100%',
    borderRadius: APP_RADIUS,
  },
  heroBarLabel: {
    fontFamily: 'OutfitMedium',
    fontSize: 10,
    color: '#94a3b8',
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
  },
  heroStatCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  heroStatLabel: {
    fontFamily: 'OutfitMedium',
    fontSize: 10,
    color: '#94a3b8',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroStatValue: {
    fontFamily: 'OutfitBlack',
    fontSize: 20,
    color: '#0f172a',
  },
  heroStatSub: {
    fontFamily: 'Outfit',
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  yesterdayCard: {
    marginHorizontal: 16,
    backgroundColor: '#dbe4f0',
    borderRadius: APP_RADIUS,
    padding: 16,
    minHeight: 90,
  },
  yesterdayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  yesterdayCardLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1,
    color: '#64748b',
  },
  yesterdayCardBody: {
    fontFamily: 'OutfitMedium',
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
  },
  header: {
    backgroundColor: HEADER_DARK,
    paddingHorizontal: 18,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLockup: { alignItems: 'center', flex: 1 },
  headerSideSpacer: { width: 40, height: 40 },
  brandTitle: { fontSize: 34, color: '#fff', letterSpacing: -0.8, lineHeight: 36 },
  brandStrong: { fontFamily: LOGO_FONT_STRONG },
  brandLight: { fontFamily: LOGO_FONT_LIGHT, color: GREEN },
  brandTagline: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 3,
    marginTop: 8,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingBlock: {
    marginBottom: 12,
  },
  greeting: {
    fontFamily: 'OutfitBlack',
    fontSize: 35,
    color: HEADER_DARK,
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  greetingSub: {
    fontFamily: 'OutfitBold',
    fontSize: 16,
    color: HEADER_DARK,
    marginTop: 4,
  },
  statusCard: {
    backgroundColor: CARD,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  statusBand: {
    paddingHorizontal: 16,
    paddingVertical: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopLeftRadius: APP_RADIUS,
    borderTopRightRadius: APP_RADIUS,
  },
  statusBandLocked: {
    backgroundColor: '#2d6a4f',
    justifyContent: 'flex-start',
  },
  statusScoreBubble: {
    width: 44,
    height: 44,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusScoreText: {
    fontFamily: 'OutfitBlack',
    fontSize: 16,
  },
  statusScoreSlash: {
    fontFamily: 'Outfit',
    fontSize: 9,
  },
  statusTitle: {
    fontFamily: 'OutfitBlack',
    fontSize: 18,
    color: '#fff',
  },
  statusSub: {
    fontFamily: 'Outfit',
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  statusLockedText: {
    fontFamily: 'OutfitBlack',
    fontSize: 16,
    color: '#ffffff',
  },
  pollenWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: GREEN_SOFT,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(45, 106, 79, 0.15)',
  },
  pollenWarningText: {
    flex: 1,
    fontFamily: 'OutfitBold',
    fontSize: 12,
    color: GREEN,
    lineHeight: 16,
  },
  lastLogRow: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lastLogIcon: {
    width: 32,
    height: 32,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastLogLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.4,
    color: MUTED,
  },
  lastLogName: {
    fontFamily: 'OutfitBold',
    fontSize: 13,
    color: DARK,
    marginTop: 1,
  },
  cta: {
    backgroundColor: DARK,
    borderRadius: APP_RADIUS,
    height: 67,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  ctaLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 14,
    color: '#fff',
    letterSpacing: 1.4,
  },
  navChipsRow: { flexDirection: 'row', gap: 8 },
  navChip: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  navChipLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    letterSpacing: 1,
    color: SLATE,
  },
  navChipHero: {
    flex: 1.3,
    backgroundColor: DARK,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: DARK,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: DARK,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  navChipHeroLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 13,
    letterSpacing: 1,
    color: '#fff',
  },
  tabCard: {
    backgroundColor: CARD,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  tabSeparator: {
    fontFamily: 'Outfit',
    fontSize: 12,
    color: '#cbd5e1',
    lineHeight: 14,
  },
  tabLabel: {
    fontSize: 13,
    letterSpacing: 1,
  },
  tabLabelActive: {
    fontFamily: 'OutfitBlack',
    color: DARK,
    fontSize: 13,
  },
  tabLabelInactive: {
    fontFamily: 'Outfit',
    color: MUTED,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  riskSquare: {
    width: 10,
    height: 10,
    borderRadius: APP_RADIUS,
  },
  logName: {
    fontFamily: 'Outfit',
    fontSize: 15,
    color: '#334155',
    flex: 1,
  },
  logSub: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 1,
  },
  logLeadingIcon: {
    width: 28,
    height: 28,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  symptomLeadingIcon: {
    width: 32,
    height: 32,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  logSettingsBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logSettingsSpacer: {
    width: 28,
    height: 28,
  },
  logPlusBtn: {
    width: 28,
    height: 28,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  logPlusBtnSuccess: {
    backgroundColor: DARK,
    borderColor: DARK,
  },
  addNewBtn: {
    marginTop: 4,
    borderRadius: APP_RADIUS,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderStyle: 'dashed',
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addNewLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 12,
    letterSpacing: 1.2,
    color: MUTED,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  modalCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  modalCard: { backgroundColor: '#fff', borderRadius: APP_RADIUS, padding: 16, elevation: 6 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontFamily: 'OutfitBlack', fontSize: 16, color: '#0f172a' },
  modalLabel: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#64748b', letterSpacing: 0.8 },
  modalInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: APP_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'OutfitBold',
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  modalSuggestionsTitle: { marginTop: 12, fontFamily: 'OutfitBlack', fontSize: 10, color: '#64748b', letterSpacing: 0.8 },
  suggestionsBox: { marginTop: 8, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: APP_RADIUS, overflow: 'hidden' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  suggestionText: { flex: 1, fontFamily: 'OutfitBold', fontSize: 13, color: '#0f172a' },
  modalButtonsRow: { marginTop: 14, flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, height: 44, borderRadius: APP_RADIUS, alignItems: 'center', justifyContent: 'center' },
  modalBtnGhost: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  modalBtnGhostText: { fontFamily: 'OutfitBlack', color: '#0f172a', fontSize: 12 },
  modalBtnPrimary: { backgroundColor: HEADER_DARK },
  modalBtnPrimaryText: { fontFamily: 'OutfitBlack', color: '#fff', fontSize: 12 },
  modalBtnDanger: { backgroundColor: RED, borderWidth: 1, borderColor: RED },
  modalBtnDangerText: { fontFamily: 'OutfitBlack', color: '#fff', fontSize: 12 },
  quickAddName: { marginTop: 4, fontFamily: 'OutfitBlack', fontSize: 16, color: '#0f172a', lineHeight: 22 },
  quickAddHint: { marginTop: 10, fontFamily: 'Outfit', fontSize: 12, color: '#94a3b8', lineHeight: 18 },
  quickAddSuccessBtn: { backgroundColor: DARK, flexDirection: 'row', gap: 8 },
  quickAddSuccessText: { fontFamily: 'OutfitBlack', color: '#fff', fontSize: 12, letterSpacing: 1 },
  symptomLogLead: { marginTop: 4, fontFamily: 'OutfitBold', fontSize: 12, color: '#64748b' },
  symptomSeverityStack: { marginTop: 14, flexDirection: 'row', gap: 10 },
  symptomSeverityBtn: {
    flex: 1,
    height: 48,
    borderRadius: APP_RADIUS,
    backgroundColor: HEADER_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symptomSeverityBtnText: { fontFamily: 'OutfitBlack', color: '#fff', fontSize: 13, letterSpacing: 0.5 },
  symptomLogSuccessFull: { marginTop: 14, flex: 0, width: '100%', alignSelf: 'stretch' },
  symptomIconRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  symptomIconOption: {
    width: 48,
    height: 48,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  symptomIconOptionIdle: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  symptomIconOptionSelected: { borderColor: HEADER_DARK, backgroundColor: HEADER_DARK },
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
  moodSheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  moodTitle: {
    fontFamily: 'OutfitBlack',
    fontSize: 18,
    color: DARK,
    textAlign: 'center',
  },
  moodSub: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  moodGrid: {
    flexDirection: 'column',
    gap: 6,
  },
  moodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
  },
  moodBtnActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  moodLabel: {
    fontFamily: 'OutfitBold',
    fontSize: 12,
    color: DARK,
  },
  moodLabelActive: { color: '#fff' },
  moodSaveBtn: {
    marginTop: 16,
    height: 48,
    borderRadius: APP_RADIUS,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodSaveBtnText: {
    fontFamily: 'OutfitBlack',
    fontSize: 13,
    letterSpacing: 1.2,
    color: '#fff',
  },
  moodSkipText: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: MUTED,
  },
  toast: {
    position: 'absolute',
    top: 0,
    left: 40,
    right: 40,
    backgroundColor: DARK,
    padding: 12,
    borderRadius: APP_RADIUS,
    zIndex: 1000,
    alignItems: 'center',
  },
  toastText: {
    color: '#fff',
    fontFamily: 'OutfitBlack',
    fontSize: 12,
  },
  envRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  envRowInner: {
    flex: 1,
  },
  envRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 4,
  },
  envInfoBtn: {
    width: 34,
    height: 34,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  envAddBtn: {
    width: 34,
    height: 34,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  envAddBtnSuccess: {
    backgroundColor: DARK,
    borderColor: DARK,
  },
  envInfoModalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  envInfoSection: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  envInfoSectionHighlight: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  envInfoSectionLabelHighlight: {
    color: '#fff',
  },
  envInfoSectionTextHighlight: {
    color: '#fff',
  },
  envInfoSectionLabel: {
    fontFamily: 'OutfitBlack',
    fontSize: 9,
    letterSpacing: 1,
    color: '#64748b',
    marginBottom: 6,
  },
  envInfoSectionText: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: '#334155',
    lineHeight: 20,
  },
});
