import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DailyAiReportData } from '@/components/DailyAiReport';
import { runMonthlyReview, shouldRunMonthlyReview } from '@/services/monthly-agent';
import { getYesterdayISO } from '@/utils/date-utils';
import type { AiContext } from '@/utils/prepare-ai-context';
import { z } from 'zod';

// Demo API (Cloudflare Worker). It holds the model, the system prompts and the
// rate limits; the app only says which report it wants and sends the user's data.
const AI_PROXY_URL =
  (typeof process.env.EXPO_PUBLIC_AI_PROXY_URL === 'string' && process.env.EXPO_PUBLIC_AI_PROXY_URL.trim()) ||
  'https://refluxio-demo-api.insightio.co.uk';

export type AiKind = 'daily' | 'monthly';

type AnthropicMessagesResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

function parseApiErrorJson(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const parsed = body as { error?: { message?: string }; message?: string };
  return parsed?.error?.message ?? parsed?.message ?? fallback;
}

function normalizeAnthropicResponse(body: unknown): AnthropicMessagesResponse {
  if (!body || typeof body !== 'object') {
    return { content: [] };
  }
  const obj = body as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    const msg = (obj.error as { message?: string }).message;
    throw new Error(typeof msg === 'string' ? msg : 'API error');
  }
  if (Array.isArray(obj.content)) {
    return obj as AnthropicMessagesResponse;
  }
  if (
    obj.payload &&
    typeof obj.payload === 'object' &&
    Array.isArray((obj.payload as AnthropicMessagesResponse).content)
  ) {
    return obj.payload as AnthropicMessagesResponse;
  }
  return { content: [] };
}

