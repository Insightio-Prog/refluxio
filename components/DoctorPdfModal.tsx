/**
 * components/DoctorPdfModal.tsx
 *
 * Modal that:
 *  1. Asks for an optional patient name
 *  2. Lets user pick a date range (from / to)
 *  3. Gathers data and generates the PDF via expo-print
 *  4. Opens Android share sheet
 *
 * Dependencies (add to package.json if not already present):
 *   expo-print
 *   expo-sharing
 *
 * Usage in user-settings.tsx:
 *   <DoctorPdfModal visible={pdfModalVisible} onClose={() => setPdfModalVisible(false)} />
 */

import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AppModal from '@/components/AppModal';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { useLogs } from '@/hooks/use-log-store';
import { gatherPdfData, buildDoctorPdfHtml } from '@/utils/doctor-pdf';
import { APP_RADIUS } from '@/constants/theme';

// ─── Colours (mirrors app palette) ───────────────────────────────────────────
const DARK   = '#0f172a';
const SLATE  = '#475569';
const MUTED  = '#94a3b8';
const BORDER = '#e2e8f0';
const BG     = '#f8fafc';
const CARD   = '#ffffff';
const GREEN  = '#2d6a4f';
const RED    = '#991b1b';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function subtractDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - days);
  return copy;
}

function formatDisplayDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Preset range options ─────────────────────────────────────────────────────

const TODAY = new Date();
const TODAY_ISO = toIsoDate(TODAY);

const RANGE_PRESETS = [
  { label: 'Last 7 days',  fromIso: toIsoDate(subtractDays(TODAY, 6)),  toIso: TODAY_ISO },
  { label: 'Last 14 days', fromIso: toIsoDate(subtractDays(TODAY, 13)), toIso: TODAY_ISO },
  { label: 'Last 30 days', fromIso: toIsoDate(subtractDays(TODAY, 29)), toIso: TODAY_ISO },
  { label: 'Last 90 days', fromIso: toIsoDate(subtractDays(TODAY, 89)), toIso: TODAY_ISO },
];

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Step = 'configure' | 'generating' | 'done' | 'error';

