import AsyncStorage from '@react-native-async-storage/async-storage';

const MED_STORAGE_KEY = 'med-favorites-storage';

export interface MedFavorite {
  id: string;
  name: string;
  dosage: string;
  icon: string;
}

export const getMedFavorites = async (): Promise<MedFavorite[]> => {
  try {
    const jsonValue = await AsyncStorage.getItem(MED_STORAGE_KEY);
    return jsonValue != null ? JSON.parse(jsonValue) : [];
  } catch (e) {
    return [];
  }
};

export const addMedFavorite = async (name: string, dosage: string) => {
  try {
    const currentMeds = await getMedFavorites();
    const newMed: MedFavorite = {
      id: Date.now().toString(),
      name,
      dosage,
      icon: 'leaf'
    };
    const updatedMeds = [...currentMeds, newMed];
    await AsyncStorage.setItem(MED_STORAGE_KEY, JSON.stringify(updatedMeds));
    return updatedMeds;
  } catch (e) {
    console.error(e);
  }
};

export const removeMedFavorite = async (id: string): Promise<MedFavorite[]> => {
  try {
    const currentMeds = await getMedFavorites();
    const updatedMeds = currentMeds.filter((m) => m.id !== id);
    await AsyncStorage.setItem(MED_STORAGE_KEY, JSON.stringify(updatedMeds));
    return updatedMeds;
  } catch (e) {
    console.error(e);
    return [];
  }
};