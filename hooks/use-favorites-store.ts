import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type FavoriteItem = {
  id: string;
  name: string;
  type: 'food' | 'drink';
  category: 'meal' | 'snack'; // The new separator!
  usualPortion: number;
  riskLevel: 'high' | 'moderate' | 'low';
};

const STORAGE_KEY = 'heartburn.favorites.v1';
let favorites: FavoriteItem[] = [];
const listeners = new Set<(items: FavoriteItem[]) => void>();

export function useFavorites() {
  const [data, setData] = useState<FavoriteItem[]>(favorites);

  useEffect(() => {
    const load = async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        favorites = JSON.parse(raw);
        listeners.forEach(l => l(favorites));
      }
    };
    load();
    const unsub = (items: FavoriteItem[]) => setData([...items]);
    listeners.add(unsub);
    return () => { listeners.delete(unsub); };
  }, []);

  return data;
}

export async function addFavorite(
  name: string, 
  type: 'food' | 'drink', 
  category: 'meal' | 'snack', // Added category here
  portion: number, 
  risk: 'high' | 'moderate' | 'low' = 'moderate'
) {
  const newItem: FavoriteItem = { 
    id: Date.now().toString(), 
    name, 
    type, 
    category, // Saved to the item
    usualPortion: portion,
    riskLevel: risk 
  };
  
  // Keep unique names but allow the same name to move to the top
  favorites = [newItem, ...favorites.filter(f => f.name !== name)];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  listeners.forEach(l => l(favorites));
}

export async function removeFavorite(id: string) {
  favorites = favorites.filter(f => f.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  listeners.forEach(l => l(favorites));
}