import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

const LogTypeSchema = z.enum([
  'quick',
  'mood',
  'symptom',
  'food',
  'drink',
  'trigger',
  'snack',
  'meal',
  'note',
  'med',
  'medication',
  'environment',
]);

const SymptomSeveritySchema = z.enum(['mild', 'moderate', 'severe']);

const LogItemSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().finite().transform((n) => String(Math.trunc(n)))]),
    createdAt: z.number().finite(),
    type: LogTypeSchema,
    key: z.string().min(1).trim(),
    symptomSeverity: SymptomSeveritySchema.optional(),
    bodyPosition: z.string().trim().optional(),
    ingredients: z.string().trim().optional(),
    mealMeta: z.string().trim().optional(),
    ingredientsDigest: z.string().trim().optional(),
  })
  .passthrough();

export type LogType = z.infer<typeof LogTypeSchema>;

/** Logged from home symptom quick-log (passed to AI context). */
export type SymptomSeverity = z.infer<typeof SymptomSeveritySchema>;

export type LogItem = {
  id: string;
  createdAt: number;
  // Make sure these match the types you call in the scanner!
  type: LogType;
  key: string;
  /** When `type === 'symptom'`, optional intensity for reports / diary. */
  symptomSeverity?: SymptomSeverity;
  /** Post-meal posture label, e.g. "Seated (Slouched)" or legacy "upright". */
  bodyPosition?: string;
  /** Open Food Facts `ingredients_text` (single product or combined blocks for meals). */
  ingredients?: string;
  /** JSON array of per-line meal metadata (barcode, labels, qty, units, etc.) for AI / tools. */
  mealMeta?: string;
  /** Combined ingredient / product metadata for meal-builder logs & AI follow-up. */
  ingredientsDigest?: string;
};

const STORAGE_KEY = 'heartburnDiary.logs.v1';

let cached: LogItem[] = [];
let initialized = false;
let initPromise: Promise<void> | null = null;
const listeners = new Set<(items: LogItem[]) => void>();

function emit() {
  for (const l of listeners) l(cached);
}

function sanitizeLog(input: unknown): LogItem | null {
  // Handle legacy key field names before parsing
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (!obj.key) {
      const fallback = obj.productName ?? obj.name ?? obj.title;
      if (typeof fallback === 'string' && fallback.trim()) {
        obj.key = fallback.trim();
      }
    }
  }
  const result = LogItemSchema.safeParse(input);
  return result.success ? (result.data as LogItem) : null;
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // ignore persistence failures
  }
}

async function ensureInit() {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) cached = parsed.map(sanitizeLog).filter((x): x is LogItem => Boolean(x));
      }
    } catch {
      // ignore corrupt storage
    } finally {
      initialized = true;
      emit();
    }
  })();
  return initPromise;
}

/** Non-react snapshot for utilities (ensures storage is loaded). */
export async function getLogsSnapshot(): Promise<LogItem[]> {
  await ensureInit();
  return cached.slice();
}

export function subscribeLogs(listener: (items: LogItem[]) => void) {
  listeners.add(listener);
  listener(cached);
  return () => {
    listeners.delete(listener);
  };
}

export type AddLogExtras = Partial<
  Pick<LogItem, 'ingredients' | 'mealMeta' | 'ingredientsDigest' | 'symptomSeverity' | 'bodyPosition'>
>;

export async function addLog(key: string, type: LogType = 'food', opts?: AddLogExtras) {
  await ensureInit();
  const trimmedIngs = opts?.ingredients?.trim();
  const trimmedMeta = opts?.mealMeta?.trim();
  const trimmedDigest = opts?.ingredientsDigest?.trim();
  const sev = opts?.symptomSeverity;
  const pos = opts?.bodyPosition;
  const item: LogItem = {
    id: `${Date.now().toString()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    type,
    key: key.trim(),
    ...(trimmedIngs ? { ingredients: trimmedIngs } : {}),
    ...(trimmedMeta ? { mealMeta: trimmedMeta } : {}),
    ...(trimmedDigest ? { ingredientsDigest: trimmedDigest } : {}),
    ...(type === 'symptom' && (sev === 'mild' || sev === 'moderate' || sev === 'severe') ? { symptomSeverity: sev } : {}),
    ...(typeof pos === 'string' && pos.trim() ? { bodyPosition: pos.trim() } : {}),
  };
  cached = [item, ...cached];
  emit();
  void persist();
  return item;
}

export async function removeLog(id: string) {
  await ensureInit();
  const next = cached.filter((l) => String(l.id) !== String(id));
  if (next.length === cached.length) return false;
  cached = next;
  emit();
  void persist();
  return true;
}

/**
 * Merge partial updates onto an existing log. IDs are compared coercively as strings
 * so edits match entries that were persisted with numeric ids in older data.
 */
export async function updateLog(id: string, updates: Partial<Omit<LogItem, 'id'>>): Promise<boolean> {
  await ensureInit();
  const idStr = String(id);
  let found = false;
  cached = cached.map((l) => {
    if (String(l.id) !== idStr) return l;
    found = true;
    return { ...l, ...updates, id: l.id };
  });
  if (!found) return false;
  emit();
  void persist();
  return true;
}

export function useLogs() {
  const [logs, setLogs] = useState<LogItem[]>(cached);

  useEffect(() => {
    let alive = true;
    void ensureInit();
    const unsub = subscribeLogs((items) => {
      if (!alive) return;
      setLogs(items);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // 2. This ensures your home screen always shows the newest Bisto scan at the top
  const sortedLogs = useMemo(() => logs.slice().sort((a, b) => b.createdAt - a.createdAt), [logs]);
  return { logs, sortedLogs };
}