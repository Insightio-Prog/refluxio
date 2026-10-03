import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSafeAreaShield } from '@/components/bottom-safe-area-shield';
import { APP_RADIUS } from '@/constants/theme';

import { addLog as addLogToStore, removeLog as removeLogFromStore, updateLog, useLogs, type LogItem, type SymptomSeverity } from '@/hooks/use-log-store';
import { MOOD_OPTIONS } from '@/utils/home-utils';
import { buildTodayIntakeTotalsFromLogs, colorHex, computeDynamicRiskMap, loadLatestDailyRiskGuide, loadSafeThresholds, scoreToColor } from '@/utils/risk-engine';

const BG = '#f8fafc';
const THEME_BLUE = '#0f172a';
const ICON_COLOR = '#0f172a';
const BORDER = '#e2e8f0';
const RISK_MED = '#d97706';

function isSameLocalDay(aTs: number, bTs: number) {
  const a = new Date(aTs);
  const b = new Date(bTs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfLocalDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Local wall-clock HH:mm for editing (24h). */
function toHHmm(ts: number) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function applyHHmmToTimestamp(baseTs: number, hhmm: string): number {
  const trimmed = hhmm.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return baseTs;
  let h = parseInt(match[1], 10);
  let m = parseInt(match[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return baseTs;
  const d = new Date(baseTs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function dayLabel(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
}

function dateNumber(ts: number) {
  return new Date(ts).getDate();
}

function categoryFor(item: LogItem) {
  if (item.type === 'note') return 'CASE NOTE';
  if (item.type === 'mood') return 'MOOD LOG';
  if (item.type === 'symptom') return 'SYMPTOM LOG';
  if (item.type === 'drink') return 'DRINK LOG';
  if (item.type === 'food') return 'FOOD LOG';
  if (item.type === 'snack') return 'SNACK LOG';
  if (item.type === 'meal') return 'MEAL LOG';
  return 'MEDS LOG';
}

function titleFor(item: LogItem) {
  return item.key || 'Unknown Entry';
}

function symptomSeverityLabel(s: SymptomSeverity) {
  if (s === 'mild') return 'Mild';
  if (s === 'moderate') return 'Moderate';
  return 'Severe';
}

function symptomSeverityColor(s: SymptomSeverity) {
  if (s === 'mild') return colorHex('green');
  if (s === 'moderate') return colorHex('orange');
  return colorHex('red');
}

function leftIcon(item: LogItem) {
  if (item.type === 'note') return 'book-outline';
  if (item.type === 'food' || item.type === 'meal') return 'restaurant-outline';
  if (item.type === 'snack') return 'fast-food-outline';
  if (item.type === 'drink') return 'beaker-outline';
  if (item.type === 'mood') {
    const moodOption = MOOD_OPTIONS.find(m => m.key === item.key);
    return (moodOption?.ionicon ?? 'happy-outline') as any;
  }
  if (item.type === 'symptom') return 'pulse-outline';
  return 'leaf-outline';
}

export default function DiaryScreen() {
  const insets = useSafeAreaInsets();
  const { sortedLogs } = useLogs();
  const todayStart = useMemo(() => startOfLocalDay(Date.now()), []);
  const [selectedDayStart, setSelectedDayStart] = useState<number>(todayStart);
  const scrollRef = useRef<ScrollView | null>(null);
  const rowRefs = useRef<Record<string, Swipeable | null>>({});

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LogItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editTimeHHmm, setEditTimeHHmm] = useState('');
  const [editTimeError, setEditTimeError] = useState<string>('');
  const [ingredientsExpanded, setIngredientsExpanded] = useState<Record<string, boolean>>({});

  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [dailyRiskGuide, setDailyRiskGuide] = useState<Record<string, number> | null>(null);
  const [safeThresholds, setSafeThresholds] = useState<Record<string, any> | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const [guide, safe] = await Promise.all([loadLatestDailyRiskGuide(), loadSafeThresholds()]);
      if (!alive) return;
      setDailyRiskGuide(guide);
      setSafeThresholds(safe);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const NOTE_EXAMPLES = useMemo(
    () => ['Why did I react to lunch?', 'Logged stress level: High.', 'Ate while lying down.'],
    []
  );

  const selectedLogs = useMemo(
    () =>
      sortedLogs
        .filter((l) => isSameLocalDay(l.createdAt, selectedDayStart))
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [sortedLogs, selectedDayStart]
  );

  const visibleSelectedLogs = useMemo(
    () => selectedLogs.filter((item) => !(item.type === 'note' && item.key.startsWith('[REPORT_REPLY]'))),
    [selectedLogs]
  );

  const riskScoresToday = useMemo(() => {
    const totals = buildTodayIntakeTotalsFromLogs(sortedLogs);
    return computeDynamicRiskMap({ dailyRiskGuide, totals, safeThresholds: safeThresholds ?? {} });
  }, [sortedLogs, dailyRiskGuide, safeThresholds]);

  const riskDotForLog = (item: LogItem) => {
    const intakeTypes = new Set(['food', 'drink', 'snack', 'meal', 'trigger']);
    if (!intakeTypes.has(item.type)) return null;
    if (!isSameLocalDay(item.createdAt, Date.now())) return null;
    // Prefer first segment label when keys are "A (1x), B (200g)".
    const primary = item.key.split(',')[0]?.trim() ?? item.key.trim();
    const k = primary.toLowerCase();
    const score = riskScoresToday[k];
    if (typeof score !== 'number') return null;
    return colorHex(scoreToColor(score));
  };

  const weekDays = useMemo(() => {
    return Array.from({ length: 14 }).map((_, idx) => todayStart + (idx - 13) * 24 * 60 * 60 * 1000);
  }, [todayStart]);

  const copySelectedDay = async () => {
    const dateStr = new Date(selectedDayStart).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const lines = visibleSelectedLogs.map((i) => {
      const ingredients = (i.ingredients ?? '').trim();
      const sev =
        i.type === 'symptom' && i.symptomSeverity
          ? ` — ${symptomSeverityLabel(i.symptomSeverity)}`
          : '';
      const base = `${formatTime(i.createdAt)} - ${i.key}${sev}`;
      if (!ingredients) return `${base}\n   ---`;
      return `${base}\n   Ingredients: ${ingredients}\n   ---`;
    });
    const logBody = lines.join('\n');
    const text = `You are analysing a personal GERD and acid reflux diary log. I have a condition that causes heartburn and digestive symptoms, and I'm trying to identify my personal food and lifestyle triggers.

Below is my complete food, drink, snack, medication, symptom, mood, and environment log for ${dateStr}. Please analyse this data and:
- Identify any foods or drinks consumed close to when symptoms occurred (within 1–3 hours)
- Note any patterns with portion size, meal timing, or eating position if mentioned
- Consider whether stress, mood, tiredness or environmental factors (e.g. high pollen, exercise) may have contributed — these are known to aggravate reflux independently of diet
- Highlight anything that stands out as a likely trigger candidate
- Note anything that seemed protective or correlated with a symptom-free period
- If there is not enough data to draw conclusions, say so clearly

Please be specific and evidence-based using only what is logged below. Do not make assumptions beyond the data.

--- LOG START ---
${logBody}
--- LOG END ---

If you have questions about any entry or need clarification, please ask.`.trim();
    await Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingItem(null);
    setEditName('');
    setEditTimeHHmm('');
    setEditTimeError('');
  };

  const openEditModal = (item: LogItem) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingItem(item);
    setEditName(item.key);
    setEditTimeHHmm(toHHmm(item.createdAt));
    setEditTimeError('');
    setEditModalOpen(true);
  };

  const normalizeTimeInput = (raw: string) => {
    // 1) Normalize separators and drop illegal chars
    let v = raw.replace(/[.,]/g, ':');
    v = v.replace(/[^\d:]/g, '');

    // If user types only digits, try to auto-shape into HH:MM.
    if (!v.includes(':')) {
      const digits = v.replace(/\D/g, '');
      if (digits.length >= 3) {
        const trimmed = digits.slice(0, 4);
        const hourPart = trimmed.length === 3 ? trimmed.slice(0, 1) : trimmed.slice(0, 2);
        const minPart = trimmed.slice(-2);
        const hh = hourPart.padStart(2, '0');
        v = `${hh}:${minPart}`;
      } else {
        // keep partial hour typing (0-2 digits)
        v = digits.slice(0, 2);
      }
    } else {
      // Keep only first ":" and enforce 2 digits for minutes.
      const [hRaw, mRaw = ''] = v.split(':');
      const h = (hRaw ?? '').replace(/\D/g, '').slice(0, 2);
      const m = (mRaw ?? '').replace(/\D/g, '').slice(0, 2);
      v = m.length > 0 ? `${h}:${m}` : h.length > 0 ? `${h}:` : '';
    }

    // hard cap to HH:MM (5 chars)
    return v.slice(0, 5);
  };

  const isValidHHmm = (hhmm: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm.trim());

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const name = editName.trim() || editingItem.key;
    const normalizedTime = editTimeHHmm.trim();
    if (!isValidHHmm(normalizedTime)) {
      setEditTimeError('Use HH:MM format');
      return;
    }
    const newTs = applyHHmmToTimestamp(editingItem.createdAt, normalizedTime);
    await updateLog(String(editingItem.id), { key: name, createdAt: newTs });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeEditModal();
  };

  const toggleIngredientsExpanded = (logId: string) => {
    setIngredientsExpanded((s) => ({ ...s, [logId]: !s[logId] }));
  };

  const renderRightActions = (item: LogItem) => (
    <View style={styles.swipeActionsRow}>
      <Pressable
        onPress={() => {
          rowRefs.current[item.id]?.close();
          openEditModal(item);
        }}
        style={({ pressed }) => [styles.swipeLineBtn, { opacity: pressed ? 0.92 : 1 }]}
      >
        <Ionicons name="pencil-outline" size={20} color={ICON_COLOR} />
      </Pressable>
      <Pressable
        onPress={() => {
          rowRefs.current[item.id]?.close();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          void removeLogFromStore(String(item.id));
        }}
        style={({ pressed }) => [styles.swipeLineBtn, { opacity: pressed ? 0.92 : 1 }]}
      >
        <Ionicons name="trash-outline" size={20} color={ICON_COLOR} />
      </Pressable>
    </View>
  );

  const closeNoteModal = () => {
    setNoteModalOpen(false);
    setNoteText('');
    setIsSavingNote(false);
  };

  const saveNote = async () => {
    const text = noteText.trim();
    if (!text || isSavingNote) return;
    try {
      setIsSavingNote(true);
      await addLogToStore(text, 'note');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeNoteModal();
    } finally {
      setIsSavingNote(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: 0 }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <Modal visible={editModalOpen} transparent animationType="fade" onRequestClose={closeEditModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeEditModal}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <Pressable style={styles.modalCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Edit log</Text>
                <Pressable onPress={closeEditModal} hitSlop={12} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
                  <Ionicons name="close" size={22} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Log name"
                placeholderTextColor="#94a3b8"
                autoCapitalize="sentences"
                style={styles.modalInput}
              />

              <Text style={[styles.modalLabel, { marginTop: 10 }]}>Time (24h, HH:mm)</Text>
              <TextInput
                value={editTimeHHmm}
                onChangeText={(t) => {
                  setEditTimeError('');
                  setEditTimeHHmm(normalizeTimeInput(t));
                }}
                placeholder="14:30"
                placeholderTextColor="#94a3b8"
                keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'number-pad'}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.modalInput, editTimeError ? styles.modalInputError : null]}
                onFocus={() => setEditTimeError('')}
              />
              {editTimeError ? <Text style={styles.modalErrorText}>{editTimeError}</Text> : null}

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={closeEditModal}
                  style={({ pressed }) => [styles.modalBtn, styles.modalBtnGhost, { opacity: pressed ? 0.9 : 1 }]}
                >
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleSaveEdit()}
                  style={({ pressed }) => [styles.modalBtn, styles.modalBtnPrimary, { opacity: pressed ? 0.92 : 1 }]}
                >
                  <Text style={styles.modalBtnPrimaryText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <Modal visible={noteModalOpen} transparent animationType="fade" onRequestClose={closeNoteModal}>
        <View style={styles.noteBackdrop}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15, 23, 42, 0.72)' }]} />
          )}
          <Pressable style={StyleSheet.absoluteFill} onPress={closeNoteModal} />

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.noteCenter}>
            <Pressable style={styles.noteCard} onPress={() => { /* absorb taps */ }}>
              <View style={styles.noteHeaderRow}>
                <Text style={styles.noteTitle}>New Case Note</Text>
                <Pressable
                  onPress={closeNoteModal}
                  hitSlop={12}
                  style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close note"
                >
                  <Ionicons name="close" size={22} color={THEME_BLUE} />
                </Pressable>
              </View>

              <Text style={styles.noteHelp}>Ask a question or add context for tomorrow&apos;s report.</Text>

              <View style={styles.exampleRow}>
                {NOTE_EXAMPLES.map((ex) => (
                  <Pressable
                    key={ex}
                    onPress={() => setNoteText(ex)}
                    style={({ pressed }) => [styles.exampleTag, { opacity: pressed ? 0.85 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Use example: ${ex}`}
                  >
                    <Text style={styles.exampleTagText}>{ex}</Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Type your note…"
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
                autoCorrect
                style={styles.noteInput}
              />

              <Pressable
                onPress={() => void saveNote()}
                disabled={!noteText.trim() || isSavingNote}
                style={({ pressed }) => [
                  styles.saveNoteBtn,
                  { opacity: !noteText.trim() || isSavingNote ? 0.5 : pressed ? 0.92 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save note"
              >
                <Ionicons name={isSavingNote ? 'time-outline' : 'save-outline'} size={18} color="#fff" />
                <Text style={styles.saveNoteBtnText}>{isSavingNote ? 'SAVING…' : 'SAVE NOTE'}</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      
      <View style={[styles.newHeader, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.newHeaderSub}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' }).toUpperCase()}
        </Text>
        <Text style={styles.newHeaderTitle}>Diary</Text>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={styles.weekStrip}
        >
          {weekDays.map((ts) => {
            const isToday = isSameLocalDay(ts, Date.now());
            const isSelected = isSameLocalDay(ts, selectedDayStart);
            return (
              <Pressable
                key={ts}
                onPress={() => setSelectedDayStart(startOfLocalDay(ts))}
                style={[styles.dayCell, isSelected && styles.dayCellSelected]}
              >
                <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>{dayLabel(ts)}</Text>
                <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>
                  {dateNumber(ts)}
                </Text>
                {isToday ? <View style={styles.todayDot} /> : <View style={styles.todayDotPlaceholder} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setNoteModalOpen(true);
        }}
        style={({ pressed }) => [styles.noteCta, { opacity: pressed ? 0.92 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Add note for the Detective"
      >
        <Text style={styles.noteCtaText}>ADD NOTE OR ASK A QUESTION</Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: (styles.content as any).paddingBottom + insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.timelineHeader}>
          <Text style={styles.timelineDate}>Timeline</Text>
          <Text style={styles.timelineCount}>{visibleSelectedLogs.length} entries</Text>
        </View>

        {visibleSelectedLogs.map((item) => (
          <Swipeable
            key={item.id}
            ref={(r) => {
              if (r) rowRefs.current[item.id] = r;
              else delete rowRefs.current[item.id];
            }}
            renderRightActions={() => renderRightActions(item)}
            overshootRight={false}
            friction={2}
          >
            <View style={[styles.entryCard, item.type === 'note' ? styles.entryCardNote : null]}>
              <View style={styles.entryTimeCol}>
                <Text style={styles.entryTime}>{formatTime(item.createdAt)}</Text>
              </View>
              <View style={styles.entryTextCol}>
                <View style={styles.entryTopRow}>
                  <View style={styles.entryLeftRow}>
                    {(() => {
                      const dot = riskDotForLog(item);
                      return dot ? <View style={[styles.riskDot, { backgroundColor: dot }]} /> : null;
                    })()}
                    <Text style={styles.entryTitle}>{titleFor(item)}</Text>
                  </View>
                  <View style={styles.entryRightRow}>
                    <Text style={styles.entryCategory}>{categoryFor(item)}</Text>
                    {item.ingredients?.trim() ? (
                      <Pressable
                        onPress={() => toggleIngredientsExpanded(item.id)}
                        hitSlop={10}
                        style={({ pressed }) => [styles.ingredientsInfoBtn, { opacity: pressed ? 0.65 : 1 }]}
                      >
                        <Ionicons
                          name={ingredientsExpanded[item.id] ? 'chevron-up-circle-outline' : 'information-circle-outline'}
                          size={18}
                          color="#94a3b8"
                        />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {item.type === 'symptom' && item.symptomSeverity ? (
                  <Text style={styles.entrySubText} numberOfLines={1}>
                    {symptomSeverityLabel(item.symptomSeverity)}
                  </Text>
                ) : null}
                {ingredientsExpanded[item.id] && item.ingredients?.trim() ? (
                  <Text style={styles.entrySubText}>{item.ingredients}</Text>
                ) : null}
              </View>
            </View>
          </Swipeable>
        ))}

        {visibleSelectedLogs.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No logs for this day</Text>
            <Text style={styles.emptySub}>Entries you log on the dashboard will appear here in your timeline.</Text>
          </View>
        )}

        <Pressable onPress={copySelectedDay} style={styles.copyButton}>
          <Ionicons name="copy-outline" size={18} color={THEME_BLUE} style={{ marginRight: 8 }} />
          <Text style={styles.copyButtonText}>COPY FOR AI ANALYSIS</Text>
        </Pressable>

        <Text style={styles.footer}>Logs are stored locally on your device.</Text>
      </ScrollView>

      <BottomSafeAreaShield />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  newHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: BG,
  },
  newHeaderSub: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 6,
  },
  newHeaderTitle: {
    fontFamily: 'OutfitBold',
    fontSize: 32,
    color: THEME_BLUE,
    marginBottom: 16,
  },
  weekStrip: { paddingTop: 8, gap: 12 },
  dayCell: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 44,
    borderRadius: APP_RADIUS,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dayCellSelected: {
    backgroundColor: THEME_BLUE,
    borderRadius: APP_RADIUS,
    borderWidth: 0,
  },
  dayName: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 4,
  },
  dayNameSelected: {
    color: '#fff',
  },
  dayNumber: {
    fontFamily: 'OutfitBold',
    fontSize: 16,
    color: THEME_BLUE,
  },
  dayNumberSelected: {
    color: '#fff',
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: APP_RADIUS,
    backgroundColor: '#d97706',
    marginTop: 3,
    alignSelf: 'center',
  },
  todayDotPlaceholder: {
    width: 4,
    height: 4,
    marginTop: 3,
  },

  content: { padding: 16, gap: 12 },
  noteCta: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#dbe4f0',
    borderRadius: APP_RADIUS,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  noteCtaText: { fontFamily: 'OutfitBlack', fontSize: 13, color: '#0f172a', letterSpacing: 1 },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  timelineDate: {
    fontFamily: 'OutfitBold',
    fontSize: 16,
    color: THEME_BLUE,
  },
  timelineCount: {
    fontFamily: 'OutfitMedium',
    fontSize: 12,
    color: '#94a3b8',
  },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    marginBottom: 2,
  },
  entryCardNote: {
    // Notes (including "ask a question") should visually match the add-note CTA.
    backgroundColor: '#dbe4f0',
    borderColor: 'rgba(219, 228, 240, 1)',
  },
  entryIconCircle: {
    width: 36,
    height: 36,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  entryTextCol: { flex: 1, minWidth: 0 },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  entryLeftRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  entryRightRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  entryCategory: {
    fontFamily: 'OutfitMedium',
    fontSize: 11,
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  riskDot: { width: 8, height: 8, borderRadius: APP_RADIUS},
  entryTitle: {
    fontFamily: 'OutfitBold',
    fontSize: 14,
    color: THEME_BLUE,
    flex: 1,
    flexWrap: 'wrap',
  },
  entrySubText: {
    marginTop: 4,
    fontFamily: 'Outfit',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 16,
  },
  ingredientsInfoBtn: { padding: 2, borderRadius: APP_RADIUS, borderWidth: 1, borderColor: BORDER, backgroundColor: 'transparent' },
  entryTimeCol: {
    minWidth: 40,
    alignItems: 'flex-start',
    paddingTop: 2,
  },
  entryTime: {
    fontFamily: 'OutfitMedium',
    fontSize: 12,
    color: '#94a3b8',
    minWidth: 36,
    marginTop: 4,
  },

  swipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 10,
    height: 54,
  },
  swipeLineBtn: {
    width: 54,
    height: 54,
    borderRadius: APP_RADIUS,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  modalCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  modalCard: { backgroundColor: '#fff', borderRadius: APP_RADIUS, padding: 16, elevation: 6 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontFamily: 'OutfitBlack', fontSize: 16, color: '#0f172a' },
  modalLabel: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#64748b', letterSpacing: 0.8 },
  modalInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: APP_RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'OutfitBold',
    fontSize: 13,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  modalInputError: { borderColor: '#ef4444', backgroundColor: '#fff' },
  modalErrorText: { marginTop: 6, fontFamily: 'OutfitBold', fontSize: 11, color: '#ef4444' },
  modalButtonsRow: { marginTop: 14, flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, height: 44, borderRadius: APP_RADIUS, alignItems: 'center', justifyContent: 'center' },
  modalBtnGhost: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  modalBtnGhostText: { fontFamily: 'OutfitBlack', color: '#0f172a', fontSize: 12 },
  modalBtnPrimary: { backgroundColor: '#0f172a' },
  modalBtnPrimaryText: { fontFamily: 'OutfitBlack', color: '#fff', fontSize: 12 },

  noteBackdrop: { flex: 1 },
  noteCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  noteCard: { backgroundColor: '#fff', borderRadius: APP_RADIUS, padding: 16, elevation: 8 },
  noteHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noteTitle: { fontFamily: 'OutfitBlack', fontSize: 16, color: THEME_BLUE },
  noteHelp: { marginTop: 8, fontFamily: 'Outfit', fontSize: 13, lineHeight: 18, color: '#64748b' },
  exampleRow: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  exampleTag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  exampleTagText: { fontFamily: 'OutfitMedium', fontSize: 12, color: '#94a3b8' },
  noteInput: {
    marginTop: 12,
    minHeight: 160,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: APP_RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Outfit',
    fontSize: 14,
    color: THEME_BLUE,
    backgroundColor: '#f8fafc',
  },
  saveNoteBtn: {
    marginTop: 14,
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: THEME_BLUE,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveNoteBtnText: { fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1.1, color: '#fff' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 20,
  },
  emptyTitle: { color: THEME_BLUE, fontFamily: 'OutfitBlack', fontSize: 16, marginBottom: 4 },
  emptySub: { color: '#64748b', fontFamily: 'OutfitBold', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  copyButton: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    height: 48,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyButtonText: {
    fontFamily: 'OutfitBlack',
    fontSize: 12,
    color: THEME_BLUE,
    letterSpacing: 1,
  },
  footer: { color: '#94a3b8', textAlign: 'center', fontFamily: 'OutfitBold', fontSize: 10, marginTop: 20 },
});