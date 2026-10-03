import { getLogsSnapshot, type LogItem, type SymptomSeverity } from '@/hooks/use-log-store';
import { loadCachedPollen } from '@/utils/pollen-service';
import { z } from 'zod';

const AiContextIntakeEventSchema = z.object({
  id: z.string(),
  ts: z.number().finite(),
  iso: z.string(),
  type: z.enum(['food', 'drink', 'snack', 'meal', 'trigger']),
  name: z.string(),
  ingredients: z.string().optional(),
  bodyPosition: z.string().optional(),
});

const AiContextSymptomEventSchema = z.object({
  id: z.string(),
  ts: z.number().finite(),
  iso: z.string(),
  symptom: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  precedingIntake: z.array(AiContextIntakeEventSchema),
});

const AiContextUserNoteSchema = z.object({
  id: z.string(),
  ts: z.number().finite(),
  iso: z.string(),
  text: z.string(),
});

const AiContextDaySchema = z.object({
  dayStartTs: z.number().finite(),
  dayIso: z.string(),
  intake: z.array(AiContextIntakeEventSchema),
  symptoms: z.array(AiContextSymptomEventSchema.omit({ precedingIntake: true })),
});

const AiContextEnvironmentEventSchema = z.object({
  id: z.string(),
  ts: z.number().finite(),
  iso: z.string(),
  label: z.string(),
});

const AiContextPollenSchema = z.object({
  tree: z.string(),
  grass: z.string(),
  weed: z.string(),
  dominantPollen: z.string(),
});

const AiContextSchema = z.object({
  schemaVersion: z.literal(2),
  generatedAtTs: z.number().finite(),
  lookbackDays: z.number(),
  symptomLookbackHours: z.number(),
  days: z.array(AiContextDaySchema),
  links: z.array(AiContextSymptomEventSchema),
  notes: z.array(AiContextUserNoteSchema),
  environment: z.array(AiContextEnvironmentEventSchema),
  pollen: AiContextPollenSchema.optional(),
});

export type AiContextIntakeEvent = z.infer<typeof AiContextIntakeEventSchema>;
export type AiContextSymptomEvent = z.infer<typeof AiContextSymptomEventSchema>;
export type AiContextUserNote = z.infer<typeof AiContextUserNoteSchema>;
export type AiContextDay = z.infer<typeof AiContextDaySchema>;
export type AiContextEnvironmentEvent = z.infer<typeof AiContextEnvironmentEventSchema>;
export type AiContext = z.infer<typeof AiContextSchema>;

const POLLEN_CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const INTAKE_TYPES: AiContextIntakeEvent['type'][] = ['food', 'drink', 'snack', 'meal', 'trigger'];

function toIso(ts: number) {
  return new Date(ts).toISOString();
}

function startOfLocalDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function localDayIso(ts: number) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function coerceIntakeType(t: LogItem['type']): AiContextIntakeEvent['type'] | null {
  return (INTAKE_TYPES as readonly string[]).includes(t) ? (t as AiContextIntakeEvent['type']) : null;
}

/**
 * Prepare structured AI context for the last N days:
 * - groups intake and symptoms by local day
 * - links each symptom to intake in the preceding window (default 6 hours)
 */
