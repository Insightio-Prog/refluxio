import AsyncStorage from '@react-native-async-storage/async-storage';

const FIRST_USE_KEY = 'heartburn.firstUseDate.v1';
const MOOD_LOG_KEY = 'heartburn.lastMoodCheck.v1';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MOOD_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

function isoToValidDate(raw: string): Date | null {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function getOrSetFirstUseDate(): Promise<Date> {
  const today = new Date();
  try {
    const raw = await AsyncStorage.getItem(FIRST_USE_KEY);
    if (raw) {
      const stored = isoToValidDate(raw);
      if (stored) return stored;
    }

    await AsyncStorage.setItem(FIRST_USE_KEY, today.toISOString());
    return today;
  } catch {
    return today;
  }
}

export function getDayCount(firstUseDate: Date): number {
  const firstDay = localDayNumber(firstUseDate);
  const today = localDayNumber(new Date());
  return Math.max(1, today - firstDay + 1);
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export function calculateStreak(
  dailyScores: Record<string, number>
): { streakDays: number; isOnStreak: boolean; clearDaysThisWeek: number } {
  const today = new Date();
  const dayIso = (offsetDays: number) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offsetDays);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  let streakDays = 0;
  for (let offset = 1; ; offset += 1) {
    if (dailyScores[dayIso(offset)] !== 0) break;
    streakDays += 1;
  }

  let clearDaysThisWeek = 0;
  for (let offset = 1; offset <= 7; offset += 1) {
    if (dailyScores[dayIso(offset)] === 0) clearDaysThisWeek += 1;
  }

  return {
    streakDays,
    isOnStreak: streakDays >= 1,
    clearDaysThisWeek,
  };
}

export type MoodOption =
  | 'good'
  | 'stressed'
  | 'anxious'
  | 'tired'
  | 'frustrated'
  | 'nauseous'
  | 'low';

export const MOOD_OPTIONS: {
  key: MoodOption;
  label: string;
  emoji: string;
  ionicon: string;
}[] = [
  { key: 'good', label: 'Good', emoji: '😊', ionicon: 'happy-outline' },
  { key: 'stressed', label: 'Stressed', emoji: '😓', ionicon: 'sad-outline' },
  { key: 'anxious', label: 'Anxious', emoji: '😰', ionicon: 'sad-outline' },
  { key: 'tired', label: 'Tired', emoji: '😴', ionicon: 'moon-outline' },
  { key: 'frustrated', label: 'Frustrated', emoji: '😤', ionicon: 'sad-outline' },
  { key: 'nauseous', label: 'Nauseous', emoji: '🤢', ionicon: 'medical-outline' },
  { key: 'low', label: 'Low', emoji: '😔', ionicon: 'sad-outline' },
];

export async function shouldShowMoodCheck(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(MOOD_LOG_KEY);
    if (!raw) return true;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return true;

    const lastCheckedTs = (parsed as { lastCheckedTs?: unknown }).lastCheckedTs;
    if (typeof lastCheckedTs !== 'number' || !Number.isFinite(lastCheckedTs)) return true;

    return Date.now() - lastCheckedTs > MOOD_CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

export async function saveMoodLog(
  mood: MoodOption,
  addLogFn: (key: string, type: string) => Promise<any>
): Promise<void> {
  try {
    await addLogFn(mood, 'mood');
    await AsyncStorage.setItem(
      MOOD_LOG_KEY,
      JSON.stringify({ lastCheckedTs: Date.now(), lastMood: mood })
    );
  } catch {
    // ignore mood logging failures
  }
}

export async function skipMoodCheck(): Promise<void> {
  try {
    await AsyncStorage.setItem(
      MOOD_LOG_KEY,
      JSON.stringify({ lastCheckedTs: Date.now(), lastMood: null })
    );
  } catch {}
}
