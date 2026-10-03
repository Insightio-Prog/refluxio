import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { LOGO_FONT_LIGHT, LOGO_FONT_STRONG } from '@/constants/fonts';

export default function SplashScreen() {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const raw = await AsyncStorage.getItem(
          'heartburn.hasCompletedOnboarding.v1'
        );
        const completed = raw === 'true';
        if (completed) {
          router.replace('/(tabs)/home');
        } else {
          router.replace('/onboarding-triggers');
        }
      } catch {
        router.replace('/(tabs)/home');
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />
      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <Text style={styles.brand}>
            <Text style={styles.brandStrong}>Reflux</Text>
            <Text style={styles.brandLight}>io</Text>
          </Text>
          <Text style={styles.tagline}>TRACK · IDENTIFY · HEAL</Text>
        </View>
        <Text style={styles.sub}>Your personal GERD detective</Text>
      </View>
      <Text style={[styles.version, { paddingBottom: insets.bottom + 16 }]}>
        Refluxio · Beta
      </Text>

      <BottomSafeAreaShield backgroundColor="#f8fafc" />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  logoWrap: { alignItems: 'center', gap: 8 },
  brand: { fontSize: 48, letterSpacing: -1, lineHeight: 52 },
  brandStrong: { fontFamily: LOGO_FONT_STRONG, color: '#0f172a' },
  brandLight: { fontFamily: LOGO_FONT_LIGHT, color: '#2d6a4f' },
  tagline: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: 3.5,
  },
  sub: {
    fontFamily: 'Outfit',
    fontSize: 14,
    color: '#64748b',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  version: {
    fontFamily: 'Outfit',
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
});