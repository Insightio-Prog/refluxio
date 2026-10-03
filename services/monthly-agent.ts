import AsyncStorage from '@react-native-async-storage/async-storage';

import { extractClaudeText, getConfirmedItems, postAi, type ConfirmedItem } from '@/services/ai-service';

const MONTHLY_REVIEW_KEY = 'heartburn.monthlyReview.v1';
const LAST_MONTHLY_RUN_KEY = 'heartburn.lastMonthlyRun.v1';
const MONTHLY_BACKUP_KEY = 'heartburn.preMonthlyBackup.v1';
const PENDING_INVESTIGATION_KEY = 'heartburn.pendingInvestigation.v1';
const POTENTIAL_TRIGGERS_KEY = 'heartburn.potentialTriggers.v1';
const DAILY_REPORT_CACHE_KEY = 'heartburn.dailyReportCache.v1';
const DETECTIVE_SUMMARIES_KEY = 'heartburn.detectiveSummaries.v1';
const PROTECTIVE_FACTORS_KEY = 'heartburn.protectiveFactors.v1';

export type MonthlyReviewReport = {
  generatedAtTs: number;
  summary: string; // 2-3 sentence overall trend
  topPattern: string; // single most significant pattern found
  newlyConfirmed: string[]; // trigger labels newly confirmed this month
  removed: string[]; // suspect labels removed as false positives
  protectiveFactors: string[]; // items correlating with clear days
  clearDays: number; // count of clear days in the 30-day window
  worstTrigger: string; // label of highest confidence trigger
  monthLabel: string; // e.g. "April 2026"
};

export type ProtectiveFactor = {
  id: string; // slugified label e.g. 'small-portions'
  label: string; // human readable e.g. 'Small Portions'
  confirmedAtTs: number;
  monthLabel: string; // which monthly review confirmed it
  appearedInReviews: number; // how many monthly reviews it has appeared in
};

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function stripJsonFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function coerceReview(raw: any, clearDaysFallback?: number, monthLabelFallback?: string): MonthlyReviewReport | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.summary !== 'string') return null;
  const generatedAtTs =
    typeof raw.generatedAtTs === 'number' && Number.isFinite(raw.generatedAtTs) ? raw.generatedAtTs : Date.now();
  const clearDays =
    typeof raw.clearDays === 'number' && Number.isFinite(raw.clearDays) ? raw.clearDays : (clearDaysFallback ?? 0);
  const monthLabel = typeof raw.monthLabel === 'string' ? raw.monthLabel : (monthLabelFallback ?? '');

  if (!monthLabel) return null;

  return {
    generatedAtTs,
    summary: raw.summary,
    topPattern: typeof raw.topPattern === 'string' ? raw.topPattern : '',
    newlyConfirmed: stringArray(raw.newlyConfirmed),
    removed: stringArray(raw.removed),
    protectiveFactors: stringArray(raw.protectiveFactors),
    clearDays,
    worstTrigger: typeof raw.worstTrigger === 'string' ? raw.worstTrigger : '—',
    monthLabel,
  };
}

export async function getProtectiveFactors(): Promise<ProtectiveFactor[]> {
  try {
    const raw = await AsyncStorage.getItem(PROTECTIVE_FACTORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x: any) => {
        if (!x || typeof x !== 'object') return null;
        if (typeof x.id !== 'string') return null;
        if (typeof x.label !== 'string') return null;
        if (typeof x.confirmedAtTs !== 'number' || !Number.isFinite(x.confirmedAtTs)) return null;
        if (typeof x.monthLabel !== 'string') return null;
        if (typeof x.appearedInReviews !== 'number' || !Number.isFinite(x.appearedInReviews)) return null;
        return {
          id: x.id,
          label: x.label,
          confirmedAtTs: x.confirmedAtTs,
          monthLabel: x.monthLabel,
          appearedInReviews: x.appearedInReviews,
        } satisfies ProtectiveFactor;
      })
      .filter(Boolean) as ProtectiveFactor[];
  } catch {
    return [];
  }
}

