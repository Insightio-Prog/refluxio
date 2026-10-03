import type { LogItem, SymptomSeverity } from '@/hooks/use-log-store';
import type { PollenHistoryEntry } from '@/utils/pollen-service';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const INTAKE_TYPES = new Set<LogItem['type']>(['food', 'drink', 'snack', 'meal', 'trigger']);

type IngredientStats = {
  name: string;
  frequency: number;
  symptomCount: number;
};

type MealMetaLine = {
  label: string;
};

function localDayIso(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(ts: number, days: number): number {
  return ts + days * DAY_MS;
}

function normalizeDays(days: number): number {
  return Math.max(1, Math.floor(Number.isFinite(days) ? days : 1));
}

function getCalendarWindow(days: number, nowTs = Date.now()): { startTs: number; endTs: number } {
  const count = normalizeDays(days);
  const todayStart = startOfLocalDay(nowTs);
  return {
    startTs: addDays(todayStart, -(count - 1)),
    endTs: addDays(todayStart, 1),
  };
}

function getCurrentWeekStart(nowTs = Date.now()): number {
  const todayStart = startOfLocalDay(nowTs);
  const day = new Date(todayStart).getDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(todayStart, -daysSinceMonday);
}

function isIntakeLog(log: LogItem): boolean {
  return INTAKE_TYPES.has(log.type);
}

function cleanIngredientName(raw: string): string {
  return raw
    .replace(/\([^)]*\b(?:g|ml|x)\s*\)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ingredientKey(name: string): string {
  return name.trim().toLowerCase();
}

function splitIngredientText(text: string): string[] {
  return text
    .split(/[,;\n|]+/)
    .map(cleanIngredientName)
    .filter(Boolean);
}

function parseMealMeta(mealMeta: string | undefined): MealMetaLine[] {
  if (!mealMeta?.trim()) return [];
  try {
    const parsed = JSON.parse(mealMeta) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x: any) => {
        if (!x || typeof x !== 'object' || typeof x.label !== 'string') return null;
        const label = cleanIngredientName(x.label);
        return label ? ({ label } satisfies MealMetaLine) : null;
      })
      .filter(Boolean) as MealMetaLine[];
  } catch {
    return [];
  }
}

