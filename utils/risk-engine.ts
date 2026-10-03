import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LogItem } from '@/hooks/use-log-store';

export type IntakeUnit = 'x' | 'g' | 'ml';

export type IntakeTotalsByUnit = {
  x?: number;
  g?: number;
  ml?: number;
};

export type IntakeTotalsMap = Record<string, IntakeTotalsByUnit>;

export type SafeThreshold = { amount: number; unit: IntakeUnit; raw: string };
export type SafeThresholdMap = Record<string, SafeThreshold>;

const DAILY_REPORT_CACHE_KEY = 'heartburn.dailyReportCache.v1';
const PENDING_INVESTIGATION_STORAGE_KEY = 'heartburn.pendingInvestigation.v1';
const CONFIRMED_ITEMS_STORAGE_KEY = 'heartburn.confirmedItems.v1';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const ANTACID_KEYWORDS = [
  'gaviscon',
  'omeprazole',
  'nexium',
  'lansoprazole',
  'famotidine',
  'ranitidine',
  'antacid',
  'pepto',
  'magnesium trisilicate',
] as const;

const MEDICATION_LOG_TYPES = new Set(['medication', 'med']);

function normalizeLabel(label: string) {
  return label.trim().toLowerCase();
}

function startOfLocalDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isToday(ts: number, nowTs = Date.now()) {
  return startOfLocalDay(ts) === startOfLocalDay(nowTs);
}

export function parseAmountToken(raw: string): { label: string; amount: number; unit: IntakeUnit } | null {
  const t = raw.trim();
  // Matches "... (200g)" or "... (200ml)" or "... (1x)"
  const m = t.match(/^(.*)\(\s*(\d+(?:[.,]\d+)?)\s*(g|ml|x)\s*\)\s*$/i);
  if (!m) return null;
  const label = (m[1] ?? '').trim();
  const amount = parseFloat(String(m[2]).replace(',', '.'));
  const unit = String(m[3]).toLowerCase() as IntakeUnit;
  if (!label || !Number.isFinite(amount)) return null;
  return { label, amount, unit };
}

function addToTotals(map: IntakeTotalsMap, label: string, unit: IntakeUnit, amount: number) {
  const k = normalizeLabel(label);
  const prev = map[k] ?? {};
  const cur = prev[unit] ?? 0;
  map[k] = { ...prev, [unit]: cur + amount };
}

type MealPersistedLine = {
  label: string;
  quantity: number;
  unit: IntakeUnit;
};