async function persistProtectiveFactors(
  factors: string[],
  monthLabel: string
): Promise<void> {
  try {
    const current = await getProtectiveFactors();
    const map = new Map(current.map((factor) => [factor.id, factor]));
    const nowTs = Date.now();

    for (const labelRaw of factors) {
      const label = labelRaw.trim();
      const id = slugifyLabel(label);
      if (!label || !id) continue;
      const existing = map.get(id);
      map.set(id, {
        id,
        label,
        confirmedAtTs: nowTs,
        monthLabel,
        appearedInReviews: existing ? existing.appearedInReviews + 1 : 1,
      });
    }

    await AsyncStorage.setItem(PROTECTIVE_FACTORS_KEY, JSON.stringify(Array.from(map.values())));
  } catch {
    // ignore persistence failures
  }
}

async function writePreMonthlyBackup(): Promise<void> {
  try {
    const [pendingRaw, triggersRaw, cacheRaw, summariesRaw] = await Promise.all([
      AsyncStorage.getItem(PENDING_INVESTIGATION_KEY),
      AsyncStorage.getItem(POTENTIAL_TRIGGERS_KEY),
      AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY),
      AsyncStorage.getItem(DETECTIVE_SUMMARIES_KEY),
    ]);

    await AsyncStorage.setItem(
      MONTHLY_BACKUP_KEY,
      JSON.stringify({
        [PENDING_INVESTIGATION_KEY]: pendingRaw,
        [POTENTIAL_TRIGGERS_KEY]: triggersRaw,
        [DAILY_REPORT_CACHE_KEY]: cacheRaw,
        [DETECTIVE_SUMMARIES_KEY]: summariesRaw,
        backedUpAtTs: Date.now(),
      })
    );
  } catch {
    // Backup failure should not block the review.
  }
}

