import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

const POLLEN_SNAPSHOT_KEY = 'heartburn.pollenSnapshot.v1';
const POLLEN_HISTORY_KEY = 'heartburn.pollenHistory.v1';
const POLLEN_HISTORY_MAX_ENTRIES = 60;
const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const REFETCH_DISTANCE_KM = 1;

// Optional pollen endpoint (a proxy to a pollen forecast API). When it is not
// configured, or when running as the web demo, the app uses believable
// illustrative pollen levels instead, so the Environment views still work.
const PROXY_API_URL = process.env.EXPO_PUBLIC_POLLEN_URL?.trim() ?? '';
const USE_DEMO_POLLEN = Platform.OS === 'web' || PROXY_API_URL === '';
const DEMO_LOCATION = { lat: 53.319, lng: -3.49 };

export type PollenLevel = 'none' | 'low' | 'moderate' | 'high' | 'very_high';

export type PollenSnapshot = {
  fetchedAtTs: number;
  lat: number;
  lng: number;
  tree: PollenLevel;
  grass: PollenLevel;
  weed: PollenLevel;
  dominantPollen: string;
};

export type PollenHistoryEntry = {
  dayIso: string;
  tree: PollenLevel;
  grass: PollenLevel;
  weed: PollenLevel;
  dominantPollen: string;
};

const POLLEN_LEVELS: PollenLevel[] = ['none', 'low', 'moderate', 'high', 'very_high'];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function indexToPollenLevel(value: unknown): PollenLevel {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'none';
  if (value === 1) return 'low';
  if (value === 2) return 'moderate';
  if (value === 3) return 'high';
  return 'very_high';
}

function isPollenLevel(value: unknown): value is PollenLevel {
  return typeof value === 'string' && POLLEN_LEVELS.includes(value as PollenLevel);
}

function localDayIso(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseHistoryEntry(raw: unknown): PollenHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const dayIso = o.dayIso;
  const dominantPollen = o.dominantPollen;
  if (typeof dayIso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) return null;
  if (!isPollenLevel(o.tree) || !isPollenLevel(o.grass) || !isPollenLevel(o.weed)) return null;
  if (typeof dominantPollen !== 'string' || !dominantPollen.trim()) return null;
  return {
    dayIso,
    tree: o.tree,
    grass: o.grass,
    weed: o.weed,
    dominantPollen: dominantPollen.trim(),
  };
}

function parseSnapshot(raw: unknown): PollenSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const fetchedAtTs = o.fetchedAtTs;
  const lat = o.lat;
  const lng = o.lng;
  const dominantPollen = o.dominantPollen;
  if (typeof fetchedAtTs !== 'number' || !Number.isFinite(fetchedAtTs)) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  if (!isPollenLevel(o.tree) || !isPollenLevel(o.grass) || !isPollenLevel(o.weed)) return null;
  if (typeof dominantPollen !== 'string' || !dominantPollen.trim()) return null;
  return {
    fetchedAtTs,
    lat,
    lng,
    tree: o.tree,
    grass: o.grass,
    weed: o.weed,
    dominantPollen: dominantPollen.trim(),
  };
}

function levelFromPollenTypeInfo(
  pollenTypeInfo: unknown,
  code: 'TREE' | 'GRASS' | 'WEED'
): PollenLevel {
  if (!Array.isArray(pollenTypeInfo)) return 'none';
  for (const entry of pollenTypeInfo) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (item.code !== code) continue;
    const indexInfo = item.indexInfo;
    if (!indexInfo || typeof indexInfo !== 'object') return 'none';
    return indexToPollenLevel((indexInfo as Record<string, unknown>).value);
  }
  return 'none';
}

function dominantPollenFromDay(day: Record<string, unknown>): string {
  let bestName = '';
  let bestIndex = -1;

  const plantInfo = day.plantInfo;
  if (Array.isArray(plantInfo)) {
    for (const plant of plantInfo) {
      if (!plant || typeof plant !== 'object') continue;
      const p = plant as Record<string, unknown>;
      const indexInfo = p.indexInfo;
      const value =
        indexInfo && typeof indexInfo === 'object'
          ? (indexInfo as Record<string, unknown>).value
          : undefined;
      const idx = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      const name =
        typeof p.displayName === 'string' && p.displayName.trim()
          ? p.displayName.trim()
          : '';
      if (idx > bestIndex && name) {
        bestIndex = idx;
        bestName = name;
      }
    }
  }

  if (bestName) return bestName;

  const pollenTypeInfo = day.pollenTypeInfo;
  if (Array.isArray(pollenTypeInfo)) {
    for (const entry of pollenTypeInfo) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const indexInfo = item.indexInfo;
      const value =
        indexInfo && typeof indexInfo === 'object'
          ? (indexInfo as Record<string, unknown>).value
          : undefined;
      const idx = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      const name =
        typeof item.displayName === 'string' && item.displayName.trim()
          ? item.displayName.trim()
          : '';
      if (idx > bestIndex && name) {
        bestIndex = idx;
        bestName = name;
      }
    }
  }

  return bestName || 'Pollen';
}

