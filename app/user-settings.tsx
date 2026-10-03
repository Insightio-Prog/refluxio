import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmDialog } from '@/utils/dialog';
import { resetApp } from '@/services/storage-service';
import DoctorPdfModal from '@/components/DoctorPdfModal';
import { LOGO_FONT_LIGHT, LOGO_FONT_STRONG } from '@/constants/fonts';
import { APP_RADIUS } from '@/constants/theme';

const HEADER_DARK = '#0f172a';
const BG = '#f8fafc';
const CARD = '#ffffff';
const DARK = '#0f172a';
const SLATE = '#475569';
const MUTED = '#94a3b8';
const BORDER = '#e2e8f0';
const RED = '#dc2626';

const DEFAULT_BEDTIME_KEY = 'heartburn.defaultBedtime.v1';

type SettingsRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  labelAccessory?: React.ReactNode;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  showChevron?: boolean;
};

function SettingsRow({
  icon,
  iconColor = SLATE,
  label,
  labelAccessory,
  subtitle,
  onPress,
  right,
  showChevron = true,
}: SettingsRowProps) {
  const content = (
    <>
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowLabelWrap}>
          <Text style={styles.rowLabel}>{label}</Text>
          {labelAccessory}
        </View>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {right ?? (showChevron ? <Ionicons name="chevron-forward" size={18} color={MUTED} /> : null)}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.row}>{content}</View>;
}

export default function UserSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [bedtimeEditorOpen, setBedtimeEditorOpen] = useState(false);
  const [defaultBedtime, setDefaultBedtime] = useState('');
  const [pdfModalVisible, setPdfModalVisible] = useState(false);

  const loadDefaultBedtime = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(DEFAULT_BEDTIME_KEY);
      if (raw) setDefaultBedtime(raw);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadDefaultBedtime();
  }, [loadDefaultBedtime]);

  const saveDefaultBedtime = async (value: string) => {
    const trimmed = value.trim();
    setDefaultBedtime(trimmed);
    try {
      if (trimmed) {
        await AsyncStorage.setItem(DEFAULT_BEDTIME_KEY, trimmed);
      } else {
        await AsyncStorage.removeItem(DEFAULT_BEDTIME_KEY);
      }
    } catch {
      // ignore
    }
  };

  const handleExportPress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPdfModalVisible(true);
  };

  const handleClearAllData = () => {
    confirmDialog({
      title: 'Clear all data?',
      message: 'This will permanently remove all logs, settings, and cached reports on this device. This cannot be undone.',
      confirmLabel: 'Yes, clear everything',
      destructive: true,
      onConfirm: () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        void (async () => {
          await resetApp();
          if (Platform.OS === 'web') window.location.assign('/');
          else router.replace('/onboarding-triggers' as never);
        })();
      },
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={HEADER_DARK} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [styles.backBtn, { top: insets.top + 12, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>

        <View style={styles.brandLockup} pointerEvents="none">
          <Text style={styles.brandTitle} accessibilityRole="header">
            <Text style={styles.brandTitleStrong}>Reflux</Text>
            <Text style={styles.brandTitleLight}>io</Text>
          </Text>
          <Text style={styles.brandTagline}>TRACK · IDENTIFY · HEAL</Text>
        </View>

        <View style={styles.headerSideSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 16 + insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.sectionKicker}>MY TRIGGERS</Text>
          <SettingsRow
            icon="flame-outline"
            label="Manage Triggers"
            subtitle="Add or remove your personal suspect list"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/manage-triggers' as never);
            }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionKicker}>SLEEP</Text>
          <SettingsRow
            icon="moon-outline"
            label="Default Bedtime"
            subtitle={
              defaultBedtime.trim()
                ? `Pre-fills the nightly sleep prompt · ${defaultBedtime.trim()}`
                : 'Pre-fills the nightly sleep prompt'
            }
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setBedtimeEditorOpen((open) => !open);
            }}
          />
          {bedtimeEditorOpen ? (
            <TextInput
              value={defaultBedtime}
              onChangeText={setDefaultBedtime}
              onBlur={() => {
                const trimmed = defaultBedtime.trim();
                void saveDefaultBedtime(defaultBedtime);
                if (trimmed) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }}
              placeholder="e.g. 23:00"
              placeholderTextColor={MUTED}
              keyboardType="numeric"
              style={styles.bedtimeInput}
              accessibilityLabel="Default bedtime"
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionKicker}>DATA</Text>
          <SettingsRow
            icon="download-outline"
            label="Create Doctor's Report (PDF)"
            subtitle="A summary of your diary to take to your GP"
            onPress={handleExportPress}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="build-outline"
            label="Advanced"
            subtitle="Monthly case review, reset detective memory"
            onPress={() => router.push('/settings' as never)}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="trash-outline"
            iconColor={RED}
            label="Clear All Data"
            subtitle="Cannot be undone"
            onPress={handleClearAllData}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionKicker}>ABOUT</Text>
          <SettingsRow
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void Linking.openURL('https://insightio.co.uk/privacy');
            }}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="information-circle-outline"
            label="App Version"
            showChevron={false}
            right={<Text style={styles.versionLabel}>1.0.0 (beta)</Text>}
          />
        </View>
      </ScrollView>
      <DoctorPdfModal visible={pdfModalVisible} onClose={() => setPdfModalVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: HEADER_DARK },
  header: {
    backgroundColor: HEADER_DARK,
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSideSpacer: { width: 40, height: 40 },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  brandLockup: { alignItems: 'center', flex: 1 },
  brandTitle: { fontSize: 34, color: '#fff', letterSpacing: -0.8, lineHeight: 36 },
  brandTitleStrong: { fontFamily: LOGO_FONT_STRONG },
  brandTitleLight: { fontFamily: LOGO_FONT_LIGHT, color: '#2d6a4f' },
  brandTagline: {
    fontFamily: 'OutfitBlack',
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 3,
    marginTop: 8,
  },
  scroll: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingTop: 20 },
  card: {
    backgroundColor: CARD,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
  },
  sectionKicker: {
    fontFamily: 'OutfitBlack',
    fontSize: 10,
    letterSpacing: 1.2,
    color: MUTED,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 12,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: APP_RADIUS,
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowLabel: { fontFamily: 'OutfitBlack', fontSize: 14, color: DARK },
  rowSub: { fontFamily: 'Outfit', fontSize: 12, color: SLATE, marginTop: 3, lineHeight: 16 },
  bedtimeInput: {
    marginTop: 12,
    height: 44,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: APP_RADIUS,
    paddingHorizontal: 12,
    fontFamily: 'Outfit',
    fontSize: 14,
    color: DARK,
    backgroundColor: BG,
  },
  versionLabel: {
    fontFamily: 'Outfit',
    fontSize: 13,
    color: SLATE,
  },
});