function ingredientNamesForLog(log: LogItem): string[] {
  const structuredMealNames = parseMealMeta(log.mealMeta).map((x) => x.label);
  const rawNames = structuredMealNames.length
    ? structuredMealNames
    : [
        ...splitIngredientText(log.ingredients ?? ''),
        ...splitIngredientText(log.ingredientsDigest ?? ''),
        ...splitIngredientText(log.key ?? ''),
      ];
  return Array.from(new Set(rawNames.map(cleanIngredientName).filter(Boolean)));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

function shortWeekday(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  return `${shortWeekday(ts)} ${d.getDate()}`;
}

function timeBucketIndex(ts: number): number | null {
  const hour = new Date(ts).getHours();
  if (hour >= 6) return Math.floor((hour - 6) / 2);
  return 9 + Math.floor(hour / 2);
}

export function severityToScore(s: SymptomSeverity | undefined): number {
  if (s === 'mild') return 1;
  if (s === 'moderate') return 2;
  if (s === 'severe') return 3;
  return 0;
}

export function getDailyScores(logs: LogItem[], days: number = 30): Record<string, number> {
  const count = normalizeDays(days);
  const { startTs, endTs } = getCalendarWindow(count);
  const scores: Record<string, number> = {};

  for (let i = 0; i < count; i += 1) {
    const dayStart = addDays(startTs, i);
    scores[localDayIso(dayStart)] = 0;
  }

  for (const log of logs) {
    if (log.type !== 'symptom') continue;
    if (log.createdAt < startTs || log.createdAt >= endTs) continue;
    const dayIso = localDayIso(log.createdAt);
    scores[dayIso] = Math.max(scores[dayIso] ?? 0, severityToScore(log.symptomSeverity));
  }

  return scores;
}

export function getDailyLogPresence(logs: LogItem[], days: number = 30): Record<string, boolean> {
  const count = normalizeDays(days);
  const { startTs, endTs } = getCalendarWindow(count);
  const presence: Record<string, boolean> = {};

  for (const log of logs) {
    if (log.createdAt < startTs || log.createdAt >= endTs) continue;
    presence[localDayIso(log.createdAt)] = true;
  }

  return presence;
}

function isMedicationLog(log: LogItem): boolean {
  if (log.type === 'med' || log.type === 'medication') return true;
  const key = log.key.toLowerCase();
  return (
    key.includes('lansoprazole') ||
    key.includes('omeprazole') ||
    key.includes('pantoprazole') ||
    key.includes('ranitidine') ||
    key.includes('famotidine') ||
    key.includes('antacid') ||
    key.includes('gaviscon') ||
    key.includes('rennie') ||
    (log.type === 'trigger' && (key.includes('medication') || key.includes('med')))
  );
}

export function getIngredientCorrelations(
  logs: LogItem[],
  symptomLookbackHours: number = 6,
  days: number = 30
): { name: string; frequency: number; symptomCorrelation: number }[] {
  const { startTs, endTs } = getCalendarWindow(days);
  const lookbackMs = Math.max(0, symptomLookbackHours) * HOUR_MS;
  const recentLogs = logs.filter((log) => log.createdAt >= startTs && log.createdAt < endTs);
  const symptoms = recentLogs.filter((log) => log.type === 'symptom');
  const stats = new Map<string, IngredientStats>();

  for (const intake of recentLogs) {
    if (!isIntakeLog(intake) || intake.type === 'trigger') continue;
    const keyLower = intake.key.toLowerCase();
    if (
      keyLower.includes('lansoprazole') ||
      keyLower.includes('omeprazole') ||
      keyLower.includes('pantoprazole') ||
      keyLower.includes('ranitidine') ||
      keyLower.includes('famotidine') ||
      keyLower.includes('antacid') ||
      keyLower.includes('gaviscon') ||
      keyLower.includes('rennie')
    ) continue;
    const names = ingredientNamesForLog(intake);
    if (!names.length) continue;

    const hasSymptomAfter = symptoms.some(
      (symptom) => symptom.createdAt > intake.createdAt && symptom.createdAt <= intake.createdAt + lookbackMs
    );

    for (const name of names) {
      const key = ingredientKey(name);
      const current = stats.get(key) ?? { name, frequency: 0, symptomCount: 0 };
      current.frequency += 1;
      if (hasSymptomAfter) current.symptomCount += 1;
      stats.set(key, current);
    }
  }

  return Array.from(stats.values())
    .filter((x) => x.frequency >= 2)
    .map((x) => ({
      name: x.name,
      frequency: x.frequency,
      symptomCorrelation: Math.max(0, Math.min(1, x.symptomCount / x.frequency)),
    }))
    .sort((a, b) => b.symptomCorrelation - a.symptomCorrelation)
    .slice(0, 10);
}

export function getMedicationEffectiveness(logs: LogItem[]): {
  avgWithMeds: number;
  avgWithoutMeds: number;
  reductionPct: number;
} | null {
  const symptoms = logs.filter((log) => log.type === 'symptom');
  const withMeds: number[] = [];
  const withoutMeds: number[] = [];
  const medWindowMs = 4 * HOUR_MS;

  for (const symptom of symptoms) {
    const windowStart = symptom.createdAt - medWindowMs;
    const hadMeds = logs.some((log) => {
      if (log.createdAt < windowStart || log.createdAt >= symptom.createdAt) return false;
      return isMedicationLog(log);
    });
    const score = severityToScore(symptom.symptomSeverity);
    if (hadMeds) withMeds.push(score);
    else withoutMeds.push(score);
  }

  if (withMeds.length < 2 || withoutMeds.length < 2) return null;

  const avgWithMeds = average(withMeds);
  const avgWithoutMeds = average(withoutMeds);
  const reductionPct = avgWithoutMeds > 0 ? Math.round((1 - avgWithMeds / avgWithoutMeds) * 100) : 0;

  return { avgWithMeds, avgWithoutMeds, reductionPct };
}

export function getTimeOfDayGrid(logs: LogItem[], days: number = 7): number[][] {
  const grid = Array.from({ length: 12 }, () => Array.from({ length: 7 }, () => 0));
  const weekStart = getCurrentWeekStart();
  const weekEnd = addDays(weekStart, 7);
  const { startTs } = getCalendarWindow(days);
  const effectiveStart = Math.max(weekStart, startTs);

  for (const log of logs) {
    if (log.type !== 'symptom') continue;
    if (log.createdAt < effectiveStart || log.createdAt >= weekEnd) continue;

    const dayIndex = Math.floor((startOfLocalDay(log.createdAt) - weekStart) / DAY_MS);
    const bucketIndex = timeBucketIndex(log.createdAt);
    if (dayIndex < 0 || dayIndex > 6 || bucketIndex === null) continue;

    grid[bucketIndex][dayIndex] = Math.max(grid[bucketIndex][dayIndex], severityToScore(log.symptomSeverity));
  }

  return grid;
}

export function getWeekSummary(
  logs: LogItem[],
  dailyScores: Record<string, number>
): {
  days: { dateLabel: string; dayIso: string; score: number }[];
  trendLabel: string;
} {
  void logs;
  const weekStart = getCurrentWeekStart();
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = addDays(weekStart, i);
    const dayIso = localDayIso(dayStart);
    return {
      dateLabel: dayLabel(dayStart),
      dayIso,
      score: dailyScores[dayIso] ?? 0,
    };
  });
  const firstThreeAvg = average(days.slice(0, 3).map((d) => d.score));
  const lastThreeAvg = average(days.slice(-3).map((d) => d.score));
  const clearDays = days.filter((d) => d.score === 0).length;

  let trendLabel: string;
  if (lastThreeAvg < firstThreeAvg) {
    trendLabel = `Improving trend — ${clearDays} clear days this week`;
  } else if (lastThreeAvg > firstThreeAvg) {
    trendLabel = `Worsening trend — ${clearDays} symptom days this week`;
  } else {
    trendLabel = `Stable week — ${clearDays} clear days this week`;
  }

  return { days, trendLabel };
}