function parseMealMeta(mealMeta: string): MealPersistedLine[] | null {
  try {
    const parsed = JSON.parse(mealMeta) as unknown;
    if (!Array.isArray(parsed)) return null;
    const lines: MealPersistedLine[] = parsed
      .map((x: any) => {
        if (!x || typeof x !== 'object') return null;
        if (typeof x.label !== 'string') return null;
        const unit: IntakeUnit = x.unit === 'g' || x.unit === 'ml' || x.unit === 'x' ? x.unit : 'x';
        const quantity = typeof x.quantity === 'number' && Number.isFinite(x.quantity) ? x.quantity : 1;
        return { label: x.label, unit, quantity } satisfies MealPersistedLine;
      })
      .filter(Boolean) as MealPersistedLine[];
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

export function buildTodayIntakeTotalsFromLogs(logs: LogItem[], nowTs = Date.now()): IntakeTotalsMap {
  const intakeTypes = new Set(['food', 'drink', 'snack', 'meal', 'trigger']);
  const totals: IntakeTotalsMap = {};

  for (const l of logs) {
    if (!intakeTypes.has(l.type)) continue;
    if (!isToday(l.createdAt, nowTs)) continue;
    const ageMs = nowTs - l.createdAt;
    if (ageMs > SIX_HOURS_MS) continue;

    // Preferred: structured mealMeta.
    if (typeof l.mealMeta === 'string' && l.mealMeta.trim()) {
      const lines = parseMealMeta(l.mealMeta);
      if (lines) {
        for (const line of lines) {
          addToTotals(totals, line.label, line.unit, Math.max(0, line.quantity));
        }
        continue;
      }
    }

    // Fallback: parse "Name (200g)" patterns, possibly comma-separated.
    const parts = String(l.key ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    let anyParsed = false;
    for (const p of parts) {
      const parsed = parseAmountToken(p);
      if (!parsed) continue;
      anyParsed = true;
      addToTotals(totals, parsed.label, parsed.unit, Math.max(0, parsed.amount));
    }

    if (!anyParsed) {
      // Last resort: 1x of the whole key
      const label = String(l.key ?? '').trim();
      if (label) addToTotals(totals, label, 'x', 1);
    }
  }

  return totals;
}

export function scoreToColor(score: number): 'green' | 'orange' | 'red' {
  const s = Math.max(0, Math.min(10, Math.round(score)));
  if (s <= 3) return 'green';
  if (s <= 7) return 'orange';
  return 'red';
}

export function getRiskScoreForLabel(
  label: string,
  riskMap: Record<string, number>
): number | null {
  if (!label?.trim()) return null;

  // Try direct match first
  const direct = riskMap[normalizeLabel(label)];
  if (typeof direct === 'number') return direct;

  // Split compound meal keys on comma
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);

  let best: number | null = null;
  for (const part of parts) {
    // Strip quantity suffix: "Coffee (2x)" -> "Coffee", "Milk (10ml)" -> "Milk"
    const stripped = part.replace(/\s*\(\s*[\d.,]+\s*(?:x|g|ml|handful|cup|pinch|tbsp|tsp)\s*\)/i, '').trim();
    const key = normalizeLabel(stripped);
    if (!key) continue;

    // Try exact match
    const score = riskMap[key];
    if (typeof score === 'number') {
      if (best === null || score > best) best = score;
      continue;
    }

    // Try partial match - check if any risk map key contains this word
    for (const [mapKey, mapScore] of Object.entries(riskMap)) {
      if (mapKey.includes(key) || key.includes(mapKey)) {
        if (typeof mapScore === 'number') {
          if (best === null || mapScore > best) best = mapScore;
        }
      }
    }
  }

  return best;
}

export function colorHex(color: 'green' | 'orange' | 'red') {
  if (color === 'green') return '#2d6a4f';
  if (color === 'orange') return '#d97706';
  return '#991b1b';
}

export function computeDynamicRiskScore(opts: {
  label: string;
  baseGuideScore?: number;
  totals?: IntakeTotalsByUnit;
  safeThreshold?: SafeThreshold;
}) {
  const base = typeof opts.baseGuideScore === 'number' && Number.isFinite(opts.baseGuideScore) ? opts.baseGuideScore : 0;
  const safe = opts.safeThreshold;
  const totals = opts.totals ?? {};

  if (!safe) return Math.max(0, Math.min(10, Math.round(base)));
  const current = totals[safe.unit];
  if (typeof current !== 'number' || !Number.isFinite(current) || safe.amount <= 0) return Math.max(0, Math.min(10, Math.round(base)));

  const ratio = current / safe.amount;
  const scaled = base * ratio;
  return Math.max(0, Math.min(10, Math.round(scaled)));
}

function labelMatchesAntacidKeyword(label: string): boolean {
  const lower = label.toLowerCase();
  return ANTACID_KEYWORDS.some((kw) => lower.includes(kw));
}

function hasAntacidMedicationLoggedToday(logs: LogItem[], nowTs: number): boolean {
  for (const l of logs) {
    if (!MEDICATION_LOG_TYPES.has(l.type)) continue;
    if (!isToday(l.createdAt, nowTs)) continue;
    if (labelMatchesAntacidKeyword(String(l.key ?? ''))) return true;
  }
  return false;
}

function applyAntacidReduction(scores: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) {
    out[k] = Math.max(0, Math.min(10, Math.round(v * 0.6)));
  }
  return out;
}

export function computeDynamicRiskMap(input: {
  dailyRiskGuide?: Record<string, number> | null;
  totals: IntakeTotalsMap;
  safeThresholds?: SafeThresholdMap | null;
  logs?: LogItem[];
  nowTs?: number;
}) {
  const nowTs = input.nowTs ?? Date.now();
  const guide = input.dailyRiskGuide ?? {};
  const safeMap = input.safeThresholds ?? {};

  const out: Record<string, number> = {};
  for (const [labelKey, totalsByUnit] of Object.entries(input.totals)) {
    const baseGuideScore = guide[labelKey];
    const safeThreshold = safeMap[labelKey];
    const score = computeDynamicRiskScore({ label: labelKey, baseGuideScore, totals: totalsByUnit, safeThreshold });
    out[labelKey] = score;
  }
  // Include guide-only items (even if not consumed yet today)
  for (const [k, v] of Object.entries(guide)) {
    const key = normalizeLabel(k);
    if (out[key] !== undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[key] = Math.max(0, Math.min(10, Math.round(v)));
  }

  if (input.logs?.length && hasAntacidMedicationLoggedToday(input.logs, nowTs)) {
    return applyAntacidReduction(out);
  }
  return out;
}

export async function loadLatestDailyRiskGuide(): Promise<Record<string, number> | null> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;
    const entries = Object.entries(parsed).filter(([k, v]) => typeof k === 'string' && v && typeof v === 'object');
    // Prefer most-recent key by lexical order (YYYY-MM-DD).
    entries.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    for (const [, v] of entries) {
      const guide = (v as any)?.dailyRiskGuide;
      if (!guide || typeof guide !== 'object' || Array.isArray(guide)) continue;
      const out = Object.fromEntries(
        Object.entries(guide as Record<string, unknown>)
          .map(([k, val]) => {
            const key = normalizeLabel(String(k ?? ''));
            const n = typeof val === 'number' && Number.isFinite(val) ? Math.max(0, Math.min(10, Math.round(val))) : null;
            if (!key || n === null) return null;
            return [key, n] as const;
          })
          .filter(Boolean) as Array<readonly [string, number]>
      );
      return Object.keys(out).length ? out : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadSafeThresholds(): Promise<SafeThresholdMap> {
  const out: SafeThresholdMap = {};
  try {
    const raw = await AsyncStorage.getItem(PENDING_INVESTIGATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as any;
      const items = Array.isArray(parsed?.items) ? parsed.items : [];

      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const label = typeof it.label === 'string' ? it.label : null;
        const safeThresholdRaw = typeof it.safeThreshold === 'string' ? it.safeThreshold.trim() : '';
        if (!label || !safeThresholdRaw) continue;

        const m = safeThresholdRaw.match(/^(\d+(?:[.,]\d+)?)\s*(g|ml|x)\b/i);
        if (!m) continue;
        const amount = parseFloat(String(m[1]).replace(',', '.'));
        const unit = String(m[2]).toLowerCase() as IntakeUnit;
        if (!Number.isFinite(amount) || amount <= 0) continue;
        out[normalizeLabel(label)] = { amount, unit, raw: safeThresholdRaw };
      }
    }
  } catch {
    return {};
  }

  // Also load safe thresholds from confirmed-safe items
  try {
    const confirmedRaw = await AsyncStorage.getItem(
      CONFIRMED_ITEMS_STORAGE_KEY
    );
    if (confirmedRaw) {
      const confirmed = JSON.parse(confirmedRaw) as unknown;
      if (Array.isArray(confirmed)) {
        for (const it of confirmed) {
          if (!it || typeof it !== 'object') continue;
          if ((it as any).verdict !== 'confirmed-safe') continue;
          const label = typeof (it as any).label === 'string'
            ? (it as any).label : null;
          const safeThresholdRaw = typeof (it as any).safeThreshold === 'string'
            ? (it as any).safeThreshold.trim() : '';
          if (!label || !safeThresholdRaw) continue;
          const m = safeThresholdRaw.match(
            /^(\d+(?:[.,]\d+)?)\s*(g|ml|x)\b/i
          );
          if (!m) continue;
          const amount = parseFloat(String(m[1]).replace(',', '.'));
          const unit = String(m[2]).toLowerCase() as IntakeUnit;
          if (!Number.isFinite(amount) || amount <= 0) continue;
          // Only add if not already set by pendingInvestigation
          const key = normalizeLabel(label);
          if (!out[key]) {
            out[key] = { amount, unit, raw: safeThresholdRaw };
          }
        }
      }
    }
  } catch {
    // ignore confirmed items read failure
  }

  return out;
}