export async function prepareAiContext(opts?: {
  lookbackDays?: number;
  symptomLookbackHours?: number;
  nowTs?: number;
  /** Shift the lookback window back by N full days (e.g. 1 = “yesterday”). */
  dayOffsetDays?: number;
}): Promise<AiContext> {
  const lookbackDays = Math.max(1, Math.min(30, opts?.lookbackDays ?? 7));
  const symptomLookbackHours = Math.max(1, Math.min(24, opts?.symptomLookbackHours ?? 6));
  const nowTs = opts?.nowTs ?? Date.now();
  const dayOffsetDays = Math.max(0, Math.min(30, opts?.dayOffsetDays ?? 0));

  const WINDOW_ANCHOR_TS = nowTs - dayOffsetDays * 24 * 60 * 60 * 1000;

  const all = await getLogsSnapshot();
  // Include the symptom lookback window so symptom->preceding intake links
  // remain complete for the earliest symptoms in the lookback range.
  const cutoffTs = WINDOW_ANCHOR_TS - lookbackDays * 24 * 60 * 60 * 1000 - symptomLookbackHours * 60 * 60 * 1000;
  const last = all.filter((l) => typeof l.createdAt === 'number' && l.createdAt >= cutoffTs);

  const intake = last
    .map((l) => {
      const intakeType = coerceIntakeType(l.type);
      if (!intakeType) return null;
      const ingredients = (l.ingredients ?? l.ingredientsDigest ?? '').trim();
      return {
        id: String(l.id),
        ts: l.createdAt,
        iso: toIso(l.createdAt),
        type: intakeType,
        name: l.key,
        ...(ingredients ? { ingredients } : {}),
        ...(typeof l.bodyPosition === 'string' && l.bodyPosition.trim()
          ? { bodyPosition: l.bodyPosition.trim() }
          : {}),
      };
    })
    .filter(Boolean) as AiContextIntakeEvent[];

  const symptoms = last
    .filter((l) => l.type === 'symptom')
    .map((l) => {
      const sev = l.symptomSeverity;
      const severity: SymptomSeverity | undefined =
        sev === 'mild' || sev === 'moderate' || sev === 'severe' ? sev : undefined;
      return {
        id: String(l.id),
        ts: l.createdAt,
        iso: toIso(l.createdAt),
        symptom: l.key,
        ...(severity ? { severity } : {}),
      };
    });

  const notes = last
    .filter((l) => l.type === 'note')
    .map((l) => ({
      id: String(l.id),
      ts: l.createdAt,
      iso: toIso(l.createdAt),
      text: l.key,
    } satisfies AiContextUserNote))
    .sort((a, b) => a.ts - b.ts);

  const environment = last
    .filter((l) => l.type === 'environment')
    .map((l) => ({
      id: String(l.id),
      ts: l.createdAt,
      iso: toIso(l.createdAt),
      label: l.key,
    } satisfies AiContextEnvironmentEvent))
    .sort((a, b) => a.ts - b.ts);

  const cachedPollen = await loadCachedPollen();
  const pollen =
    cachedPollen && nowTs - cachedPollen.fetchedAtTs < POLLEN_CONTEXT_MAX_AGE_MS
      ? {
          tree: cachedPollen.tree,
          grass: cachedPollen.grass,
          weed: cachedPollen.weed,
          dominantPollen: cachedPollen.dominantPollen,
        }
      : undefined;

  // Pre-sort intake for efficient window slicing
  const intakeSorted = intake.slice().sort((a, b) => a.ts - b.ts);

  const links: AiContextSymptomEvent[] = symptoms
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((s) => {
      const windowStart = s.ts - symptomLookbackHours * 60 * 60 * 1000;
      // intake within (windowStart, s.ts]
      const preceding = intakeSorted.filter((i) => i.ts > windowStart && i.ts <= s.ts);
      return { ...s, precedingIntake: preceding };
    });

  // Group by local day for readability
  const dayMap = new Map<number, { intake: AiContextIntakeEvent[]; symptoms: Omit<AiContextSymptomEvent, 'precedingIntake'>[] }>();

  for (const i of intake) {
    const ds = startOfLocalDay(i.ts);
    const cur = dayMap.get(ds) ?? { intake: [], symptoms: [] };
    cur.intake.push(i);
    dayMap.set(ds, cur);
  }
  for (const s of symptoms) {
    const ds = startOfLocalDay(s.ts);
    const cur = dayMap.get(ds) ?? { intake: [], symptoms: [] };
    cur.symptoms.push(s);
    dayMap.set(ds, cur);
  }

  const days: AiContextDay[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a - b)
    // Trim days to the requested lookback window (local-day aligned)
    .filter(([dayStartTs]) => dayStartTs >= startOfLocalDay(WINDOW_ANCHOR_TS - (lookbackDays - 1) * 24 * 60 * 60 * 1000))
    .map(([dayStartTs, payload]) => ({
      dayStartTs,
      dayIso: localDayIso(dayStartTs),
      intake: payload.intake.sort((a, b) => a.ts - b.ts),
      symptoms: payload.symptoms.sort((a, b) => a.ts - b.ts),
    }));

  return {
    schemaVersion: 2,
    generatedAtTs: nowTs,
    lookbackDays,
    symptomLookbackHours,
    days,
    links,
    notes,
    environment,
    ...(pollen ? { pollen } : {}),
  };
}

