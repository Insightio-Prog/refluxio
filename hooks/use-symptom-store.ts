import AsyncStorage from '@react-native-async-storage/async-storage';

const CUSTOM_SYMPTOMS_STORAGE_KEY = 'custom-symptom-definitions';

export interface SymptomDefinition {
  id: string;
  label: string;
  icon: string;
}

const DEFAULT_SYMPTOM_DEFINITIONS: SymptomDefinition[] = [
  { id: 'jaw', label: 'Jaw Pain', icon: 'fitness-outline' },
  { id: 'nose', label: 'Runny Nose', icon: 'water-outline' },
  { id: 'throat', label: 'Throat Clear', icon: 'mic-outline' },
  { id: 'bloat', label: 'Bloating', icon: 'radio-button-on-outline' },
  { id: 'chest', label: 'Chest Pain', icon: 'heart-outline' },
  { id: 'itchy-eyes', label: 'Itchy Eyes', icon: 'eye-outline' },
  { id: 'sneezing', label: 'Sneezing', icon: 'cloudy-outline' },
];

/** Appended to custom storage for existing installs missing these built-ins. */
const MIGRATION_SYMPTOM_APPEND: SymptomDefinition[] = [
  { id: 'mig-chest', label: 'Chest Pain', icon: 'heart-outline' },
  { id: 'mig-itchy-eyes', label: 'Itchy Eyes', icon: 'eye-outline' },
  { id: 'mig-sneezing', label: 'Sneezing', icon: 'cloudy-outline' },
];

function hasLabelCaseInsensitive(defs: SymptomDefinition[], label: string): boolean {
  const key = label.trim().toLowerCase();
  return defs.some((s) => s.label.trim().toLowerCase() === key);
}

/** Appends missing migration symptoms to custom storage; idempotent by label. */
async function migrateSymptomDefinitions(custom: SymptomDefinition[]): Promise<SymptomDefinition[]> {
  const known = [...DEFAULT_SYMPTOM_DEFINITIONS, ...custom];
  const toAppend: SymptomDefinition[] = [];
  for (const mig of MIGRATION_SYMPTOM_APPEND) {
    if (!hasLabelCaseInsensitive(known, mig.label)) {
      toAppend.push(mig);
      known.push(mig);
    }
  }
  if (toAppend.length === 0) return custom;
  const updated = [...custom, ...toAppend];
  await AsyncStorage.setItem(CUSTOM_SYMPTOMS_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

async function loadCustomSymptomsFromStorage(): Promise<SymptomDefinition[]> {
  try {
    const jsonValue = await AsyncStorage.getItem(CUSTOM_SYMPTOMS_STORAGE_KEY);
    if (jsonValue == null) return [];
    const parsed = JSON.parse(jsonValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is SymptomDefinition =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as SymptomDefinition).id === 'string' &&
        typeof (x as SymptomDefinition).label === 'string' &&
        typeof (x as SymptomDefinition).icon === 'string'
    );
  } catch {
    return [];
  }
}

/** Defaults plus any user-added symptoms from AsyncStorage. */
export const getSymptomDefinitions = async (): Promise<SymptomDefinition[]> => {
  const loaded = await loadCustomSymptomsFromStorage();
  const custom = await migrateSymptomDefinitions(loaded);
  return [...DEFAULT_SYMPTOM_DEFINITIONS, ...custom];
};

export const addSymptomDefinition = async (label: string, icon: string): Promise<SymptomDefinition[]> => {
  const trimmed = label.trim();
  if (!trimmed) return getSymptomDefinitions();

  try {
    const current = await loadCustomSymptomsFromStorage();
    const newSymptom: SymptomDefinition = {
      id: `custom-${Date.now()}`,
      label: trimmed,
      icon: icon.trim() || 'pulse-outline',
    };
    const updated = [...current, newSymptom];
    await AsyncStorage.setItem(CUSTOM_SYMPTOMS_STORAGE_KEY, JSON.stringify(updated));
    return getSymptomDefinitions();
  } catch (e) {
    console.error(e);
    return getSymptomDefinitions();
  }
};

/** Removes a user-added symptom by id from AsyncStorage. Built-in defaults are unchanged. */
export const removeSymptomDefinition = async (id: string): Promise<SymptomDefinition[]> => {
  try {
    const current = await loadCustomSymptomsFromStorage();
    const updated = current.filter((s) => s.id !== id);
    await AsyncStorage.setItem(CUSTOM_SYMPTOMS_STORAGE_KEY, JSON.stringify(updated));
    return getSymptomDefinitions();
  } catch (e) {
    console.error(e);
    return getSymptomDefinitions();
  }
};