export default function DoctorPdfModal({ visible, onClose }: Props) {
  const { logs } = useLogs();

  const [patientName, setPatientName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(1); // default: 14 days
  const [step, setStep] = useState<Step>('configure');
  const [errorMsg, setErrorMsg] = useState('');

  function handleClose() {
    setStep('configure');
    setErrorMsg('');
    onClose();
  }

  async function handleGenerate() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('generating');

    try {
      const preset = RANGE_PRESETS[selectedPreset];
      const data = await gatherPdfData(logs, preset.fromIso, preset.toIso);
      const html = buildDoctorPdfHtml(data, patientName.trim() || undefined);

      if (Platform.OS === 'web') {
        // No file sharing in the browser: print the report from a hidden frame
        // so the visitor can choose "Save as PDF".
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        frame.srcdoc = html;
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => frame.remove(), 60000);
        };
        document.body.appendChild(frame);
        setStep('done');
        return;
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) throw new Error('Sharing is not available on this device.');

      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share Refluxio Health Summary',
        UTI: 'com.adobe.pdf',
      });

      setStep('done');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('[DoctorPdf] Error:', err);
      setErrorMsg(err?.message ?? 'Something went wrong generating the PDF.');
      setStep('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const preset = RANGE_PRESETS[selectedPreset];

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Doctor's Summary PDF</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'configure' && (
            <>
              {/* Name input */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>YOUR NAME (OPTIONAL)</Text>
                <Text style={styles.sectionHint}>
                  Added to the report header — helpful for GP filing.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Alex Smith"
                  placeholderTextColor={MUTED}
                  value={patientName}
                  onChangeText={setPatientName}
                  autoCapitalize="words"
                  returnKeyType="done"
                />
              </View>

              {/* Date range */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>DATE RANGE</Text>
                <Text style={styles.sectionHint}>
                  Choose the period to include in the report.
                </Text>
                <View style={styles.presetGrid}>
                  {RANGE_PRESETS.map((p, i) => (
                    <Pressable
                      key={p.label}
                      style={[styles.presetChip, selectedPreset === i && styles.presetChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedPreset(i);
                      }}
                    >
                      <Text
                        style={[
                          styles.presetChipText,
                          selectedPreset === i && styles.presetChipTextActive,
                        ]}
                      >
                        {p.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.dateRangeDisplay}>
                  {formatDisplayDate(preset.fromIso)} – {formatDisplayDate(preset.toIso)}
                </Text>
              </View>

              {/* What's included */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>WHAT'S INCLUDED</Text>
                <View style={styles.includesList}>
                  {[
                    'Symptom snapshot (days tracked, frequency, severity)',
                    'Confirmed triggers with occurrences',
                    'Confirmed safe foods',
                    'What\'s been helping (protective factors)',
                    'AI summary & key findings',
                    'Open questions flagged by the Detective',
                  ].map((item) => (
                    <View key={item} style={styles.includesRow}>
                      <Text style={styles.includesDot}>·</Text>
                      <Text style={styles.includesText}>{item}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Generate button */}
              <Pressable style={styles.generateBtn} onPress={handleGenerate}>
                <Text style={styles.generateBtnText}>Generate PDF</Text>
              </Pressable>
            </>
          )}

          {step === 'generating' && (
            <View style={styles.centreState}>
              <ActivityIndicator size="large" color={GREEN} />
              <Text style={styles.centreTitle}>Building your report…</Text>
              <Text style={styles.centreSubtitle}>
                Pulling data from your logs and confirmed triggers.
              </Text>
            </View>
          )}

          {step === 'done' && (
            <View style={styles.centreState}>
              <Text style={styles.doneIcon}>✓</Text>
              <Text style={styles.centreTitle}>PDF Ready</Text>
              <Text style={styles.centreSubtitle}>
                The share sheet opened so you can email it, save to Drive, or send directly to your GP.
              </Text>
              <Pressable style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          )}

          {step === 'error' && (
            <View style={styles.centreState}>
              <Text style={styles.errorIcon}>!</Text>
              <Text style={styles.centreTitle}>Something went wrong</Text>
              <Text style={styles.centreSubtitle}>{errorMsg}</Text>
              <Pressable
                style={styles.generateBtn}
                onPress={() => setStep('configure')}
              >
                <Text style={styles.generateBtnText}>Try Again</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </AppModal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: DARK,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 16 : 20,
    paddingBottom: 16,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontFamily: 'OutfitBold',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 16,
    fontFamily: 'Outfit',
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'OutfitBold',
    color: SLATE,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    fontFamily: 'Outfit',
    color: MUTED,
    marginBottom: 10,
  },

  // Name input
  input: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: APP_RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Outfit',
    color: DARK,
  },

  // Preset chips
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: APP_RADIUS,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  presetChipActive: {
    borderColor: DARK,
    backgroundColor: DARK,
  },
  presetChipText: {
    fontSize: 13,
    fontFamily: 'Outfit',
    color: SLATE,
  },
  presetChipTextActive: {
    color: '#ffffff',
    fontFamily: 'OutfitBold',
  },
  dateRangeDisplay: {
    fontSize: 13,
    fontFamily: 'Outfit',
    color: MUTED,
  },

  // What's included
  includesList: {
    gap: 6,
  },
  includesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  includesDot: {
    color: GREEN,
    fontSize: 16,
    lineHeight: 20,
    fontFamily: 'OutfitBold',
  },
  includesText: {
    fontSize: 13,
    fontFamily: 'Outfit',
    color: SLATE,
    flex: 1,
    lineHeight: 20,
  },

  // Generate button
  generateBtn: {
    backgroundColor: DARK,
    borderRadius: APP_RADIUS,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  generateBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontFamily: 'OutfitBold',
    letterSpacing: 0.2,
  },

  // Centre states (generating / done / error)
  centreState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  centreTitle: {
    fontSize: 18,
    fontFamily: 'OutfitBold',
    color: DARK,
    textAlign: 'center',
    marginTop: 8,
  },
  centreSubtitle: {
    fontSize: 14,
    fontFamily: 'Outfit',
    color: SLATE,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneIcon: {
    fontSize: 48,
    color: DARK,
    fontFamily: 'OutfitBold',
  },
  doneBtn: {
    backgroundColor: DARK,
    borderRadius: APP_RADIUS,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginTop: 12,
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontFamily: 'OutfitBold',
  },
  errorIcon: {
    fontSize: 48,
    color: RED,
    fontFamily: 'OutfitBold',
  },
});
