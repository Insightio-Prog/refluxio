import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LogItem } from '@/hooks/use-log-store';

export const PENDING_POSITION_CHECK_STORAGE_KEY = 'heartburn.pendingPositionCheck.v1';

const listeners = new Set<() => void>();

export function subscribePendingPositionCheck(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyPendingPositionCheckListeners(): void {
  for (const listener of listeners) listener();
}

export type PendingPositionCheck = {
  mealId: string;
  mealName: string;
  loggedTs: number;
};

/** After a meal log is persisted, queue a home-screen body-position prompt (non-critical). */
export async function writePendingPositionCheckAfterMealLog(item: LogItem): Promise<void> {
  if (item.type !== 'meal') return;
  try {
    const payload: PendingPositionCheck = {
      mealId: String(item.id),
      mealName: item.key.trim(),
      loggedTs: item.createdAt,
    };
    await AsyncStorage.setItem(PENDING_POSITION_CHECK_STORAGE_KEY, JSON.stringify(payload));
    notifyPendingPositionCheckListeners();
  } catch {
    // ignore
  }
}
