import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import MealPositionBottomSheet from '@/components/MealPositionBottomSheet';
import { APP_RADIUS } from '@/constants/theme';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const NAVY = '#0f172a';
  const PILL_BG = '#ffffff';
  const ACTIVE = NAVY;
  const INACTIVE = '#52525b';
  const PILL_HEIGHT = 64;
  const PILL_MARGIN = 12;
  const bottomInset = insets.bottom;
  const pillStyle = {
    position: 'absolute' as const,
    backgroundColor: PILL_BG,
    borderTopWidth: 0,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    borderRadius: APP_RADIUS,
    marginHorizontal: 16,
    marginBottom: PILL_MARGIN + bottomInset,
    height: PILL_HEIGHT,
    paddingBottom: Platform.OS === 'android' ? 8 : 4,
    paddingTop: 8,
    bottom: 0,
    left: 0,
    right: 0,
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a' }}>
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: ACTIVE,
          tabBarInactiveTintColor: INACTIVE,
          tabBarLabelStyle: { fontSize: 11 },
          tabBarItemStyle: { flex: 1 },
          tabBarStyle: route.name === 'index' ? { display: 'none' } : pillStyle,
          tabBarBackground: () => null,
        })}>
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen
          name="home"
          options={{
            title: 'Today',
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size ?? 22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="log"
          options={{
            title: 'Log',
            tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" size={size ?? 22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="report"
          options={{
            title: 'Report',
            tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size ?? 22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="patterns"
          options={{
            title: 'Patterns',
            tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size ?? 22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="diary"
          options={{
            title: 'Diary',
            tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size ?? 22} color={color} />,
          }}
        />
      </Tabs>
      <MealPositionBottomSheet />
    </View>
  );
}