export function getCalendarStats(
  dailyScores: Record<string, number>,
  days: number = 30,
  logPresence?: Record<string, boolean>
): {
  clearDays: number;
  worstDay: string;
  avgScore: number;
} {
  const count = normalizeDays(days);
  const { startTs } = getCalendarWindow(count);
  const scores = Array.from({ length: count }, (_, i) => {
    const dayStart = addDays(startTs, i);
    const dayIso = localDayIso(dayStart);
    return {
      dayStart,
      dayIso,
      score: dailyScores[dayIso] ?? 0,
    };
  });
  const clearDays = scores.filter((d) => {
    if (d.score !== 0) return false;
    if (logPresence) return logPresence[d.dayIso] === true;
    return true;
  }).length;
  const worst = scores.reduce((max, day) => (day.score > max.score ? day : max), scores[0]);
  const avgScore = Math.round(average(scores.map((d) => d.score)) * 10) / 10;

  return {
    clearDays,
    worstDay: shortWeekday(worst.dayStart),
    avgScore,
  };
}

export function getEnvironmentExposures(
  logs: LogItem[],
  days: number = 30
): { dayIso: string; labels: string[] }[] {
  const { startTs, endTs } = getCalendarWindow(days);
  const labelSets = new Map<string, Set<string>>();

  for (const log of logs) {
    if (log.type !== 'environment') continue;
    if (log.createdAt < startTs || log.createdAt >= endTs) continue;
    const dayIso = localDayIso(log.createdAt);
    const label = String(log.key ?? '').trim();
    if (!label) continue;
    const set = labelSets.get(dayIso) ?? new Set<string>();
    set.add(label);
    labelSets.set(dayIso, set);
  }

  return Array.from(labelSets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayIso, set]) => ({ dayIso, labels: Array.from(set) }));
}

function isHighPollenDay(entry: PollenHistoryEntry): boolean {
  return [entry.tree, entry.grass, entry.weed].some((l) => l === 'high' || l === 'very_high');
}

function isLowPollenDay(entry: PollenHistoryEntry): boolean {
  return [entry.tree, entry.grass, entry.weed].every((l) => l === 'none' || l === 'low');
}

export function getPollenSymptomCorrelation(
  pollenHistory: PollenHistoryEntry[],
  dailyScores: Record<string, number>
): { highPollenAvg: number; lowPollenAvg: number; sampleSize: number } | null {
  const highScores: number[] = [];
  const lowScores: number[] = [];

  for (const entry of pollenHistory) {
    if (!(entry.dayIso in dailyScores)) continue;
    const score = dailyScores[entry.dayIso];
    if (typeof score !== 'number' || !Number.isFinite(score)) continue;
    if (isHighPollenDay(entry)) highScores.push(score);
    else if (isLowPollenDay(entry)) lowScores.push(score);
  }

  if (highScores.length < 3 || lowScores.length < 3) return null;

  const highPollenAvg = Math.round(average(highScores) * 10) / 10;
  const lowPollenAvg = Math.round(average(lowScores) * 10) / 10;
  return {
    highPollenAvg,
    lowPollenAvg,
    sampleSize: highScores.length + lowScores.length,
  };
}