export async function shouldRunMonthlyReview(): Promise<boolean> {
  try {
    const lastRunRaw = await AsyncStorage.getItem(LAST_MONTHLY_RUN_KEY);
    if (!lastRunRaw) {
      const summariesRaw = await AsyncStorage.getItem(DETECTIVE_SUMMARIES_KEY);
      const summaries = safeJsonParse<Record<string, unknown>>(summariesRaw, {});
      return Object.keys(summaries && typeof summaries === 'object' ? summaries : {}).length >= 28;
    }

    const lastRunTs = Number(lastRunRaw);
    if (!Number.isFinite(lastRunTs)) return false;
    return Date.now() - lastRunTs >= 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function runMonthlyReview(): Promise<MonthlyReviewReport | null> {
  try {
    await writePreMonthlyBackup();

    const [pendingRaw, triggersRaw, summariesRaw, confirmedItems] = await Promise.all([
      AsyncStorage.getItem(PENDING_INVESTIGATION_KEY),
      AsyncStorage.getItem(POTENTIAL_TRIGGERS_KEY),
      AsyncStorage.getItem(DETECTIVE_SUMMARIES_KEY),
      getConfirmedItems(),
    ]);

    const pending = safeJsonParse<any>(pendingRaw, { items: [] });
    const triggers = safeJsonParse<any[]>(triggersRaw, []);
    const summaries = safeJsonParse<Record<string, any>>(summariesRaw, {});

    const summaryList = Object.values(summaries && typeof summaries === 'object' ? summaries : {})
      .filter((s: any) => s && typeof s === 'object' && typeof s.dayIso === 'string')
      .sort((a: any, b: any) => a.dayIso.localeCompare(b.dayIso));

    const now = new Date();
    const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });
    const clearDays = summaryList.filter((s: any) => s.score === 0).length;

    const userPrompt = `Monthly review for ${monthLabel}.

DAILY SUMMARIES (last 30 days):
${JSON.stringify(summaryList, null, 2)}

CURRENT PENDING INVESTIGATION:
${JSON.stringify(pending, null, 2)}

CURRENT SUSPECT LIST:
${JSON.stringify(triggers, null, 2)}

CONFIRMED ITEMS:
${JSON.stringify(confirmedItems, null, 2)}

Clear days this period: ${clearDays}`;

    const data = await postAi('monthly', userPrompt);

    const rawText = extractClaudeText(data);

    let parsed: any;
    try {
      parsed = JSON.parse(stripJsonFences(rawText));
    } catch {
      return null;
    }

    if (typeof parsed.summary !== 'string') return null;
    if (typeof parsed.topPattern !== 'string') return null;
    if (!Array.isArray(parsed.newlyConfirmed)) return null;
    if (!Array.isArray(parsed.removed)) return null;
    if (!Array.isArray(parsed.protectiveFactors)) return null;
    if (typeof parsed.worstTrigger !== 'string') return null;
    if (typeof parsed.monthLabel !== 'string') return null;
    parsed.clearDays = typeof parsed.clearDays === 'number' && Number.isFinite(parsed.clearDays) ? parsed.clearDays : clearDays;

    if (pending && typeof pending === 'object' && Array.isArray(pending.items)) {
      const removedSet = new Set(stringArray(parsed.removed).map((x) => x.trim().toLowerCase()).filter(Boolean));
      pending.items = pending.items.filter((item: any) => {
        if (!item || typeof item !== 'object') return false;
        const label = typeof item.label === 'string' ? item.label.trim().toLowerCase() : '';
        const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? item.confidence : 0;
        const occurrences = typeof item.occurrences === 'number' && Number.isFinite(item.occurrences) ? item.occurrences : 0;
        const safeThreshold = typeof item.safeThreshold === 'string' ? item.safeThreshold.trim() : '';
        const testedSafe = item.testedSafe === true;
        const canRemove =
          confidence < 0.1 &&
          occurrences <= 1 &&
          !safeThreshold &&
          !testedSafe &&
          label &&
          removedSet.has(label);
        return !canRemove;
      });
      pending.updatedAtTs = Date.now();
      await AsyncStorage.setItem(PENDING_INVESTIGATION_KEY, JSON.stringify(pending));
    }

    const cacheRaw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
    const cache = safeJsonParse<Record<string, unknown>>(cacheRaw, {});
    if (cache && typeof cache === 'object' && !Array.isArray(cache)) {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      const trimmedCache = Object.fromEntries(Object.entries(cache).filter(([dateIso]) => dateIso >= cutoffIso));
      await AsyncStorage.setItem(DAILY_REPORT_CACHE_KEY, JSON.stringify(trimmedCache));
    }

    const review: MonthlyReviewReport = {
      generatedAtTs: Date.now(),
      summary: parsed.summary,
      topPattern: parsed.topPattern,
      newlyConfirmed: stringArray(parsed.newlyConfirmed),
      removed: stringArray(parsed.removed),
      protectiveFactors: stringArray(parsed.protectiveFactors),
      clearDays,
      worstTrigger: parsed.worstTrigger ?? '—',
      monthLabel,
    };

    if (parsed.protectiveFactors?.length) {
      await persistProtectiveFactors(
        stringArray(parsed.protectiveFactors),
        monthLabel
      );
    }

    await Promise.all([
      AsyncStorage.setItem(MONTHLY_REVIEW_KEY, JSON.stringify(review)),
      AsyncStorage.setItem(LAST_MONTHLY_RUN_KEY, String(Date.now())),
    ]);

    return review;
  } catch {
    return null;
  }
}

export async function getLastMonthlyReview(): Promise<MonthlyReviewReport | null> {
  try {
    const raw = await AsyncStorage.getItem(MONTHLY_REVIEW_KEY);
    const parsed = safeJsonParse<any>(raw, null);
    return coerceReview(parsed);
  } catch {
    return null;
  }
}