function parseForecastResponse(data: unknown, lat: number, lng: number): PollenSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const dailyInfo = (data as Record<string, unknown>).dailyInfo;
  if (!Array.isArray(dailyInfo) || dailyInfo.length === 0) return null;

  const day = dailyInfo[0];
  if (!day || typeof day !== 'object') return null;
  const dayObj = day as Record<string, unknown>;

  const tree = levelFromPollenTypeInfo(dayObj.pollenTypeInfo, 'TREE');
  const grass = levelFromPollenTypeInfo(dayObj.pollenTypeInfo, 'GRASS');
  const weed = levelFromPollenTypeInfo(dayObj.pollenTypeInfo, 'WEED');
  const dominantPollen = dominantPollenFromDay(dayObj);

  return {
    fetchedAtTs: Date.now(),
    lat,
    lng,
    tree,
    grass,
    weed,
    dominantPollen,
  };
}

/** Deterministic illustrative pollen for a given day (demo / no endpoint configured). */
export function demoPollenForDay(ts: number): Omit<PollenSnapshot, 'fetchedAtTs' | 'lat' | 'lng'> {
  const d = new Date(ts);
  const n = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  const levels: PollenLevel[] = ['low', 'low', 'moderate', 'moderate', 'high', 'very_high'];
  const pick = (salt: number) => levels[Math.abs(Math.floor(Math.sin(n * 12.9898 + salt) * 43758.5453)) % levels.length];
  const grass = pick(1);
  const tree = pick(2);
  const weed = pick(3);
  const rank = (l: PollenLevel) => POLLEN_LEVELS.indexOf(l);
  const top = [
    { name: 'Grass', level: grass },
    { name: 'Tree', level: tree },
    { name: 'Weed', level: weed },
  ].sort((a, b) => rank(b.level) - rank(a.level))[0];
  return { tree, grass, weed, dominantPollen: top.name };
}

export async function getCoarseLocation(): Promise<{ lat: number; lng: number } | null> {
  if (USE_DEMO_POLLEN) return DEMO_LOCATION;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function loadCachedPollen(): Promise<PollenSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(POLLEN_SNAPSHOT_KEY);
    if (!raw) return null;
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function shouldRefetchPollen(
  cached: PollenSnapshot | null,
  currentLat: number,
  currentLng: number
): Promise<boolean> {
  if (!cached) return true;
  if (Date.now() - cached.fetchedAtTs > CACHE_MAX_AGE_MS) return true;
  if (haversineKm(cached.lat, cached.lng, currentLat, currentLng) > REFETCH_DISTANCE_KM) return true;
  return false;
}

export async function fetchAndCachePollen(lat: number, lng: number): Promise<PollenSnapshot | null> {
  if (USE_DEMO_POLLEN) {
    const snapshot: PollenSnapshot = { fetchedAtTs: Date.now(), lat, lng, ...demoPollenForDay(Date.now()) };
    await AsyncStorage.setItem(POLLEN_SNAPSHOT_KEY, JSON.stringify(snapshot));
    await recordPollenHistory(snapshot);
    return snapshot;
  }
  try {
    // Fire a secure POST request to your custom Cloudflare proxy router
    const res = await fetch(PROXY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        target: 'pollen',
        location: {
          lat,
          lng,
        },
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    const snapshot = parseForecastResponse(data, lat, lng);
    if (!snapshot) return null;

    await AsyncStorage.setItem(POLLEN_SNAPSHOT_KEY, JSON.stringify(snapshot));
    await recordPollenHistory(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export async function recordPollenHistory(snapshot: PollenSnapshot): Promise<void> {
  try {
    const dayIso = localDayIso(snapshot.fetchedAtTs);
    const entry: PollenHistoryEntry = {
      dayIso,
      tree: snapshot.tree,
      grass: snapshot.grass,
      weed: snapshot.weed,
      dominantPollen: snapshot.dominantPollen,
    };

    const raw = await AsyncStorage.getItem(POLLEN_HISTORY_KEY);
    let list: PollenHistoryEntry[] = [];
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        list = parsed.map(parseHistoryEntry).filter(Boolean) as PollenHistoryEntry[];
      }
    }

    const withoutDay = list.filter((e) => e.dayIso !== dayIso);
    const next = [entry, ...withoutDay].slice(0, POLLEN_HISTORY_MAX_ENTRIES);
    await AsyncStorage.setItem(POLLEN_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // non-critical
  }
}

export async function loadPollenHistory(): Promise<PollenHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(POLLEN_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list = parsed.map(parseHistoryEntry).filter(Boolean) as PollenHistoryEntry[];
    return list.sort((a, b) => a.dayIso.localeCompare(b.dayIso));
  } catch {
    return [];
  }
}

export async function refreshPollenIfNeeded(opts?: { force?: boolean }): Promise<PollenSnapshot | null> {
  try {
    const coords = await getCoarseLocation();
    if (!coords) {
      return loadCachedPollen();
    }

    const cached = await loadCachedPollen();
    const needsFetch = opts?.force === true || (await shouldRefetchPollen(cached, coords.lat, coords.lng));

    if (needsFetch) {
      const fresh = await fetchAndCachePollen(coords.lat, coords.lng);
      if (fresh) return fresh;
    }

    return cached;
  } catch {
    return loadCachedPollen();
  }
}