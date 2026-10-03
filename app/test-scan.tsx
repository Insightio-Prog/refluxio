import AsyncStorage from '@react-native-async-storage/async-storage';
import { addFavorite } from '@/hooks/use-favorites-store';
import { addLog, useLogs, type LogItem } from '@/hooks/use-log-store';
import { buildTodayIntakeTotalsFromLogs, colorHex, computeDynamicRiskMap, loadLatestDailyRiskGuide, loadSafeThresholds, scoreToColor } from '@/utils/risk-engine';
import { writePendingPositionCheckAfterMealLog } from '@/utils/pending-position-check';
import { APP_RADIUS } from '@/constants/theme';
import { LOGO_FONT_BOLD, LOGO_FONT_LIGHT } from '@/constants/fonts';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView as RNScrollView, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AppModal from '@/components/AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO } from '@/constants/demo';
import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';

const BG = '#f8fafc';
const HEADER_DARK = '#0f172a';
const BORDER = '#e2e8f0';
const ICON_COLOR = '#0f172a';
const RISK_LOW = '#2d6a4f';
const RISK_ORANGE = '#d97706';

type MealUnit = 'x' | 'g' | 'ml' | 'handful' | 'cup' | 'pinch' | 'tbsp' | 'tsp';
const MEAL_UNITS: MealUnit[] = ['x', 'g', 'ml', 'handful', 'cup', 'pinch', 'tbsp', 'tsp'];
const PRIMARY_UNITS: MealUnit[] = ['x', 'g', 'ml'];
const PENDING_SCAN_UNITS: MealUnit[] = ['x', 'g', 'ml'];
const DEMO_BARCODES = [
  { code: '5000157024671', label: 'Baked beans' },
  { code: '7622210449283', label: 'Dairy Milk' },
  { code: '5449000000996', label: 'Cola' },
];
const RECENT_ROW_BORDER = '#f1f5f9';
const RISK_DOT_FALLBACK = '#e2e8f0';
const RECENT_MEAL_LOG_IDS_KEY = 'heartburn.recentMealLogIds.v1';

function formatRecentLogTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const clock = `${hh}:${mm}`;
  if (ts >= todayStart.getTime()) return `Today ${clock}`;
  if (ts >= yesterdayStart.getTime()) return `Yesterday ${clock}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock}`;
}
const UNIT_LABELS: Record<MealUnit, string> = {
  x: 'x',
  g: 'g',
  ml: 'ml',
  handful: 'handful',
  cup: 'cup',
  pinch: 'pinch',
  tbsp: 'tbsp',
  tsp: 'tsp',
};
const UNIT_BUTTON_LABELS: Record<MealUnit, string> = {
  x: 'Amount',
  g: 'Grams',
  ml: 'Ml',
  handful: 'Handful',
  cup: 'Cup',
  pinch: 'Pinch',
  tbsp: 'Tbsp',
  tsp: 'Tsp',
};

type MealBasketItem = {
  id: string;
  kind: 'scanned' | 'manual';
  label: string;
  quantity: number;
  unit: MealUnit;
  amountNote?: string;
  /** Raw Open Food Facts `ingredients_text` (scanned items only). */
  ingredients?: string;
  /** Parsed token list for digest / UI. */
  ingredientsParsed?: string[];
  barcode?: string;
  brand?: string;
  risk?: string;
};

type PendingScannedItem = MealBasketItem & {
  imageUrl?: string;
};

const TRIGGER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bcitric acid\b/i, label: 'Citric Acid' },
  { re: /\bvinegar\b/i, label: 'Vinegar' },
  { re: /\bchili\b/i, label: 'Chili' },
  { re: /\bpepper\b/i, label: 'Pepper' },
  { re: /\bgarlic\b/i, label: 'Garlic' },
  { re: /\bonion\b/i, label: 'Onion' },
  { re: /\bcoffee\b/i, label: 'Coffee' },
  { re: /\bchocolate\b/i, label: 'Chocolate' },
  { re: /\bmint\b/i, label: 'Mint' },
];

function getTriggerMatches(text: string) {
  const t = text.toLowerCase();
  return TRIGGER_PATTERNS.filter((p) => p.re.test(t));
}

