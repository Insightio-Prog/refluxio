import AsyncStorage from '@react-native-async-storage/async-storage';

export async function resetApp() {
  await AsyncStorage.clear();
}