/** POST to the demo Worker; the API key and system prompts stay on the server. */
export async function postAi(kind: AiKind, user: string): Promise<AnthropicMessagesResponse> {
  const requestBody = { kind, user };
  // IMPORTANT: Without a timeout, a network stall can leave the UI “stuck generating”.
  const controller = new AbortController();
  const timeoutMs = 60_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s. Check your connection or AI proxy URL.`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!response.ok) {
    let message = 'API error';
    try {
      message = parseApiErrorJson(await response.json(), message);
    } catch {
      // keep fallback
    }
    throw Object.assign(new Error(`${message} (HTTP ${response.status})`), { status: response.status });
  }

  const data: unknown = await response.json();
  return normalizeAnthropicResponse(data);
}

export function extractClaudeText(result: AnthropicMessagesResponse): string {
  if (!Array.isArray(result.content)) return '';
  return result.content
    .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .join('');
}

const PotentialTriggerSchema = z.object({
  id: z.string(),
  label: z.string(),
  strikeCount: z.number().finite().nonnegative(),
  status: z.string().optional(),
  lastSeenTs: z.number().finite().optional(),
  lastReason: z.string().optional(),
});

const PendingInvestigationItemV1Schema = z.object({
  id: z.string(),
  label: z.string(),
  occurrences: z.number().finite().nonnegative().int(),
  confidence: z.number().finite().min(0).max(1),
  needMoreInfo: z.boolean().optional(),
  question: z.string().optional(),
  safeThreshold: z.string().optional(),
  testedSafe: z.boolean().optional(),
});

const OpenQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  relatedItemId: z.string().optional(),
  askedAtTs: z.number().finite(),
  answered: z.boolean(),
  answeredAtTs: z.number().finite().optional(),
  expiresAtTs: z.number().finite(),
});

const PendingInvestigationV1Schema = z.object({
  schemaVersion: z.literal(1),
  updatedAtTs: z.number().finite(),
  items: z.array(PendingInvestigationItemV1Schema),
  openQuestions: z.array(OpenQuestionSchema).optional(),
});

const ConfirmedItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  verdict: z.enum(['confirmed-trigger', 'confirmed-safe']),
  confirmedAtTs: z.number().finite(),
  reason: z.string(),
  safeThreshold: z.string().optional(),
  occurrences: z.number().finite().optional(),
});

const DetectiveDaySummarySchema = z.object({
  dayIso: z.string(),
  topIngredient: z.string(),
  caseNotes: z.array(z.string()),
  tip: z.string().optional(),
  score: z.number().int().min(0).max(3),
});

const PromoteRecommendationSchema = z.object({
  id: z.string(),
  label: z.string(),
  reason: z.string(),
  occurrences: z.number().finite().optional(),
  confidence: z.number().finite().optional(),
});

const TriggerUpdateSchema = z.object({
  id: z.string(),
  newStatus: z.string(),
  reason: z.string(),
});

const AiDailyReportResponseSchema = z.object({
  summary: z.string(),
  detectiveLog: z.array(z.string()).default([]),
  strategy: z.array(z.string()).default([]),
  triggerUpdates: z.array(TriggerUpdateSchema).default([]),
  pendingInvestigation: PendingInvestigationV1Schema.optional(),
  promoteRecommendations: z.array(PromoteRecommendationSchema).optional(),
  needMoreInfo: z.object({ question: z.string() }).optional(),
  dailyRiskGuide: z.record(z.string(), z.number().int().min(0).max(10)).optional(),
  detectiveDaySummary: DetectiveDaySummarySchema.optional(),
});

export type TriggerUpdate = z.infer<typeof TriggerUpdateSchema>;
type PotentialTrigger = z.infer<typeof PotentialTriggerSchema>;
export type PendingInvestigationItemV1 = z.infer<typeof PendingInvestigationItemV1Schema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type PendingInvestigationV1 = z.infer<typeof PendingInvestigationV1Schema>;
export type ConfirmedItem = z.infer<typeof ConfirmedItemSchema>;
export type DetectiveDaySummary = z.infer<typeof DetectiveDaySummarySchema>;
export type PromoteRecommendation = z.infer<typeof PromoteRecommendationSchema>;
export type AiDailyReportResponse = z.infer<typeof AiDailyReportResponseSchema>;

const HAS_COMPLETED_ONBOARDING_STORAGE_KEY = 'heartburn.hasCompletedOnboarding.v1';
const POTENTIAL_TRIGGERS_STORAGE_KEY = 'heartburn.potentialTriggers.v1';
const PENDING_INVESTIGATION_STORAGE_KEY = 'heartburn.pendingInvestigation.v1';
const DAILY_REPORT_CACHE_KEY = 'heartburn.dailyReportCache.v1';
const DETECTIVE_SUMMARIES_STORAGE_KEY = 'heartburn.detectiveSummaries.v1';
const CONFIRMED_ITEMS_STORAGE_KEY = 'heartburn.confirmedItems.v1';

export class AIOverwhelmedError extends Error {
  readonly kind = 'ai_overwhelmed' as const;
  constructor(message = "The Detective's office is currently overwhelmed. Please try again in a few minutes.") {
    super(message);
    this.name = 'AIOverwhelmedError';
  }
}

// Keep this exported so existing catch blocks still work
export class GeminiOverwhelmedError extends AIOverwhelmedError {}

function startOfLocalDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isOverloaded(error: unknown) {
  const msg = String((error as any)?.message ?? error ?? '');
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  if (status === 503 || status === 529) return true;
  if (/\b503\b/.test(msg) || /\b529\b/.test(msg)) return true;
  if (msg.toLowerCase().includes('overloaded') || msg.toLowerCase().includes('service unavailable')) return true;
  return false;
}

async function getCachedDailyReport(dayIso: string): Promise<DailyAiReportData | null> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    const candidate = parsed?.[dayIso];
    if (!candidate || typeof candidate !== 'object') return null;
    if (typeof candidate.headline !== 'string' || typeof candidate.body !== 'string') return null;
    const strategy = Array.isArray(candidate.strategy) ? candidate.strategy.filter((x: any) => typeof x === 'string') : [];
    const detectiveLog = Array.isArray(candidate.detectiveLog) ? candidate.detectiveLog.filter((x: any) => typeof x === 'string') : undefined;
    return { ...candidate, headline: candidate.headline, body: candidate.body, strategy, detectiveLog } satisfies DailyAiReportData;
  } catch {
    return null;
  }
}

async function setCachedDailyReport(dayIso: string, report: DailyAiReportData) {
  try {
    const raw = await AsyncStorage.getItem(DAILY_REPORT_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as any) : {};
    const next = { ...(parsed && typeof parsed === 'object' ? parsed : {}), [dayIso]: report };
    await AsyncStorage.setItem(DAILY_REPORT_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore cache failures
  }
}

async function getDetectiveSummaries(): Promise<Record<string, DetectiveDaySummary>> {
  try {
    const raw = await AsyncStorage.getItem(DETECTIVE_SUMMARIES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        const result = DetectiveDaySummarySchema.safeParse(value);
        return result.success ? [[key, result.data]] : [];
      })
    );
  } catch {
    return {};
  }
}

async function setDetectiveSummary(summary: DetectiveDaySummary): Promise<void> {
  try {
    const current = await getDetectiveSummaries();
    const merged = { ...current, [summary.dayIso]: summary };
    const entries = Object.entries(merged)
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .slice(0, 35);
    await AsyncStorage.setItem(DETECTIVE_SUMMARIES_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore persistence failures
  }
}

export async function getConfirmedItems(): Promise<ConfirmedItem[]> {
  try {
    const raw = await AsyncStorage.getItem(CONFIRMED_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x) => {
      const result = ConfirmedItemSchema.safeParse(x);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export async function addConfirmedItem(item: ConfirmedItem): Promise<void> {
  try {
    const current = await getConfirmedItems();
    const index = current.findIndex((x) => x.id === item.id);
    const next = current.slice();
    if (index >= 0) {
      next[index] = item;
    } else {
      next.push(item);
    }
    await AsyncStorage.setItem(CONFIRMED_ITEMS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore persistence failures
  }
}

/**
 * Testing helper: removes onboarding flag, potential triggers, pending investigation, and daily report cache.
 * Next report open fetches fresh; you may be treated as not onboarded until you complete onboarding again.
 */
export async function clearDailyReportCache(): Promise<void> {
  await AsyncStorage.multiRemove([
    HAS_COMPLETED_ONBOARDING_STORAGE_KEY,
    POTENTIAL_TRIGGERS_STORAGE_KEY,
    PENDING_INVESTIGATION_STORAGE_KEY,
    DAILY_REPORT_CACHE_KEY,
  ]);
}

async function getPotentialTriggersSnapshot(): Promise<PotentialTrigger[]> {
  try {
    const raw = await AsyncStorage.getItem(POTENTIAL_TRIGGERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x) => {
      const result = PotentialTriggerSchema.safeParse(x);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

function coercePendingInvestigation(raw: any): PendingInvestigationV1 {
  const now = Date.now();
  const schemaVersion = 1 as const;
  const updatedAtTs =
    typeof raw?.updatedAtTs === 'number' && Number.isFinite(raw.updatedAtTs) ? raw.updatedAtTs : now;
  const itemsRaw = Array.isArray(raw?.items) ? raw.items : [];
  const items: PendingInvestigationItemV1[] = itemsRaw
    .map((x: any) => {
      if (!x || typeof x !== 'object') return null;
      const id = typeof x.id === 'string' ? x.id : null;
      const label = typeof x.label === 'string' ? x.label : null;
      if (!id || !label) return null;
      const occurrences =
        typeof x.occurrences === 'number' && Number.isFinite(x.occurrences) ? Math.max(0, Math.round(x.occurrences)) : 0;
      const confidence =
        typeof x.confidence === 'number' && Number.isFinite(x.confidence) ? Math.max(0, Math.min(1, x.confidence)) : 0;
      const needMoreInfo = typeof x.needMoreInfo === 'boolean' ? x.needMoreInfo : undefined;
      const question = typeof x.question === 'string' ? x.question : undefined;
      const safeThreshold = typeof x.safeThreshold === 'string' ? x.safeThreshold.trim() : undefined;
      const testedSafe = typeof x.testedSafe === 'boolean' ? x.testedSafe : undefined;
      return {
        id,
        label,
        occurrences,
        confidence,
        ...(needMoreInfo !== undefined ? { needMoreInfo } : {}),
        ...(question ? { question } : {}),
        ...(safeThreshold ? { safeThreshold } : {}),
        ...(testedSafe !== undefined ? { testedSafe } : {}),
      } satisfies PendingInvestigationItemV1;
    })
    .filter(Boolean) as PendingInvestigationItemV1[];

  const openQuestionsRaw = Array.isArray(raw?.openQuestions) ? raw.openQuestions : [];
  const answeredCleanupCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const openQuestions: OpenQuestion[] = openQuestionsRaw
    .map((x: any) => {
      if (!x || typeof x !== 'object') return null;
      const id = typeof x.id === 'string' ? x.id : null;
      const question = typeof x.question === 'string' ? x.question : null;
      const askedAtTs = typeof x.askedAtTs === 'number' && Number.isFinite(x.askedAtTs) ? x.askedAtTs : null;
      const answered = typeof x.answered === 'boolean' ? x.answered : null;
      const expiresAtTs = typeof x.expiresAtTs === 'number' && Number.isFinite(x.expiresAtTs) ? x.expiresAtTs : null;
      if (!id || !question || askedAtTs === null || answered === null || expiresAtTs === null) return null;
      if (expiresAtTs < now) return null;
      const relatedItemId = typeof x.relatedItemId === 'string' ? x.relatedItemId : undefined;
      const answeredAtTs =
        typeof x.answeredAtTs === 'number' && Number.isFinite(x.answeredAtTs) ? x.answeredAtTs : undefined;
      if (answered && answeredAtTs !== undefined && answeredAtTs < answeredCleanupCutoff) return null;
      return {
        id,
        question,
        ...(relatedItemId !== undefined ? { relatedItemId } : {}),
        askedAtTs,
        answered,
        ...(answeredAtTs !== undefined ? { answeredAtTs } : {}),
        expiresAtTs,
      } satisfies OpenQuestion;
    })
    .filter(Boolean) as OpenQuestion[];

  return {
    schemaVersion,
    updatedAtTs,
    items,
    ...(openQuestions.length ? { openQuestions } : {}),
  };
}

async function getPendingInvestigationSnapshot(): Promise<PendingInvestigationV1> {
  const empty: PendingInvestigationV1 = { schemaVersion: 1, updatedAtTs: Date.now(), items: [] };
  try {
    const raw = await AsyncStorage.getItem(PENDING_INVESTIGATION_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as unknown;
    const result = PendingInvestigationV1Schema.safeParse(parsed);
    return result.success ? result.data : coercePendingInvestigation(parsed);
  } catch {
    return empty;
  }
}

async function setPendingInvestigation(next: PendingInvestigationV1) {
  try {
    await AsyncStorage.setItem(PENDING_INVESTIGATION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore persistence failures
  }
}

async function applyTriggerUpdatesToMemory(updates: TriggerUpdate[], nowTs: number) {
  if (!updates || updates.length === 0) return;
  const current = await getPotentialTriggersSnapshot();
  const map = new Map(current.map((t) => [t.id, t]));

  for (const u of updates) {
    const existing = map.get(u.id);
    if (existing) {
      map.set(u.id, {
        ...existing,
        strikeCount: Math.max(0, (existing.strikeCount ?? 0) + 1),
        status: u.newStatus,
        lastSeenTs: nowTs,
        lastReason: u.reason,
      });
    } else {
      map.set(u.id, {
        id: u.id,
        label: u.id,
        strikeCount: 1,
        status: u.newStatus,
        lastSeenTs: nowTs,
        lastReason: u.reason,
      });
    }
  }

  const next = Array.from(map.values()).sort((a, b) => (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0));
  await AsyncStorage.setItem(POTENTIAL_TRIGGERS_STORAGE_KEY, JSON.stringify(next));
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Strip markdown code fences if present (Claude sometimes adds these)
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to salvage first {...} block
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const maybe = stripped.slice(start, end + 1);
      return JSON.parse(maybe);
    }
    throw new Error('AI response was not valid JSON');
  }
}

function coerceResponse(raw: unknown): AiDailyReportResponse {
  const result = AiDailyReportResponseSchema.safeParse(raw);
  if (result.success) return result.data;

  // Fallback: lenient extraction for partial/malformed responses
  if (!raw || typeof raw !== 'object') throw new Error('AI response missing object');
  const r = raw as Record<string, unknown>;
  if (typeof r.summary !== 'string') throw new Error('AI response missing summary');

  return {
    summary: r.summary,
    detectiveLog: Array.isArray(r.detectiveLog)
      ? r.detectiveLog.filter((x): x is string => typeof x === 'string')
      : [],
    strategy: Array.isArray(r.strategy)
      ? r.strategy.filter((x): x is string => typeof x === 'string')
      : [],
    triggerUpdates: Array.isArray(r.triggerUpdates)
      ? r.triggerUpdates.flatMap((x) => {
          const res = TriggerUpdateSchema.safeParse(x);
          return res.success ? [res.data] : [];
        })
      : [],
    pendingInvestigation: r.pendingInvestigation
      ? coercePendingInvestigation(r.pendingInvestigation)
      : undefined,
    promoteRecommendations: Array.isArray(r.promoteRecommendations)
      ? r.promoteRecommendations.flatMap((x) => {
          const res = PromoteRecommendationSchema.safeParse(x);
          return res.success ? [res.data] : [];
        })
      : undefined,
    needMoreInfo:
      r.needMoreInfo && typeof (r.needMoreInfo as any).question === 'string'
        ? { question: (r.needMoreInfo as any).question }
        : undefined,
    dailyRiskGuide:
      r.dailyRiskGuide && typeof r.dailyRiskGuide === 'object' && !Array.isArray(r.dailyRiskGuide)
        ? Object.fromEntries(
            Object.entries(r.dailyRiskGuide as Record<string, unknown>).flatMap(([k, v]) => {
              const n =
                typeof v === 'number' && Number.isFinite(v)
                  ? Math.max(0, Math.min(10, Math.round(v)))
                  : null;
              return k && n !== null ? [[k.trim(), n]] : [];
            })
          )
        : undefined,
    detectiveDaySummary: r.detectiveDaySummary
      ? (() => {
          const res = DetectiveDaySummarySchema.safeParse(r.detectiveDaySummary);
          return res.success ? res.data : undefined;
        })()
      : undefined,
  };
}

function toDailyAiReportData(resp: AiDailyReportResponse): DailyAiReportData {
  const triggerLines =
    resp.triggerUpdates?.length > 0
      ? resp.triggerUpdates.map((u) => `🧷 Trigger update: ${u.id} → ${u.newStatus} (${u.reason})`)
      : [];
  return {
    headline: 'The Gut Check',
    body: resp.summary.trim(),
    detectiveLog: [...(resp.detectiveLog ?? []), ...triggerLines],
    strategy: resp.strategy ?? [],
  };
}

async function getOnboardingNote(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem('heartburn.onboardingNote.v1');
    if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

function buildDailyReportUserDataPayload(
  suspectList: PotentialTrigger[],
  pendingInvestigation: PendingInvestigationV1,
  yesterdayContext: AiContext,
  onboardingNote?: string | null
): string {
  const briefingPrefix = onboardingNote
    ? `PATIENT BRIEFING (written by the user at onboarding — treat as permanent background context):\n${onboardingNote}\n\n`
    : '';
  return `${briefingPrefix}Suspect List (potentialTriggers):\n${JSON.stringify(
    suspectList
  )}\n\nPending Investigation JSON (primary cold-case memory):\n${JSON.stringify(
    pendingInvestigation
  )}\n\nYesterday Context JSON (ONLY yesterday):\n${JSON.stringify(yesterdayContext)}`;
}

async function buildPrompt(
  suspectList: PotentialTrigger[],
  pendingInvestigation: PendingInvestigationV1,
  yesterdayContext: AiContext
): Promise<{ userDataPayload: string }> {
  const onboardingNote = await getOnboardingNote();
  return {
    userDataPayload: buildDailyReportUserDataPayload(
      suspectList,
      pendingInvestigation,
      yesterdayContext,
      onboardingNote
    ),
  };
}

function buildYesterdayContext(context: AiContext, targetStart: number, targetEnd: number): AiContext {
  return {
    schemaVersion: context.schemaVersion,
    generatedAtTs: context.generatedAtTs,
    lookbackDays: 1,
    symptomLookbackHours: context.symptomLookbackHours,
    days: (context.days ?? [])
      .filter((d) => typeof d?.dayStartTs === 'number' && d.dayStartTs >= targetStart && d.dayStartTs < targetEnd)
      .map((d) => ({
        ...d,
        intake: (d.intake ?? []).filter((x) => x.ts >= targetStart && x.ts < targetEnd),
        symptoms: (d.symptoms ?? []).filter((x) => x.ts >= targetStart && x.ts < targetEnd),
      })),
    links: (context.links ?? [])
      .filter((x) => x.ts >= targetStart && x.ts < targetEnd)
      .map((l) => ({
        ...l,
        precedingIntake: (l.precedingIntake ?? []).filter((i: any) => i.ts >= targetStart && i.ts < targetEnd),
      })),
    notes: (context.notes ?? []).filter((n) => n.ts >= targetStart && n.ts < targetEnd),
    environment: (context.environment ?? []).filter((e) => e.ts >= targetStart && e.ts < targetEnd),
    ...(context.pollen ? { pollen: context.pollen } : {}),
  };
}

async function finalizeReport(coerced: AiDailyReportResponse, dayIso: string, nowTs: number): Promise<DailyAiReportData> {
  await applyTriggerUpdatesToMemory(coerced.triggerUpdates ?? [], nowTs);
  if (coerced.pendingInvestigation) {
    await setPendingInvestigation({ ...coerced.pendingInvestigation, updatedAtTs: nowTs });
  }
  if (coerced.detectiveDaySummary) {
    await setDetectiveSummary(coerced.detectiveDaySummary);
  }
  if (coerced.promoteRecommendations?.length) {
    for (const rec of coerced.promoteRecommendations) {
      const verdict = rec.reason?.toLowerCase().includes('safe')
        ? 'confirmed-safe' as const
        : 'confirmed-trigger' as const;
      await addConfirmedItem({
        id: rec.id,
        label: rec.label,
        verdict,
        confirmedAtTs: nowTs,
        reason: rec.reason,
        ...(rec.occurrences !== undefined ? { occurrences: rec.occurrences } : {}),
      });
    }
  }

  const finalReport = toDailyAiReportData(coerced);
  const reportWithActions: any = {
    ...finalReport,
    ...(coerced.promoteRecommendations ? { promoteRecommendations: coerced.promoteRecommendations } : {}),
    ...(coerced.needMoreInfo?.question ? { needMoreInfo: { question: coerced.needMoreInfo.question } } : {}),
    ...(coerced.dailyRiskGuide ? { dailyRiskGuide: coerced.dailyRiskGuide } : {}),
  };

  await setCachedDailyReport(dayIso, reportWithActions);
  // Trigger monthly review if due — runs after daily report is saved
  // so a failure here never blocks the daily report returning
  try {
    const monthlyDue = await shouldRunMonthlyReview();
    if (monthlyDue) {
      // Run in background — don't await so it doesn't delay the
      // daily report returning to the UI
      runMonthlyReview().catch(() => {});
    }
  } catch {
    // never block daily report on monthly agent errors
  }
  return reportWithActions as DailyAiReportData;
}

/**
 * Non-streaming report generation.
 */
export async function generateDailyReport(context: AiContext): Promise<DailyAiReportData> {
  const nowTs = typeof context?.generatedAtTs === 'number' ? context.generatedAtTs : Date.now();
  const dayIso = getYesterdayISO(nowTs);

  const cached = await getCachedDailyReport(dayIso);
  if (cached) {
    console.log('Daily report cache hit:', dayIso);
    return cached;
  }

  const todayStart = startOfLocalDay(nowTs);
  const targetStart = todayStart - 24 * 60 * 60 * 1000;
  const targetEnd = todayStart;

  const yesterdayContext = buildYesterdayContext(context, targetStart, targetEnd);
  const suspectList = await getPotentialTriggersSnapshot();
  const pendingInvestigation = await getPendingInvestigationSnapshot();
  const { userDataPayload } = await buildPrompt(
    suspectList,
    pendingInvestigation,
    yesterdayContext
  );

  let rawText = '';
  try {
    const result = await postAi('daily', userDataPayload);
    rawText = extractClaudeText(result);
  } catch (error) {
    if (isOverloaded(error)) throw new AIOverwhelmedError();
    throw error;
  }

  const raw = extractJsonObject(rawText);
  const coerced = coerceResponse(raw);
  return finalizeReport(coerced, dayIso, nowTs);
}

/**
 * Report generation with a callback when the summary is ready (non-streaming JSON from proxy).
 */
export async function generateDailyReportStreaming(
  context: AiContext,
  onSummaryText: (text: string) => void
): Promise<DailyAiReportData> {
  const nowTs = typeof context?.generatedAtTs === 'number' ? context.generatedAtTs : Date.now();
  const dayIso = getYesterdayISO(nowTs);

  const cached = await getCachedDailyReport(dayIso);
  if (cached) return cached;

  const todayStart = startOfLocalDay(nowTs);
  const targetStart = todayStart - 24 * 60 * 60 * 1000;
  const targetEnd = todayStart;

  const yesterdayContext = buildYesterdayContext(context, targetStart, targetEnd);
  const suspectList = await getPotentialTriggersSnapshot();
  const pendingInvestigation = await getPendingInvestigationSnapshot();
  const { userDataPayload } = await buildPrompt(
    suspectList,
    pendingInvestigation,
    yesterdayContext
  );

  let rawText = '';
  try {
    const result = await postAi('daily', userDataPayload);
    rawText = extractClaudeText(result);
  } catch (error) {
    if (isOverloaded(error)) throw new AIOverwhelmedError();
    throw error;
  }

  const raw = extractJsonObject(rawText);
  const coerced = coerceResponse(raw);
  onSummaryText(coerced.summary || rawText);
  return finalizeReport(coerced, dayIso, nowTs);
}