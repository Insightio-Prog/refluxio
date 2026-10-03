import { MomoTrustDisplay_400Regular } from '@expo-google-fonts/momo-trust-display';
import { Outfit_400Regular, Outfit_700Bold, Outfit_900Black, useFonts } from '@expo-google-fonts/outfit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen'; // Added for smooth loading
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { IS_DEMO } from '@/constants/demo';
import { ensureDemoData } from '@/utils/demo-data';
import PhoneFrame from '@/components/PhoneFrame';
import { useColorScheme } from '@/hooks/use-color-scheme';



SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

const HAS_COMPLETED_ONBOARDING_KEY = 'heartburn.hasCompletedOnboarding.v1';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [initialRoute, setInitialRoute] = useState<'(tabs)' | 'onboarding-triggers'>('(tabs)');
  
  const [loaded, error] = useFonts({
    // App UI uses Momo Trust Display under the legacy Outfit* keys used in stylesheets.
    OutfitLight: MomoTrustDisplay_400Regular,
    Outfit: MomoTrustDisplay_400Regular,
    OutfitMedium: MomoTrustDisplay_400Regular,
    OutfitBold: MomoTrustDisplay_400Regular,
    OutfitBlack: MomoTrustDisplay_400Regular,
    // Refluxio logotype only — real Outfit.
    LogoOutfit: Outfit_400Regular,
    LogoOutfitBold: Outfit_700Bold,
    LogoOutfitBlack: Outfit_900Black,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HAS_COMPLETED_ONBOARDING_KEY);
const completed = raw === 'true';
        if (completed && IS_DEMO) await ensureDemoData();
        if (!cancelled) setInitialRoute(completed ? '(tabs)' : 'onboarding-triggers');
      } catch {
        if (!cancelled) setInitialRoute('onboarding-triggers');
      } finally {
        if (!cancelled) setOnboardingChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if ((loaded || error) && onboardingChecked) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error, onboardingChecked]);

  if ((!loaded && !error) || !onboardingChecked) {
    return null;
  }

  return (
    <PhoneFrame>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack initialRouteName={initialRoute}>
          <Stack.Screen name="onboarding-triggers" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false, title: 'Settings' }} />
          <Stack.Screen name="user-settings" options={{ headerShown: false }} />
          <Stack.Screen name="manage-triggers" options={{ headerShown: false }} />
          <Stack.Screen name="test-scan" options={{ headerShown: false, title: 'Test Scan' }} />
          <Stack.Screen name="manual-input" options={{ headerShown: false, title: 'Manual Input' }} />
          <Stack.Screen name="ai-insight" options={{ headerShown: false, title: 'AI Insight' }} />
          <Stack.Screen name="diary" options={{ headerShown: false, title: 'Diary' }} />
          <Stack.Screen name="heatmap" options={{ headerShown: false, title: 'Heatmap' }} />
          <Stack.Screen name="report-detail" options={{ headerShown: false, title: 'Report' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
    </PhoneFrame>
  );
}