function HighlightedIngredients({ text, riskScores }: { text: string; riskScores: Record<string, number> }) {
  const triggers = getTriggerMatches(text);
  if (!text.trim()) return <Text style={styles.ingredientsBodyMuted}>No ingredients provided.</Text>;
  if (triggers.length === 0) return <Text style={styles.ingredientsBody}>{text.trim()}</Text>;

  // Simple highlighting: wrap any matched trigger tokens with styled Text.
  // We do a multi-pass split using a combined regex of all triggers.
  const combined = new RegExp(`(${triggers.map((t) => t.re.source).join('|')})`, 'ig');
  const parts = text.split(combined);

  const triggerColorForPart = (part: string) => {
    const key = part.trim().toLowerCase();
    const score = riskScores[key];
    if (typeof score !== 'number') return RISK_ORANGE;
    if (score >= 7) return colorHex('red');
    if (score >= 4) return colorHex('orange');
    return colorHex('green');
  };

  return (
    <Text style={styles.ingredientsBody}>
      {parts.map((part, idx) => {
        const isTrigger = triggers.some((t) => t.re.test(part));
        return (
          <Text
            key={`${idx}-${part}`}
            style={
              isTrigger
                ? { fontFamily: 'OutfitBlack', color: triggerColorForPart(part) }
                : undefined
            }
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

type MealPersistedLine = Omit<MealBasketItem, 'id' | 'ingredientsParsed'> & {
  ingredientsParsed?: string[];
};

function newBasketId() {
  return `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`;
}

function defaultBasketItem(partial: Omit<MealBasketItem, 'id' | 'quantity' | 'unit'> & { id: string }): MealBasketItem {
  return { ...partial, quantity: 1, unit: 'x' };
}

function clampQty(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(999, n));
}

function roundToHalf(n: number) {
  return Math.round(n * 2) / 2;
}

function qtyToDisplay(qty: number) {
  const q = clampQty(qty);
  return Number.isInteger(q) ? String(q) : q.toFixed(1);
}

function capitalizeFirstLetterOnly(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Title-case each word once it is followed by whitespace (first letter only). */
function capitalizeCompletedWordsInManualInput(text: string): string {
  const segments = text.split(/(\s+)/);
  return segments
    .map((seg, idx) => {
      if (/^\s+$/.test(seg)) return seg;
      const next = segments[idx + 1];
      if (next !== undefined && /^\s/.test(next)) return capitalizeFirstLetterOnly(seg);
      return seg;
    })
    .join('');
}

/** Display + diary `key` segment, e.g. `Pork sausages (200g)`, `Coffee (1x)`. */
function formatMealQuantityLabel(item: Pick<MealBasketItem, 'quantity' | 'unit' | 'label' | 'amountNote'>): string {
  if (item.amountNote?.trim()) {
    return `${item.label} (${item.amountNote.trim()})`;
  }
  const q = item.unit === 'x' ? roundToHalf(item.quantity) : clampQty(item.quantity);
  const qStr = qtyToDisplay(q);
  if (item.unit === 'x') return `${item.label} (${qStr}x)`;
  return `${item.label} (${qStr}${UNIT_LABELS[item.unit]})`;
}

function parsePersistedMealLines(log: LogItem | null): string[] | null {
  if (!log?.mealMeta) return null;
  try {
    const parsed = JSON.parse(log.mealMeta) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((x: any) => {
        if (!x || typeof x !== 'object') return null;
        if (typeof x.label !== 'string') return null;
        const unit: MealUnit = MEAL_UNITS.includes(x.unit) ? x.unit : 'x';
        const quantity = typeof x.quantity === 'number' && Number.isFinite(x.quantity) ? x.quantity : 1;
        const amountNote = typeof x.amountNote === 'string' ? x.amountNote : undefined;
        return formatMealQuantityLabel({ label: x.label, unit, quantity, amountNote });
      })
      .filter(Boolean) as string[];
  } catch {
    return null;
  }
}

function buildCombinedIngredientsText(items: MealBasketItem[]): string {
  const blocks = items
    .filter((i) => (i.ingredients ?? '').trim().length > 0)
    .map((i, idx) => `[#${idx + 1} ${i.label} | barcode: ${i.barcode ?? 'n/a'}]\n${(i.ingredients ?? '').trim()}`);
  return blocks.join('\n\n---\n\n');
}

function buildMealIngredientsDigest(items: MealBasketItem[]): string {
  return items
    .map((item, idx) => {
      if (item.kind === 'manual') {
        const q = Math.max(0.5, Math.round(item.quantity * 2) / 2);
        const qStr = Number.isInteger(q) ? String(q) : q.toFixed(1);
        return [
          `[#${idx + 1} Manual]`,
          `Label: ${item.label}`,
          `Qty: ${item.unit === 'x' ? `${qStr}x` : `${qStr}${UNIT_LABELS[item.unit]}`}`,
          item.amountNote ? `Amount note: ${item.amountNote}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }
      const ing = (item.ingredientsParsed ?? []).join(', ');
      const q = Math.max(0.5, Math.round(item.quantity * 2) / 2);
      const qStr = Number.isInteger(q) ? String(q) : q.toFixed(1);
      return [
        `[#${idx + 1} Scanned]`,
        item.barcode ? `Barcode: ${item.barcode}` : '',
        `Product: ${item.label}`,
        item.brand ? `Brand: ${item.brand}` : '',
        item.risk ? `Heuristic risk: ${item.risk}` : '',
        `Qty: ${item.unit === 'x' ? `${qStr}x` : `${qStr}${UNIT_LABELS[item.unit]}`}`,
        item.amountNote ? `Amount note: ${item.amountNote}` : '',
        ing ? `Parsed ingredients: ${ing}` : '',
        item.ingredients ? `Raw ingredients_text:\n${item.ingredients}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n────────\n\n');
}

function buildMealMetaJson(items: MealBasketItem[]): string {
  const lines: MealPersistedLine[] = items.map(({ id: _id, ingredientsParsed, ...rest }) => ({
    ...rest,
    ingredientsParsed: ingredientsParsed?.length ? ingredientsParsed : undefined,
  }));
  return JSON.stringify(lines);
}

export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [scanNotFound, setScanNotFound] = useState(false);
  const [mealInput, setMealInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLoggingMeal, setIsLoggingMeal] = useState(false);
  const [toast, setToast] = useState<null | { text: string; tone: 'success' | 'favorite' }>(null);
  const [currentMealItems, setCurrentMealItems] = useState<MealBasketItem[]>([]);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [pendingScan, setPendingScan] = useState<PendingScannedItem | null>(null);
  const [pendingScanActionStatus, setPendingScanActionStatus] = useState<'idle' | 'snackLogged' | 'favoriteAdded'>('idle');
  const [inspectLog, setInspectLog] = useState<LogItem | null>(null);
  const [quickSaveLog, setQuickSaveLog] = useState<LogItem | null>(null);
  const [inspectSaveStatus, setInspectSaveStatus] = useState<'idle' | 'snack' | 'meal'>('idle');
  const [quickSaveStatus, setQuickSaveStatus] = useState<'idle' | 'snack' | 'meal'>('idle');
  const [inspectRemoveStatus, setInspectRemoveStatus] = useState<'idle' | 'removing' | 'removed'>('idle');
  const [expandedUnitItemId, setExpandedUnitItemId] = useState<string | null>(null);
  const fetchInFlight = useRef(false);
  const lastScanRef = useRef<number | null>(null);

  const { sortedLogs } = useLogs();
  const [dailyRiskGuide, setDailyRiskGuide] = useState<Record<string, number> | null>(null);
  const [safeThresholds, setSafeThresholds] = useState<Record<string, any> | null>(null);
  const [recentMealLogIds, setRecentMealLogIds] = useState<string[] | null>(null);
  const [recentMealLogIdsLoaded, setRecentMealLogIdsLoaded] = useState(false);
  const mealLogCandidates = useMemo(
    () => sortedLogs.filter((l) => ['food', 'snack', 'meal'].includes(l.type as any)),
    [sortedLogs]
  );
  const recentMealLogs = useMemo(() => {
    if (!recentMealLogIdsLoaded) return [];
    const visibleIds = recentMealLogIds ?? [];
    const byId = new Map(mealLogCandidates.map((log) => [String(log.id), log] as const));
    return visibleIds
      .map((id) => byId.get(String(id)))
      .filter((log): log is LogItem => Boolean(log));
  }, [mealLogCandidates, recentMealLogIds, recentMealLogIdsLoaded]);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(RECENT_MEAL_LOG_IDS_KEY);
        if (!alive) return;
        if (!raw?.trim()) {
          setRecentMealLogIds(null);
          return;
        }
        const parsed = JSON.parse(raw);
        setRecentMealLogIds(Array.isArray(parsed) ? parsed.map((id) => String(id)) : null);
      } catch {
        if (!alive) return;
        setRecentMealLogIds(null);
      } finally {
        if (alive) setRecentMealLogIdsLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!recentMealLogIdsLoaded || recentMealLogIds !== null) return;
    const initialIds = mealLogCandidates.slice(0, 8).map((log) => String(log.id));
    setRecentMealLogIds(initialIds);
    void AsyncStorage.setItem(RECENT_MEAL_LOG_IDS_KEY, JSON.stringify(initialIds));
  }, [mealLogCandidates, recentMealLogIds, recentMealLogIdsLoaded]);

  React.useEffect(() => {
    if (!recentMealLogIdsLoaded || recentMealLogIds === null) return;
    const candidateIds = new Set(mealLogCandidates.map((log) => String(log.id)));
    const cleanedIds = recentMealLogIds.filter((id) => candidateIds.has(String(id)));
    if (cleanedIds.length === recentMealLogIds.length) return;
    setRecentMealLogIds(cleanedIds);
    void AsyncStorage.setItem(RECENT_MEAL_LOG_IDS_KEY, JSON.stringify(cleanedIds));
  }, [mealLogCandidates, recentMealLogIds, recentMealLogIdsLoaded]);

  const prependRecentMealLog = (log: LogItem) => {
    if (!['food', 'snack', 'meal'].includes(log.type as any)) return;
    setRecentMealLogIds((prev) => {
      const base = prev ?? [];
      const next = [String(log.id), ...base.filter((id) => String(id) !== String(log.id))].slice(0, 8);
      void AsyncStorage.setItem(RECENT_MEAL_LOG_IDS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const removeRecentMealLogId = (id: string) => {
    setRecentMealLogIds((prev) => {
      const next = (prev ?? []).filter((entryId) => String(entryId) !== String(id));
      void AsyncStorage.setItem(RECENT_MEAL_LOG_IDS_KEY, JSON.stringify(next));
      return next;
    });
  };

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const [guide, safe] = await Promise.all([loadLatestDailyRiskGuide(), loadSafeThresholds()]);
      if (!alive) return;
      setDailyRiskGuide(guide);
      setSafeThresholds(safe);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const riskScoresToday = useMemo(() => {
    const totals = buildTodayIntakeTotalsFromLogs(sortedLogs);
    return computeDynamicRiskMap({ dailyRiskGuide, totals, safeThresholds: safeThresholds ?? {} });
  }, [sortedLogs, dailyRiskGuide, safeThresholds]);

  const projectedRiskScores = useMemo(() => {
    // "If I logged the current draft right now" — add draft quantities onto today's totals.
    const totals = buildTodayIntakeTotalsFromLogs(sortedLogs);

    const add = (label: string, unit: MealUnit, qty: number) => {
      const key = label.trim().toLowerCase();
      if (!key) return;
      const prev = totals[key] ?? {};
      const cur = (prev as any)[unit] ?? 0;
      totals[key] = { ...prev, [unit]: cur + Math.max(0, qty) };
    };

    for (const it of currentMealItems) add(it.label, it.unit, it.quantity);
    if (pendingScan) add(pendingScan.label, pendingScan.unit, pendingScan.quantity);

    return computeDynamicRiskMap({ dailyRiskGuide, totals, safeThresholds: safeThresholds ?? {} });
  }, [sortedLogs, currentMealItems, pendingScan, dailyRiskGuide, safeThresholds]);

  const riskDotForLabel = (label: string, mode: 'today' | 'projected' = 'today') => {
    const key = label.trim().toLowerCase();
    const score = (mode === 'projected' ? projectedRiskScores : riskScoresToday)[key];
    if (typeof score !== 'number') return null;
    return colorHex(scoreToColor(score));
  };

  const addLoggedMealToBasket = (log: LogItem) => {
    if (log.mealMeta) {
      try {
        const parsed = JSON.parse(log.mealMeta) as unknown;
        if (Array.isArray(parsed)) {
          const next: MealBasketItem[] = parsed
            .map((x: any) => {
              if (!x || typeof x !== 'object') return null;
              if (typeof x.label !== 'string' || typeof x.kind !== 'string') return null;
              const unit: MealUnit = MEAL_UNITS.includes(x.unit) ? x.unit : 'x';
              const quantity = typeof x.quantity === 'number' && Number.isFinite(x.quantity) ? x.quantity : 1;
              return {
                id: newBasketId(),
                kind: x.kind === 'scanned' ? 'scanned' : 'manual',
                label: x.label,
                unit,
                quantity,
                amountNote: typeof x.amountNote === 'string' ? x.amountNote : undefined,
                barcode: typeof x.barcode === 'string' ? x.barcode : undefined,
                brand: typeof x.brand === 'string' ? x.brand : undefined,
                risk: typeof x.risk === 'string' ? x.risk : undefined,
                ingredients: typeof x.ingredients === 'string' ? x.ingredients : undefined,
                ingredientsParsed: Array.isArray(x.ingredientsParsed) ? x.ingredientsParsed.filter((s: any) => typeof s === 'string') : undefined,
              } satisfies MealBasketItem;
            })
            .filter(Boolean) as MealBasketItem[];

          if (next.length > 0) {
            setCurrentMealItems((prev) => [...prev, ...next]);
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            return;
          }
        }
      } catch {
        // fall back
      }
    }

    // fallback: single manual line
    setCurrentMealItems((prev) => [...prev, defaultBasketItem({ id: newBasketId(), kind: 'manual', label: log.key })]);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const fetchBarcodeData = async (code: string) => {
    if (fetchInFlight.current) return;
    if (pendingScan) return;
    fetchInFlight.current = true;
    setLoading(true);
    setScanNotFound(false);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json?lc=en&cc=gb&fields=product_name,product_name_en,generic_name,brands,ingredients_text,serving_size,product_quantity,product_quantity_unit,image_url,image_small_url`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const data = await res.json();

      if (data.status === 1) {
        const p = data.product;
        const productName = p.product_name_en || p.product_name || p.generic_name || 'Unknown Product';
        const brandName = p.brands ? p.brands.split(',')[0].trim() : 'Generic';

        const rawIngs = p.ingredients_text ? p.ingredients_text.split(',') : [];
        const cleanIngs = rawIngs
          .map((i: string) => i.trim())
          .filter((i: string) => i.length > 1)
          .slice(0, 12);

        const riskValue = (productName + (p.ingredients_text || '')).toLowerCase().match(
          /vinegar|spicy|onion|chocolate|coffee|chili|pepper|garlic|citric|mint/
        )
          ? 'high'
          : 'moderate';

        const rawIngredientsText = typeof p.ingredients_text === 'string' ? p.ingredients_text : '';

        // Smart defaults for scanned items based on OFF fields
        let defaultUnit: MealUnit = 'x';
        let defaultQty = 1;

        const servingSizeRaw = typeof p.serving_size === 'string' ? p.serving_size : '';
        const servingMatch = servingSizeRaw.trim().match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
        if (servingMatch) {
          defaultQty = parseFloat(servingMatch[1].replace(',', '.'));
          defaultUnit = servingMatch[2].toLowerCase() as MealUnit;
        } else if (typeof p.product_quantity === 'number' && Number.isFinite(p.product_quantity)) {
          const unitRaw = typeof p.product_quantity_unit === 'string' ? p.product_quantity_unit.toLowerCase() : '';
          if (unitRaw === 'g' || unitRaw === 'ml') {
            defaultQty = p.product_quantity;
            defaultUnit = unitRaw as MealUnit;
          }
        }

        const item = {
          ...defaultBasketItem({
          id: newBasketId(),
          kind: 'scanned',
          label: productName,
          brand: brandName,
          risk: riskValue,
          barcode: String(code),
          ingredients: rawIngredientsText,
          ingredientsParsed: cleanIngs.length > 0 ? cleanIngs : ['Ingredients check required'],
          }),
          unit: defaultUnit,
          quantity: defaultUnit === 'x' ? roundToHalf(defaultQty) : clampQty(defaultQty),
        } satisfies MealBasketItem;

        const imageUrl =
          typeof p.image_small_url === 'string'
            ? p.image_small_url
            : typeof p.image_url === 'string'
              ? p.image_url
              : undefined;

        setPendingScan({ ...item, imageUrl });
        setPendingScanActionStatus('idle');
        setIsScanning(false);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setScanNotFound(true);
        setTimeout(() => setScanNotFound(false), 3000);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setScanNotFound(true);
        setTimeout(() => setScanNotFound(false), 3000);
        return;
      }
      console.log('Scan error', e);
      setScanNotFound(true);
      setTimeout(() => setScanNotFound(false), 3000);
    } finally {
      setLoading(false);
      setIsSearching(false);
      fetchInFlight.current = false;
      lastScanRef.current = null;
    }
  };

  const closePendingScan = () => {
    setPendingScan(null);
    setPendingScanActionStatus('idle');
    setIsScanning(false);
  };

  const confirmAddPendingToDraft = () => {
    if (!pendingScan) return;
    const { imageUrl: _img, ...item } = pendingScan;
    setPendingScan(null);
    setCurrentMealItems((prev) => [...prev, item]);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsScanning(false);
  };

  const confirmSavePendingAsSnack = async () => {
    if (!pendingScan) return;
    if (pendingScanActionStatus !== 'idle') return;
    const { imageUrl: _img, ...item } = pendingScan;
    try {
      const key = formatMealQuantityLabel(item);
      const digest = buildMealIngredientsDigest([item]);
      const mealMeta = buildMealMetaJson([item]);
      const ingredients = (item.ingredients ?? '').trim();
      const logItem = await addLog(key, 'snack' as any, {
        ...(ingredients ? { ingredients } : {}),
        mealMeta,
        ingredientsDigest: digest,
      });
      prependRecentMealLog(logItem);
      setPendingScanActionStatus('snackLogged');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        closePendingScan();
      }, 650);
    } finally {
      setIsScanning(false);
    }
  };

  const confirmAddPendingAsFavorite = async () => {
    if (!pendingScan) return;
    if (pendingScanActionStatus !== 'idle') return;
    const { imageUrl: _img, ...item } = pendingScan;
    try {
      const risk = item.risk === 'high' || item.risk === 'low' || item.risk === 'moderate' ? item.risk : 'moderate';
      await addFavorite(item.label, 'food', 'snack', 1, risk);

      setPendingScanActionStatus('favoriteAdded');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setIsScanning(false);
      setTimeout(() => {
        closePendingScan();
      }, 650);
    }
  };

  const addManualToBasket = () => {
    const label = mealInput.trim();
    if (!label) return;
    Keyboard.dismiss();
    setCurrentMealItems((prev) => [...prev, defaultBasketItem({ id: newBasketId(), kind: 'manual', label })]);
    setMealInput('');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const logManualAsSnack = async () => {
    const label = mealInput.trim();
    if (!label) return;
    Keyboard.dismiss();
    try {
      const item = await addLog(label, 'snack' as any);
      prependRecentMealLog(item);
      setMealInput('');
      setToast({ text: 'Snack logged', tone: 'success' });
      setTimeout(() => setToast(null), 1500);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const saveManualAsFavoriteSnack = async () => {
    const label = mealInput.trim();
    if (!label) return;
    Keyboard.dismiss();
    try {
      await addFavorite(label, 'food', 'snack', 1, 'moderate');
      setMealInput('');
      setToast({ text: 'Saved to favorites', tone: 'favorite' });
      setTimeout(() => setToast(null), 1500);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const removeBasketItem = (id: string) => {
    setCurrentMealItems((prev) => prev.filter((x) => x.id !== id));
    void Haptics.selectionAsync();
  };

  const parsedInspectLines = useMemo(() => parsePersistedMealLines(inspectLog), [inspectLog]);
  const parsedQuickSaveLines = useMemo(() => parsePersistedMealLines(quickSaveLog), [quickSaveLog]);

  const closeInspect = () => {
    setInspectLog(null);
    setInspectSaveStatus('idle');
    setInspectRemoveStatus('idle');
  };

  const closeQuickSave = () => {
    setQuickSaveLog(null);
    setQuickSaveStatus('idle');
  };

  const inspectSaveAsDiary = async (category: 'meal' | 'snack') => {
    if (!inspectLog) return;
    if (inspectSaveStatus !== 'idle') return;
    try {
      const item = await addLog(inspectLog.key, category, {
        ...(inspectLog.ingredients ? { ingredients: inspectLog.ingredients } : {}),
        ...(inspectLog.mealMeta ? { mealMeta: inspectLog.mealMeta } : {}),
        ...(inspectLog.ingredientsDigest ? { ingredientsDigest: inspectLog.ingredientsDigest } : {}),
      });
      prependRecentMealLog(item);
      if (category === 'meal') {
        try {
          await writePendingPositionCheckAfterMealLog(item);
        } catch {
          // non-critical
        }
      }
      setInspectSaveStatus(category);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        closeInspect();
      }, 700);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const quickSaveAsFavorite = async (category: 'meal' | 'snack') => {
    if (!quickSaveLog) return;
    if (quickSaveStatus !== 'idle') return;
    try {
      await addFavorite(quickSaveLog.key, 'food', category, 1, 'moderate');
      setQuickSaveStatus(category);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        closeQuickSave();
      }, 700);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const inspectRemoveFromRecent = async () => {
    if (!inspectLog) return;
    if (inspectRemoveStatus !== 'idle') return;
    try {
      setInspectRemoveStatus('removing');
      removeRecentMealLogId(inspectLog.id);
      setInspectRemoveStatus('removed');
      setTimeout(() => {
        closeInspect();
      }, 650);
    } catch {
      setInspectRemoveStatus('idle');
    }
  };

  const bumpQuantity = (id: string, delta: number) => {
    setCurrentMealItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const nextRaw = it.quantity + delta;
        const next = roundToHalf(clampQty(nextRaw));
        return { ...it, quantity: next };
      })
    );
    void Haptics.selectionAsync();
  };

  const updateItemUnit = (id: string, unit: MealUnit) => {
    setCurrentMealItems((prev) => prev.map((it) => (it.id === id ? { ...it, unit } : it)));
    setQtyDraft((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    void Haptics.selectionAsync();
  };

  const updateItemAmountNote = (id: string, note: string) => {
    setCurrentMealItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, amountNote: note } : x))
    );
  };

  const bumpPendingQuantity = (delta: number) => {
    setPendingScan((prev) => {
      if (!prev) return prev;
      const nextRaw = prev.quantity + delta;
      return { ...prev, quantity: roundToHalf(clampQty(nextRaw)) };
    });
    void Haptics.selectionAsync();
  };

  const updatePendingScanUnit = (unit: MealUnit) => {
    setPendingScan((prev) => (prev ? { ...prev, unit } : prev));
    void Haptics.selectionAsync();
  };

  const setPendingQuantityFromText = (text: string) => {
    setPendingScan((prev) => {
      if (!prev) return prev;
      const normalized = text.replace(',', '.').trim();
      if (!normalized) return prev;
      if (normalized.endsWith('.')) return prev;
      const n = parseFloat(normalized);
      if (!Number.isFinite(n)) return prev;
      const next = prev.unit === 'x' ? roundToHalf(clampQty(n)) : clampQty(n);
      return { ...prev, quantity: next };
    });
  };

  const setQuantityFromText = (id: string, text: string) => {
    setQtyDraft((prev) => ({ ...prev, [id]: text }));
    setCurrentMealItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const normalized = text.replace(',', '.').trim();
        if (!normalized) return it;
        if (normalized.endsWith('.')) return it;
        const n = parseFloat(normalized);
        if (!Number.isFinite(n)) return it;
        const next = it.unit === 'x' ? roundToHalf(clampQty(n)) : clampQty(n);
        return { ...it, quantity: next };
      })
    );
  };

  const commitQuantityText = (id: string) => {
    setCurrentMealItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const raw = qtyDraft[id];
        if (typeof raw !== 'string') return it;
        const normalized = raw.replace(',', '.').trim();
        if (!normalized) return it.unit === 'x' ? { ...it, quantity: 1 } : { ...it, quantity: clampQty(it.quantity) };
        const n = parseFloat(normalized);
        if (!Number.isFinite(n)) return it;
        const next = it.unit === 'x' ? roundToHalf(clampQty(n)) : clampQty(n);
        return { ...it, quantity: next };
      })
    );
    setQtyDraft((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleLogMeal = async () => {
    if (currentMealItems.length === 0) return;
    if (isLoggingMeal) return;
    Keyboard.dismiss();
    setIsLoggingMeal(true);
    try {
      const combinedKey = currentMealItems
        .map((i) => formatMealQuantityLabel(i)).join(', ');
      const digest = buildMealIngredientsDigest(currentMealItems);
      const combinedIngredients =
        buildCombinedIngredientsText(currentMealItems).trim();
      const mealMeta = buildMealMetaJson(currentMealItems);
      const item = await addLog(combinedKey, 'meal' as any, {
        ...(combinedIngredients ? { ingredients: combinedIngredients } : {}),
        mealMeta,
        ingredientsDigest: digest,
      });
      prependRecentMealLog(item);
      try {
        await writePendingPositionCheckAfterMealLog(item);
      } catch {
        // non-critical
      }
      setCurrentMealItems([]);
      setQtyDraft({});
      setMealInput('');
      setExpandedUnitItemId(null);
      setToast({ text: 'Meal logged ✓', tone: 'success' });
      setTimeout(() => setToast(null), 1500);
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      );
    } catch {
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error
      );
    } finally {
      setIsLoggingMeal(false);
    }
  };

  if (!IS_DEMO && !permission?.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.brandLockup} pointerEvents="none">
            <Text style={styles.brandTitle}>
              <Text style={styles.brandTitleStrong}>Reflux</Text>
              <Text style={styles.brandTitleLight}>io</Text>
            </Text>
            <Text style={styles.brandTagline}>TRACK • IDENTIFY • HEAL</Text>
          </View>
        </View>

        {/* Permission card */}
        <View style={styles.permissionContainer}>
          <View style={styles.permissionIconWrap}>
            <Ionicons name="camera-outline" size={40} color={HEADER_DARK} />
          </View>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionBody}>
            Refluxio needs access to your camera to scan food barcodes and automatically retrieve ingredient information.
            {'\n\n'}
            Your camera is only used when you tap Scan — it is never accessed in the background.
          </Text>
          <TouchableOpacity onPress={requestPermission} style={styles.permissionBtn}>
            <Ionicons name="barcode-outline" size={20} color="#fff" />
            <Text style={styles.permissionBtnText}>GRANT CAMERA ACCESS</Text>
          </TouchableOpacity>
        </View>

        <BottomSafeAreaShield />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: insets.top }]}>
      {toast ? (
        <View
          style={[
            styles.bottomPillToast,
            { bottom: insets.bottom + 32 },
            toast.tone === 'favorite' ? styles.bottomPillToastFavorite : styles.bottomPillToastSuccess,
          ]}
        >
          <Ionicons
            name={toast.tone === 'favorite' ? 'heart' : 'checkmark-circle'}
            size={16}
            color="#fff"
          />
          <Text style={styles.bottomPillToastText}>{toast.text}</Text>
        </View>
      ) : null}

      {scanNotFound ? (
        <View style={[styles.bottomPillToast, styles.bottomPillToastError, { bottom: insets.bottom + 32 }]}>
          <Ionicons name="warning" size={16} color="#fff" />
          <Text style={styles.bottomPillToastText}>Product not found</Text>
        </View>
      ) : null}

      <AppModal
        visible={Boolean(pendingScan)}
        transparent
        animationType="fade"
        onRequestClose={closePendingScan}
      >
        <Pressable style={styles.modalBackdrop} onPress={closePendingScan}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 18 }}
          >
            <Pressable style={styles.scanChoiceCard} onPress={() => { /* absorb */ }}>
              <View style={styles.scanChoiceHeader}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {pendingScan?.label ? (
                    (() => {
                      const dot = riskDotForLabel(pendingScan.label, 'projected');
                      return dot ? <View style={[styles.riskDot, { backgroundColor: dot }]} /> : null;
                    })()
                  ) : null}
                  <Text style={styles.scanChoiceTitle} numberOfLines={2}>
                    {pendingScan?.label ?? 'Scanned item'}
                  </Text>
                </View>
                <Pressable hitSlop={12} onPress={closePendingScan} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                  <Ionicons name="close" size={22} color={ICON_COLOR} />
                </Pressable>
              </View>

              {pendingScan?.brand ? (
                <Text style={styles.scanChoiceSub}>{pendingScan.brand}</Text>
              ) : null}

              <View style={styles.ingredientsBlock}>
                <Text style={styles.ingredientsLabel}>INGREDIENTS</Text>
                <RNScrollView
                  style={{ maxHeight: 160 }}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 6 }}
                >
                  <HighlightedIngredients
                    text={(pendingScan?.ingredients ?? pendingScan?.ingredientsParsed?.join(', ') ?? '').trim()}
                    riskScores={riskScoresToday}
                  />
                </RNScrollView>
                {(() => {
                  const source = (pendingScan?.ingredients ?? pendingScan?.ingredientsParsed?.join(', ') ?? '').trim();
                  const matches = getTriggerMatches(source);
                  if (matches.length === 0) return null;
                  return (
                    <View style={styles.triggerPillsRow}>
                      {matches.slice(0, 5).map((m) => (
                        <View key={m.label} style={styles.triggerPill}>
                          <Text style={styles.triggerPillText}>{m.label}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}
              </View>

              {pendingScan ? (
                <>
                  <View style={[styles.qtyRow, { marginTop: 12, paddingLeft: 0 }]}>
                    <View style={styles.qtyLeft}>
                      {pendingScan.unit === 'x' ? (
                        <>
                          <Pressable
                            onPress={() => bumpPendingQuantity(-0.5)}
                            style={({ pressed }) => [styles.qtyBtn, { opacity: pressed ? 0.7 : 1 }]}
                          >
                            <Ionicons name="remove" size={18} color={ICON_COLOR} />
                          </Pressable>
                          <TextInput
                            value={qtyToDisplay(pendingScan.quantity)}
                            onChangeText={setPendingQuantityFromText}
                            keyboardType="numeric"
                            style={styles.qtyInput}
                          />
                          <Pressable
                            onPress={() => bumpPendingQuantity(0.5)}
                            style={({ pressed }) => [styles.qtyBtn, { opacity: pressed ? 0.7 : 1 }]}
                          >
                            <Ionicons name="add" size={18} color={ICON_COLOR} />
                          </Pressable>
                        </>
                      ) : (
                        <TextInput
                          value={pendingScan.quantity.toString()}
                          onChangeText={setPendingQuantityFromText}
                          keyboardType="numeric"
                          style={styles.qtyNumericInput}
                          placeholder={UNIT_LABELS[pendingScan.unit]}
                          placeholderTextColor="#94a3b8"
                        />
                      )}
                    </View>
                  </View>
                  <View style={[styles.unitPickerRow, { paddingLeft: 0 }]}>
                    {PENDING_SCAN_UNITS.map((u) => (
                      <Pressable
                        key={u}
                        onPress={() => updatePendingScanUnit(u)}
                        style={[
                          styles.unitPill,
                          pendingScan.unit === u && styles.unitPillSelected,
                        ]}
                      >
                        <Text style={[
                          styles.unitPillText,
                          pendingScan.unit === u && styles.unitPillTextSelected,
                        ]}>
                          {UNIT_BUTTON_LABELS[u]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <View style={styles.scanChoiceButtons}>
                <Pressable
                  onPress={() => void confirmSavePendingAsSnack()}
                  disabled={pendingScanActionStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    pendingScanActionStatus === 'snackLogged' ? styles.scanChoiceBtnSuccess : styles.scanChoiceBtnPrimary,
                    { opacity: pendingScanActionStatus !== 'idle' ? 1 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Text style={pendingScanActionStatus === 'snackLogged' ? styles.scanChoiceBtnSuccessText : styles.scanChoiceBtnPrimaryText}>
                    {pendingScanActionStatus === 'snackLogged' ? 'LOGGED' : 'Save as Snack'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={confirmAddPendingToDraft}
                  style={({ pressed }) => [styles.scanChoiceBtn, styles.scanChoiceBtnGhost, { opacity: pressed ? 0.92 : 1 }]}
                >
                  <Text style={styles.scanChoiceBtnGhostText}>Add to Meal Draft</Text>
                </Pressable>

                <Pressable
                  onPress={() => void confirmAddPendingAsFavorite()}
                  disabled={pendingScanActionStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    pendingScanActionStatus === 'favoriteAdded' ? styles.scanChoiceBtnSuccess : styles.scanChoiceBtnHeart,
                    { opacity: pendingScanActionStatus !== 'idle' ? 1 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Text style={pendingScanActionStatus === 'favoriteAdded' ? styles.scanChoiceBtnSuccessText : styles.scanChoiceBtnHeartText}>
                    {pendingScanActionStatus === 'favoriteAdded' ? 'ADDED' : 'Add as Favorite Snack'}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </AppModal>

      <AppModal
        visible={Boolean(inspectLog)}
        transparent
        animationType="fade"
        onRequestClose={closeInspect}
      >
        <Pressable style={[styles.modalBackdrop, styles.modalBackdropCentered]} onPress={closeInspect}>
          <Pressable style={styles.scanChoiceCard} onPress={() => { /* absorb */ }}>
            <View style={styles.scanChoiceHeader}>
              <Text style={styles.scanChoiceTitle} numberOfLines={2}>
                {inspectLog?.key ?? 'Meal'}
              </Text>
              <Pressable hitSlop={12} onPress={closeInspect} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <Ionicons name="close" size={22} color={ICON_COLOR} />
              </Pressable>
            </View>

            <View style={[styles.ingredientsBlock, { marginTop: 12 }]}>
              <Text style={styles.ingredientsLabel}>COMPONENTS</Text>
              <RNScrollView
                style={{ maxHeight: 220 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 6, paddingTop: 8 }}
              >
                {(parsedInspectLines && parsedInspectLines.length > 0
                  ? parsedInspectLines
                  : inspectLog?.key
                    ? [inspectLog.key]
                    : []
                ).map((line, idx) => (
                  <Text
                    key={`${idx}-${line}`}
                    style={[styles.inspectComponentLine, { marginTop: idx === 0 ? 0 : 6 }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {idx + 1}. {line}
                  </Text>
                ))}
              </RNScrollView>
            </View>

            <View style={styles.scanChoiceButtons}>
              <View style={styles.scanChoiceBtnRow}>
                <Pressable
                  onPress={() => void inspectSaveAsDiary('snack')}
                  disabled={inspectSaveStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    styles.scanChoiceBtnHalf,
                    inspectSaveStatus === 'snack' ? styles.scanChoiceBtnSuccess : styles.scanChoiceBtnHeart,
                    { opacity: inspectSaveStatus !== 'idle' ? 1 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Ionicons
                    name={inspectSaveStatus === 'snack' ? 'checkmark' : 'fast-food-outline'}
                    size={18}
                    color={inspectSaveStatus === 'snack' ? '#fff' : ICON_COLOR}
                  />
                  <Text
                    style={inspectSaveStatus === 'snack' ? styles.scanChoiceBtnSuccessText : styles.scanChoiceBtnHeartText}
                    numberOfLines={1}
                  >
                    {inspectSaveStatus === 'snack' ? 'SAVED' : 'Save as Snack'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void inspectSaveAsDiary('meal')}
                  disabled={inspectSaveStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    styles.scanChoiceBtnHalf,
                    inspectSaveStatus === 'meal' ? styles.scanChoiceBtnSuccess : styles.scanChoiceBtnHeart,
                    { opacity: inspectSaveStatus !== 'idle' ? 1 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Ionicons
                    name={inspectSaveStatus === 'meal' ? 'checkmark' : 'restaurant-outline'}
                    size={18}
                    color={inspectSaveStatus === 'meal' ? '#fff' : ICON_COLOR}
                  />
                  <Text
                    style={inspectSaveStatus === 'meal' ? styles.scanChoiceBtnSuccessText : styles.scanChoiceBtnHeartText}
                    numberOfLines={1}
                  >
                    {inspectSaveStatus === 'meal' ? 'SAVED' : 'Save as Meal'}
                  </Text>
                </Pressable>
              </View>

              {inspectRemoveStatus === 'removed' ? (
                <View style={[styles.scanChoiceBtn, styles.scanChoiceBtnSuccess]}>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.scanChoiceBtnSuccessText}>REMOVED</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => void inspectRemoveFromRecent()}
                  disabled={inspectRemoveStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    styles.scanChoiceBtnGhost,
                    { opacity: inspectRemoveStatus !== 'idle' ? 0.6 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Text style={styles.scanChoiceBtnGhostText}>
                    {inspectRemoveStatus === 'removing' ? 'Removing…' : 'Remove from Recent'}
                  </Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </Pressable>
      </AppModal>

      <AppModal
        visible={Boolean(quickSaveLog)}
        transparent
        animationType="fade"
        onRequestClose={closeQuickSave}
      >
        <Pressable style={[styles.modalBackdrop, styles.modalBackdropCentered]} onPress={closeQuickSave}>
          <Pressable style={styles.scanChoiceCard} onPress={() => { /* absorb */ }}>
            <View style={styles.scanChoiceHeader}>
              <Text style={styles.scanChoiceTitle} numberOfLines={2}>
                {quickSaveLog?.key ?? 'Meal'}
              </Text>
              <Pressable hitSlop={12} onPress={closeQuickSave} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <Ionicons name="close" size={22} color={ICON_COLOR} />
              </Pressable>
            </View>

            <View style={[styles.ingredientsBlock, { marginTop: 12 }]}>
              <Text style={styles.ingredientsLabel}>COMPONENTS</Text>
              <RNScrollView
                style={{ maxHeight: 220 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 6, paddingTop: 8 }}
              >
                {(parsedQuickSaveLines && parsedQuickSaveLines.length > 0
                  ? parsedQuickSaveLines
                  : quickSaveLog?.key
                    ? [quickSaveLog.key]
                    : []
                ).map((line, idx) => (
                  <Text
                    key={`${idx}-${line}`}
                    style={[styles.inspectComponentLine, { marginTop: idx === 0 ? 0 : 6 }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {idx + 1}. {line}
                  </Text>
                ))}
              </RNScrollView>
            </View>

            <View style={styles.scanChoiceButtons}>
              <View style={styles.scanChoiceBtnRow}>
                <Pressable
                  onPress={() => void quickSaveAsFavorite('snack')}
                  disabled={quickSaveStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    styles.scanChoiceBtnHalf,
                    quickSaveStatus === 'snack' ? styles.scanChoiceBtnSuccess : styles.scanChoiceBtnHeart,
                    { opacity: quickSaveStatus !== 'idle' ? 1 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Ionicons
                    name={quickSaveStatus === 'snack' ? 'checkmark' : 'fast-food-outline'}
                    size={18}
                    color={quickSaveStatus === 'snack' ? '#fff' : ICON_COLOR}
                  />
                  <Text
                    style={quickSaveStatus === 'snack' ? styles.scanChoiceBtnSuccessText : styles.scanChoiceBtnHeartText}
                    numberOfLines={1}
                  >
                    {quickSaveStatus === 'snack' ? 'SAVED' : 'Save as quick Snack'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void quickSaveAsFavorite('meal')}
                  disabled={quickSaveStatus !== 'idle'}
                  style={({ pressed }) => [
                    styles.scanChoiceBtn,
                    styles.scanChoiceBtnHalf,
                    quickSaveStatus === 'meal' ? styles.scanChoiceBtnSuccess : styles.scanChoiceBtnHeart,
                    { opacity: quickSaveStatus !== 'idle' ? 1 : pressed ? 0.92 : 1 },
                  ]}
                >
                  <Ionicons
                    name={quickSaveStatus === 'meal' ? 'checkmark' : 'restaurant-outline'}
                    size={18}
                    color={quickSaveStatus === 'meal' ? '#fff' : ICON_COLOR}
                  />
                  <Text
                    style={quickSaveStatus === 'meal' ? styles.scanChoiceBtnSuccessText : styles.scanChoiceBtnHeartText}
                    numberOfLines={1}
                  >
                    {quickSaveStatus === 'meal' ? 'SAVED' : 'Save as quick Meal'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </AppModal>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContainer, { paddingBottom: (styles.scrollContainer as any).paddingBottom + insets.bottom + 80 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logPageHeader}>
            <View>
              <Text style={styles.logPageHeaderSub}>
                {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' }).toUpperCase()}
              </Text>
              <Text style={styles.logPageHeaderTitle}>Add an item</Text>
            </View>
          </View>
          <View style={styles.scanSection}>
            {isScanning ? (
              <View style={styles.cameraContainer}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  onBarcodeScanned={({ data }) => {
                    const code = String(data ?? '').trim();
                    if (!code) return;
                    if (fetchInFlight.current) return;
                    if (pendingScan) return;

                    const now = Date.now();
                    const lastTs = lastScanRef.current;
                    if (lastTs !== null && now - lastTs < 1200) return;
                    lastScanRef.current = now;

                    setIsScanning(false);
                    setIsSearching(true);
                    void fetchBarcodeData(code);
                  }}
                />
                <TouchableOpacity style={styles.closeCam} onPress={() => setIsScanning(false)}>
                  <Ionicons name="close-circle" size={32} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : isSearching ? (
              <View style={styles.bigScanButton}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.bigScanButtonText}>Looking up product…</Text>
              </View>
            ) : IS_DEMO ? (
              <View style={styles.demoScanBox}>
                <Text style={styles.demoScanTitle}>BARCODE LOOKUP</Text>
                <Text style={styles.demoScanBody}>
                  On the phone app the camera reads the barcode and fetches the ingredients. Try a sample barcode:
                </Text>
                <View style={styles.demoScanRow}>
                  {DEMO_BARCODES.map((item) => (
                    <TouchableOpacity
                      key={item.code}
                      style={styles.demoScanChip}
                      onPress={() => {
                        Keyboard.dismiss();
                        setIsSearching(true);
                        void fetchBarcodeData(item.code);
                      }}
                    >
                      <Ionicons name="barcode-outline" size={16} color={ICON_COLOR} />
                      <Text style={styles.demoScanChipText}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.bigScanButton}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsScanning(true);
                }}
              >
                <View style={styles.iconCircle}>
                  <Ionicons name="barcode-outline" size={28} color="#fff" />
                </View>
                <Text style={styles.bigScanButtonText}>SCAN ITEM</Text>
              </TouchableOpacity>
            )}
        </View>

        {loading && <ActivityIndicator size="large" color={HEADER_DARK} style={{ marginVertical: 10 }} />}

        <View style={styles.manualAddSection}>
          <Text style={[styles.cardLabel, { marginBottom: 8 }]}>MANUAL ADD</Text>
          <View style={styles.manualCard}>
          <Text style={styles.helperText}>
            Add anything by name and add it to your meal draft or add it as a snack.
          </Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. Brown sauce, crisps…"
            placeholderTextColor="#94a3b8"
            value={mealInput}
            onChangeText={(t) => setMealInput(capitalizeCompletedWordsInManualInput(t))}
            multiline
          />
          <View style={styles.halfBtnRow}>
            <TouchableOpacity
              style={[styles.halfBtn, styles.halfBtnGhost, !mealInput.trim() && styles.disabledBtn]}
              onPress={() => void logManualAsSnack()}
              disabled={!mealInput.trim()}
            >
              <Ionicons name="fast-food-outline" size={18} color={ICON_COLOR} />
              <Text style={[styles.halfBtnText, styles.halfBtnTextTight]} numberOfLines={1} adjustsFontSizeToFit>
                LOG AS SNACK
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.halfBtn, styles.halfBtnGhost, !mealInput.trim() && styles.disabledBtn]}
              onPress={() => void saveManualAsFavoriteSnack()}
              disabled={!mealInput.trim()}
            >
              <Ionicons name="star-outline" size={18} color={ICON_COLOR} />
              <Text style={[styles.halfBtnText, styles.halfBtnTextTight]} numberOfLines={1} adjustsFontSizeToFit>
                SAVE AS SNACK
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[
              styles.lineOutlineBtn,
              mealInput.trim() ? styles.lineOutlineBtnActive : null,
              !mealInput.trim() && styles.disabledBtn,
            ]}
            onPress={addManualToBasket}
            disabled={!mealInput.trim()}
          >
            <Ionicons name="add-circle-outline" size={20} color={ICON_COLOR} />
            <Text style={[styles.lineOutlineBtnText, mealInput.trim() ? styles.lineOutlineBtnTextActive : null]}>
              ADD TO MEAL DRAFT
            </Text>
          </TouchableOpacity>
          </View>
        </View>

        <View style={styles.mealDraftSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.cardLabel}>MEAL DRAFT</Text>
            <Text style={styles.cardLabelCount}>{currentMealItems.length} items</Text>
          </View>
          <View style={styles.draftSection}>
          {currentMealItems.length === 0 ? (
            <Text style={styles.draftEmpty}>Nothing in your basket yet. Scan or add items above.</Text>
          ) : (
            <>
              <View style={styles.draftList}>
                {currentMealItems.map((item) => (
                  <View key={item.id} style={styles.draftCard}>
                    <View style={styles.draftTopRow}>
                      <Ionicons name={item.kind === 'scanned' ? 'barcode-outline' : 'create-outline'} size={18} color={ICON_COLOR} />
                      {(() => {
                        const dot = riskDotForLabel(item.label, 'projected');
                        return dot ? <View style={[styles.riskDotSmall, { backgroundColor: dot }]} /> : null;
                      })()}
                      <Text style={styles.draftTitle} numberOfLines={2}>
                        {formatMealQuantityLabel(item)}
                      </Text>
                      <View style={styles.qtyRow}>
                        <View style={styles.qtyLeft}>
                          {item.unit === 'x' ? (
                            <>
                              <Pressable
                                onPress={() => bumpQuantity(item.id, -0.5)}
                                style={({ pressed }) => [styles.qtyBtn, { opacity: pressed ? 0.7 : 1 }]}
                              >
                                <Ionicons name="remove" size={18} color={ICON_COLOR} />
                              </Pressable>
                              <TextInput
                                value={qtyToDisplay(item.quantity)}
                                onChangeText={(t) => setQuantityFromText(item.id, t)}
                                keyboardType="numeric"
                                style={styles.qtyInput}
                              />
                              <Pressable
                                onPress={() => bumpQuantity(item.id, 0.5)}
                                style={({ pressed }) => [styles.qtyBtn, { opacity: pressed ? 0.7 : 1 }]}
                              >
                                <Ionicons name="add" size={18} color={ICON_COLOR} />
                              </Pressable>
                            </>
                          ) : (
                            <TextInput
                              value={typeof qtyDraft[item.id] === 'string' ? qtyDraft[item.id] : item.quantity.toString()}
                              onChangeText={(t) => setQuantityFromText(item.id, t)}
                              onBlur={() => commitQuantityText(item.id)}
                              keyboardType="numeric"
                              style={styles.qtyNumericInput}
                              placeholder={UNIT_LABELS[item.unit]}
                              placeholderTextColor="#94a3b8"
                            />
                          )}
                        </View>
                      </View>
                      <Pressable hitSlop={10} onPress={() => removeBasketItem(item.id)} style={styles.draftRemove}>
                        <Ionicons name="close" size={20} color={ICON_COLOR} />
                      </Pressable>
                    </View>
                    <View style={[styles.unitPickerRow, { flexWrap: 'wrap' }]}>
                      {(() => {
                        const isExpanded = expandedUnitItemId === item.id;
                        let unitsToShow: MealUnit[] = isExpanded ? MEAL_UNITS : [...PRIMARY_UNITS];
                        if (!isExpanded && !PRIMARY_UNITS.includes(item.unit)) {
                          unitsToShow = [...unitsToShow, item.unit];
                        }
                        return (
                          <>
                            {unitsToShow.map((u) => (
                              <Pressable
                                key={u}
                                onPress={() => updateItemUnit(item.id, u)}
                                style={[
                                  styles.unitPill,
                                  item.unit === u && styles.unitPillSelected,
                                ]}
                              >
                                <Text style={[
                                  styles.unitPillText,
                                  item.unit === u && styles.unitPillTextSelected,
                                ]}>
                                  {UNIT_BUTTON_LABELS[u]}
                                </Text>
                              </Pressable>
                            ))}
                            <Pressable
                              onPress={() => setExpandedUnitItemId(isExpanded ? null : item.id)}
                              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                            >
                              <Text style={{ fontFamily: 'OutfitBold', fontSize: 11, color: '#94a3b8', paddingHorizontal: 6 }}>
                                {isExpanded ? '− less' : '+ more'}
                              </Text>
                            </Pressable>
                          </>
                        );
                      })()}
                    </View>
                    <TextInput
                      style={styles.amountNoteInput}
                      placeholder="or describe amount (e.g. normal for a sandwich)"
                      placeholderTextColor="#94a3b8"
                      value={item.amountNote ?? ''}
                      onChangeText={(text) => updateItemAmountNote(item.id, text)}
                      returnKeyType="done"
                      onSubmitEditing={() => Keyboard.dismiss()}
                    />
                  </View>
                ))}
              </View>

              <View style={styles.draftLogBarInline}>
                <TouchableOpacity
                  style={[
                    styles.logMealBtnDraft,
                    isLoggingMeal && { opacity: 0.7 }
                  ]}
                  onPress={() => void handleLogMeal()}
                  disabled={isLoggingMeal}
                >
                  <Ionicons name="restaurant-outline" size={20} color="#fff" />
                  <Text style={styles.logMealBtnDraftText}>
                    {isLoggingMeal ? 'Logging…' : 'LOG AS MEAL'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          </View>
        </View>

        <View style={styles.recentEntriesSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.cardLabel}>RECENT ENTRIES</Text>
            <Text style={styles.cardLabelCount}>Quick-fill</Text>
          </View>
          <View style={styles.templatesSection}>
          {recentMealLogs.length > 0 ? (
            <View style={styles.recentList}>
              {recentMealLogs.map((log, index) => {
                const dot = riskDotForLabel(log.key, 'today') ?? RISK_DOT_FALLBACK;
                return (
                  <View
                    key={log.id}
                    style={[
                      styles.recentRow,
                      index < recentMealLogs.length - 1 && styles.recentRowBorder,
                    ]}
                  >
                    <Pressable
                      style={styles.recentRowMain}
                      onPress={() => {
                        Keyboard.dismiss();
                        addLoggedMealToBasket(log);
                      }}
                    >
                      <View style={[styles.recentRiskSquare, { backgroundColor: dot }]} />
                      <View style={styles.recentRowText}>
                        <Text style={styles.recentRowName} numberOfLines={1}>
                          {log.key}
                        </Text>
                        <Text style={styles.recentRowSub}>{formatRecentLogTime(log.createdAt)}</Text>
                      </View>
                    </Pressable>
                    <View style={styles.recentRowActions}>
                      <Pressable
                        style={styles.recentInspectBtn}
                        onPress={() => setQuickSaveLog(log)}
                        hitSlop={8}
                      >
                        <Ionicons name="heart-outline" size={16} color="#94a3b8" />
                      </Pressable>
                      <Pressable
                        style={styles.recentInspectBtn}
                        onPress={() => setInspectLog(log)}
                        hitSlop={8}
                      >
                        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.recentList}>
              <View style={styles.recentEmptyRow}>
                <View style={[styles.recentRiskSquare, { backgroundColor: RISK_DOT_FALLBACK }]} />
                <View style={styles.recentRowText}>
                  <Text style={styles.recentRowName}>No recent entries</Text>
                  <Text style={styles.recentRowSub}>Your recent meals and snacks will appear here.</Text>
                </View>
              </View>
            </View>
          )}
          </View>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <BottomSafeAreaShield />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  demoScanBox: { borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', padding: 14, borderRadius: APP_RADIUS },
  demoScanTitle: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700', color: '#64748b', marginBottom: 6 },
  demoScanBody: { fontSize: 13, lineHeight: 18, color: '#475569', marginBottom: 10 },
  demoScanRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  demoScanChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: BORDER, paddingVertical: 8, paddingHorizontal: 12 },
  demoScanChipText: { fontSize: 13, fontWeight: '600', color: ICON_COLOR },
  safe: { flex: 1, backgroundColor: BG },
  header: {
    backgroundColor: HEADER_DARK,
    paddingHorizontal: 20,
    // Use `insets.top` via inline style for cross-device consistency.
    paddingTop: 58,
    paddingBottom: 16,
  },
  backBtn: {
    position: 'absolute',
    // Use `insets.top` via inline style for cross-device consistency.
    top: 54,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: APP_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    zIndex: 10,
  },
  brandLockup: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10 },
  brandTitle: { color: '#fff', fontSize: 34, letterSpacing: -0.8, lineHeight: 36 },
  brandTitleStrong: { fontFamily: LOGO_FONT_BOLD },
  brandTitleLight: { fontFamily: LOGO_FONT_LIGHT, color: RISK_LOW },
  brandTagline: { marginTop: 8, color: 'rgba(255,255,255,0.65)', fontSize: 11, fontFamily: 'Outfit', letterSpacing: 3, textAlign: 'center' },
  scrollContainer: { flexGrow: 1, paddingBottom: 16 },
  logPageHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logPageHeaderSub: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: 1,
  },
  logPageHeaderTitle: {
    fontFamily: 'OutfitBold',
    fontSize: 28,
    color: '#0f172a',
    marginTop: 2,
  },
  scanSection: { padding: 20 },
  bigScanButton: {
    backgroundColor: HEADER_DARK,
    borderRadius: APP_RADIUS,
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 14,
    paddingHorizontal: 20,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: APP_RADIUS,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigScanButtonText: {
    color: '#fff',
    fontFamily: 'OutfitBlack',
    fontSize: 15,
    letterSpacing: 1,
  },
  cameraContainer: { height: 250, borderRadius: APP_RADIUS, overflow: 'hidden' },
  closeCam: { position: 'absolute', top: 15, right: 15 },
  cardLabel: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#94a3b8', letterSpacing: 1 },
  cardLabelCount: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#94a3b8',
  },
  helperText: { fontFamily: 'OutfitBold', fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 18 },
  manualAddSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  mealDraftSection: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  recentEntriesSection: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  manualCard: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  textInput: {
    backgroundColor: '#e8edf2',
    borderRadius: APP_RADIUS,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 0,
    minHeight: 56,
    fontFamily: 'OutfitBold',
    color: ICON_COLOR,
  },
  lineOutlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: '#e8edf2',
    backgroundColor: '#e8edf2',
  },
  lineOutlineBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, color: ICON_COLOR, letterSpacing: 0.5 },
  lineOutlineBtnActive: { backgroundColor: '#dbe4f0', borderColor: '#dbe4f0' },
  lineOutlineBtnTextActive: { color: '#334155' },
  halfBtnRow: {
    marginTop: 12,
    marginBottom: 12,
    flexDirection: 'row',
    gap: 10,
  },
  halfBtn: {
    flex: 1,
    height: 48,
    borderRadius: APP_RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  halfBtnGhost: { backgroundColor: '#e8edf2', borderColor: '#e8edf2' },
  halfBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, color: ICON_COLOR, letterSpacing: 0.5 },
  halfBtnTextTight: { fontSize: 10, letterSpacing: 0.2 },
  disabledBtn: { opacity: 0.35 },
  templatesSection: {
    marginTop: 0,
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 2,
  },
  horizontalScroll: { paddingHorizontal: 15, gap: 12 },
  mealTile: {
    backgroundColor: 'transparent',
    padding: 16,
    borderRadius: APP_RADIUS,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    width: 140,
    height: 110,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: BORDER,
  },
  tileTitle: { fontFamily: 'OutfitBlack', fontSize: 13, color: '#64748b', marginTop: 4 },
  draftSection: {
    padding: 16,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
  },
  draftEmpty: {
    fontFamily: 'OutfitBold',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
    marginTop: 4,
  },
  draftList: { marginTop: 8, gap: 10 },
  draftCard: {
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.13,
    shadowRadius: 6,
    elevation: 3,
  },
  draftTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  draftTitle: { flex: 1, fontFamily: 'OutfitBold', fontSize: 13, color: ICON_COLOR },
  draftRemove: { padding: 4 },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 0,
    paddingRight: 4,
  },
  qtyLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 36,
    height: 32,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  qtyInput: {
    width: 46,
    height: 32,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    textAlign: 'center',
    fontFamily: 'OutfitBlack',
    fontSize: 13,
    color: ICON_COLOR,
    paddingVertical: 0,
    backgroundColor: 'transparent',
  },
  qtyNumericInput: {
    width: 92,
    height: 32,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    textAlign: 'center',
    fontFamily: 'OutfitBlack',
    fontSize: 13,
    color: ICON_COLOR,
    paddingVertical: 0,
    backgroundColor: 'transparent',
  },
  unitSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    height: 32,
    backgroundColor: 'transparent',
  },
  unitOption: {
    minWidth: 34,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitOptionIdle: { backgroundColor: 'transparent' },
  unitOptionSelected: { backgroundColor: HEADER_DARK },
  unitOptionText: { fontFamily: 'OutfitBlack', fontSize: 12, color: '#64748b', textTransform: 'none' },
  unitOptionTextSelected: { color: '#fff' },
  unitPickerRow: {
    flexDirection: 'row',
    gap: 6,
    paddingLeft: 28,
    paddingRight: 4,
    marginTop: 8,
  },
  unitPill: {
    height: 28,
    width: 74,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitPillSelected: {
    backgroundColor: HEADER_DARK,
    borderColor: HEADER_DARK,
  },
  unitPillText: {
    fontFamily: 'OutfitBold',
    fontSize: 11,
    color: '#64748b',
  },
  unitPillTextSelected: {
    color: '#fff',
  },
  amountNoteInput: {
    marginTop: 8,
    marginLeft: 28,
    marginRight: 4,
    height: 38,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 0,
    fontFamily: 'Outfit',
    fontSize: 12,
    color: ICON_COLOR,
    backgroundColor: '#fff',
    textAlignVertical: 'center',
  },
  favoriteToggle: {
    width: 54,
    height: 56,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  favoriteToggleOn: { borderColor: 'rgba(239, 68, 68, 0.35)' },
  /** Same height / radius as `lineOutlineBtn` (ADD TO MEAL DRAFT). */
  logMealBtnDraft: {
    width: '100%',
    minWidth: '100%',
    height: 48,
    borderRadius: APP_RADIUS,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    backgroundColor: HEADER_DARK,
    borderColor: 'rgba(15, 23, 42, 0.35)',
  },
  logMealBtnDraftText: { color: '#fff', fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 0.5 },
  /** Footer inside meal draft card (below item list), not a screen-level overlay. */
  draftLogBarInline: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226,232,240,0.85)',
  },
  bottomPillToast: {
    position: 'absolute',
    left: 40,
    right: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: APP_RADIUS,
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 999,
  },
  bottomPillToastSuccess: { backgroundColor: HEADER_DARK },
  bottomPillToastFavorite: { backgroundColor: HEADER_DARK },
  bottomPillToastError: { backgroundColor: '#991b1b' },
  bottomPillToastText: { color: '#fff', fontFamily: 'OutfitBlack', fontSize: 12 },
  recentList: { paddingHorizontal: 12, marginBottom: 8 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  recentRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: RECENT_ROW_BORDER,
  },
  recentRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentRiskSquare: {
    width: 10,
    height: 10,
    borderRadius: APP_RADIUS,
  },
  recentRowText: { flex: 1 },
  recentRowName: {
    fontFamily: 'Outfit',
    fontSize: 14,
    color: '#334155',
  },
  recentRowSub: {
    fontFamily: 'Outfit',
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 1,
  },
  recentInspectBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  recentEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  primaryLogBtn: {
    backgroundColor: HEADER_DARK,
    borderRadius: APP_RADIUS,
    height: 55,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 20,
  },
  primaryLogBtnText: { color: '#fff', fontWeight: '900', fontSize: 14 },

  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  permissionIconWrap: {
    width: 88,
    height: 88,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  permissionTitle: {
    fontFamily: 'OutfitBlack',
    fontSize: 22,
    color: HEADER_DARK,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  permissionBody: {
    fontFamily: 'OutfitBold',
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionBtn: {
    marginTop: 8,
    width: '100%',
    height: 56,
    borderRadius: APP_RADIUS,
    backgroundColor: HEADER_DARK,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  permissionBtnText: {
    fontFamily: 'OutfitBlack',
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.8,
  },
  permissionSkip: {
    paddingVertical: 10,
  },
  permissionSkipText: {
    fontFamily: 'OutfitBold',
    fontSize: 14,
    color: '#94a3b8',
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  modalBackdropCentered: { justifyContent: 'center', paddingHorizontal: 18 },
  scanChoiceCard: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  scanChoiceHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  scanChoiceTitle: { flex: 1, fontFamily: 'OutfitBlack', fontSize: 18, color: ICON_COLOR, lineHeight: 24 },
  riskDot: { width: 12, height: 12, borderRadius: APP_RADIUS},
  riskDotSmall: { width: 10, height: 10, borderRadius: APP_RADIUS},
  scanChoiceSub: { marginTop: 6, fontFamily: 'OutfitBold', fontSize: 12, color: '#64748b' },
  ingredientsBlock: {
    marginTop: 12,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
    padding: 12,
  },
  ingredientsLabel: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#94a3b8', letterSpacing: 1 },
  ingredientsBody: { marginTop: 8, fontFamily: 'OutfitBold', fontSize: 12, color: '#334155', lineHeight: 18 },
  ingredientsBodyMuted: { marginTop: 8, fontFamily: 'OutfitBold', fontSize: 12, color: '#94a3b8', lineHeight: 18 },
  inspectComponentLine: { fontFamily: 'OutfitBold', fontSize: 12, color: '#334155', lineHeight: 16 },
  triggerPillsRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  triggerPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: APP_RADIUS, backgroundColor: RISK_ORANGE, borderWidth: 1, borderColor: RISK_ORANGE },
  triggerPillText: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#fff', letterSpacing: 0.4 },
  scanChoiceButtons: { marginTop: 14, gap: 10 },
  scanChoiceBtnRow: { flexDirection: 'row', gap: 10 },
  scanChoiceBtnHalf: { flex: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 10 },
  scanChoiceBtn: { height: 48, borderRadius: APP_RADIUS, alignItems: 'center', justifyContent: 'center' },
  scanChoiceBtnPrimary: { backgroundColor: HEADER_DARK },
  scanChoiceBtnPrimaryText: { color: '#fff', fontFamily: 'OutfitBlack', fontSize: 13, letterSpacing: 0.6 },
  scanChoiceBtnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER },
  scanChoiceBtnGhostText: { color: ICON_COLOR, fontFamily: 'OutfitBlack', fontSize: 13, letterSpacing: 0.6 },
  scanChoiceBtnSuccess: { backgroundColor: HEADER_DARK, flexDirection: 'row', gap: 8 },
  scanChoiceBtnSuccessText: { color: '#fff', fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1 },
  scanChoiceBtnHeart: { backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER },
  scanChoiceBtnHeartText: { color: ICON_COLOR, fontFamily: 'OutfitBlack', fontSize: 13, letterSpacing: 0.6 },
});
