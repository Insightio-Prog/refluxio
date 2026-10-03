import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { APP_RADIUS } from '@/constants/theme';

const BG = '#f1f5f9';
const ACCENT = '#BFD747';

export default function AiInsightScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ title: 'AI Insight' }} />
      <View style={styles.card}>
        <Ionicons name="sparkles-outline" size={42} color={ACCENT} />
        <Text style={styles.title}>AI Insight</Text>
        <Text style={styles.sub}>Find patterns between triggers, mood, and symptoms.</Text>
      </View>

      <BottomSafeAreaShield />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG, justifyContent: 'center', padding: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  sub: { color: '#6b7280', fontWeight: '600', textAlign: 'center' },
});

