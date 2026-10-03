import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AiContext, AiContextSymptomEvent } from '@/utils/prepare-ai-context';
import { APP_RADIUS } from '@/constants/theme';

const BG = '#f8fafc';
const BORDER = '#e2e8f0';
const DARK = '#1e293b';
const SLATE = '#475569';

type DailyAiReportMock = {
  headline: string;
  /** Conversational, continuous body text. */
  body: string;
  /** Behind-the-scenes “AI brain” notes. */
  detectiveLog?: string[];
  /** Strategy tags shown as pills at bottom. */
  strategy: string[];
};

export type DailyAiReportData = DailyAiReportMock;

export function formatDailyAiReportForShare(input: DailyAiReportMock) {
  const lines = [
    `Daily AI Report — ${input.headline}`,
    '',
    input.body.trim(),
    ...(input.detectiveLog?.length ? ['', 'Detective log:', ...input.detectiveLog.map((l) => `- ${l}`)] : []),
    '',
    'The Strategy:',
    ...input.strategy.map((a) => `- ${a}`),
  ];
  return lines.join('\n').trim();
}

export type DailyAiReportProps = {
  /** Optional external dismiss handler. */
  onDismiss?: () => void;
  /** Optional share handler (renders a button when present). */
  onShare?: () => void;
  /** Fully-built data (highest priority). */
  data?: DailyAiReportData | null;
  /** Override mock data (optional). */
  mock?: Partial<DailyAiReportMock>;
  /** Optional real context (preferred). */
  context?: AiContext;
  /** Used to compute “yesterday” relative to this timestamp. */
  nowTs?: number;
};

const DEFAULT_MOCK: DailyAiReportMock = {
  headline: 'The Gut Check',
  body:
    "Yesterday was a total win — your gut was as quiet as a library.\n\nDid you notice how that late‑afternoon bite didn’t cause any drama? That might be your sweet spot.\n\nToday, maybe we try to copy that vibe: keep coffee small, keep the pace easy, and see if the calm sticks.",
  detectiveLog: ['📉 Nudged “coffee window” earlier (based on yesterday’s calm stretch).', "✨ Added “acidic bits” as a watch-item (citric/vinegar)."],
  strategy: ['💡 Keep it simple at lunch', '🎯 Coffee: small + earlier', '🧩 Notice what feels “easy”'],
};

function startOfLocalDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatLocalHHmm(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function buildReportFromContext(ctx: AiContext, nowTs: number): DailyAiReportMock {
  const todayStart = startOfLocalDay(nowTs);
  const yStart = todayStart - 24 * 60 * 60 * 1000;
  const yEnd = todayStart;

  const yLinks = ctx.links
    .filter((l) => l.ts >= yStart && l.ts < yEnd)
    .sort((a, b) => a.ts - b.ts);

  // If no symptoms yesterday: maintenance mode.
  if (yLinks.length === 0) {
    return {
      headline: 'Maintenance Mode',
      body:
        "Yesterday was a clean sheet — no symptoms logged. That’s the kind of streak we like.\n\nDid you notice how the day felt when nothing was “spiky”? If something worked, it’s worth repeating.\n\nToday, maybe we go for 2‑for‑2: keep the rhythm similar and see if your gut stays on airplane mode.",
      detectiveLog: ['✨ Nothing to “fix” yesterday — leaving the trigger list untouched.', '🧩 If you want extra signal, logging ingredients on one meal helps a lot.'],
      strategy: ['💡 Repeat yesterday’s rhythm', '🎯 Keep late snacks light', '🧩 If anything changes, jot the ingredients'],
    };
  }

  const mentionForLink = (l: AiContextSymptomEvent) => {
    const t = formatLocalHHmm(l.ts);
    const last = l.precedingIntake[l.precedingIntake.length - 1];
    if (!last) return `${t}: ${l.symptom} (no intake logged in prior ${ctx.symptomLookbackHours}h)`;
    return `${t}: ${l.symptom} — after ${last.name}`;
  };

  // Find “wins”: intake items yesterday that had no symptom within 6h after.
  const intakeYesterday = ctx.days
    .flatMap((d) => d.intake)
    .filter((i) => i.ts >= yStart && i.ts < yEnd)
    .sort((a, b) => a.ts - b.ts);

  const wins: string[] = [];
  for (const intake of intakeYesterday) {
    const hasSymptomAfter = yLinks.some((s) => s.ts > intake.ts && s.ts <= intake.ts + ctx.symptomLookbackHours * 60 * 60 * 1000);
    if (!hasSymptomAfter) {
      wins.push(`No symptoms within ${ctx.symptomLookbackHours}h after ${intake.name}`);
    }
    if (wins.length >= 2) break;
  }

  const adjustments: string[] = [];
  // Lightweight “adjustment tags” from patterns.
  const hasCoffee = intakeYesterday.some((i) => /coffee/i.test(i.name) || /coffee/i.test(i.ingredients ?? ''));
  const hasVinegar = intakeYesterday.some((i) => /\bvinegar\b/i.test(i.ingredients ?? ''));
  const hasCitric = intakeYesterday.some((i) => /\bcitric\b/i.test(i.ingredients ?? ''));
  if (hasCoffee) adjustments.push('🎯 Coffee: smaller + earlier');
  if (hasVinegar) adjustments.push('💡 Vinegar: notice how it lands');
  if (hasCitric) adjustments.push('💡 Citric acid: notice how it lands');
  if (adjustments.length === 0) adjustments.push('💡 Strategy: keep doing what felt easy');

  const wittyOpen = wins.length
    ? "Yesterday had some genuinely good moments — your gut didn’t throw a single plot twist."
    : 'Yesterday had a bit of signal, but nothing we can’t learn from.';
  const didYouNotice = wins.length
    ? `Did you notice the calm stretch after ${wins[0].replace(/^No symptoms within \d+h after /, '')}? That might be a “safe lane.”`
    : `Did you notice what happened before the first symptom (${mentionForLink(yLinks[0]).replace(/^\d{2}:\d{2}:\s*/, '')})? That could be a clue.`;
  const suggestion = hasCoffee
    ? 'Today, maybe we keep coffee small again and see if the calm repeats.'
    : 'Today, maybe we try the same meal timing and see what stays easy.';

  const detectiveLog: string[] = [];
  if (hasCoffee) detectiveLog.push('📉 Soft-capped coffee: “smaller + earlier” (based on yesterday’s pattern).');
  if (hasVinegar) detectiveLog.push('✨ Added “Vinegar” as a gentle watch-item.');
  if (hasCitric) detectiveLog.push('✨ Added “Citric acid” as a gentle watch-item.');
  if (detectiveLog.length === 0) detectiveLog.push('✨ No obvious trigger edits — keeping your list calm and simple.');

  const body = `${wittyOpen}\n\n${didYouNotice}\n\n${suggestion}`;

  return {
    headline: 'The Gut Check',
    body,
    detectiveLog,
    strategy: adjustments,
  };
}

export function buildDailyAiReportData(input: { context?: AiContext; mock?: Partial<DailyAiReportMock>; nowTs?: number; data?: DailyAiReportData | null }) {
  if (input.data) return input.data;
  if (input.context) return buildReportFromContext(input.context, input.nowTs ?? Date.now());
  return {
    headline: input.mock?.headline ?? DEFAULT_MOCK.headline,
    body: input.mock?.body ?? DEFAULT_MOCK.body,
    detectiveLog: input.mock?.detectiveLog ?? DEFAULT_MOCK.detectiveLog,
    strategy: input.mock?.strategy ?? DEFAULT_MOCK.strategy,
  } satisfies DailyAiReportData;
}

export function DailyAiReport({ onDismiss, onShare, data: reportData, mock, context, nowTs }: DailyAiReportProps) {
  const isLoading = reportData === null;

  const data = useMemo<DailyAiReportMock>(() => {
    return buildDailyAiReportData({ context, mock, nowTs, data: reportData });
  }, [context, mock, nowTs, reportData]);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>DAILY AI REPORT</Text>
          <Text style={styles.headline} numberOfLines={1}>
            {data.headline}
          </Text>
        </View>

        <Pressable
          hitSlop={12}
          onPress={() => {
            onDismiss?.();
          }}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.75 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Dismiss report"
        >
          <Ionicons name="close" size={18} color={DARK} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={DARK} />
          <Text style={styles.loadingText}>Generating your report…</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.bodyText}>{data.body}</Text>

          {data.detectiveLog?.length ? (
            <View style={styles.detectiveWrap}>
              <Text style={styles.detectiveTitle}>DETECTIVE LOG</Text>
              {data.detectiveLog.map((l, li) => (
                <Text key={`dl-${li}`} style={styles.detectiveLine}>
                  {l}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.tagsWrap}>
            {data.strategy.map((t, ti) => (
              <View key={`st-${ti}`} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
          </View>

          {onShare ? (
            <Pressable
              onPress={onShare}
              style={({ pressed }) => [styles.shareBtn, { opacity: pressed ? 0.92 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Share or save report"
            >
              <Ionicons name="share-outline" size={18} color={DARK} />
              <Text style={styles.shareBtnText}>SHARE / SAVE</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kicker: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#94a3b8', letterSpacing: 1 },
  headline: { marginTop: 6, fontFamily: 'OutfitBlack', fontSize: 18, color: DARK, letterSpacing: -0.3 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { marginTop: 12, maxHeight: 520 },
  scrollContent: { paddingBottom: 6 },
  bodyText: { marginTop: 12, fontFamily: 'OutfitBold', fontSize: 13, color: SLATE, lineHeight: 19 },
  detectiveWrap: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(226, 232, 240, 0.7)' },
  detectiveTitle: { fontFamily: 'OutfitBlack', fontSize: 10, color: '#94a3b8', letterSpacing: 1 },
  detectiveLine: { marginTop: 8, fontFamily: 'OutfitBold', fontSize: 11, color: '#64748b', lineHeight: 16 },
  tagsWrap: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: APP_RADIUS,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: BG,
  },
  tagText: { fontFamily: 'OutfitBlack', fontSize: 11, color: DARK, letterSpacing: 0.2 },
  shareBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: APP_RADIUS,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  shareBtnText: { color: DARK, fontFamily: 'OutfitBlack', fontSize: 12, letterSpacing: 1 },
  loadingWrap: { marginTop: 18, paddingVertical: 18, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontFamily: 'OutfitBold', fontSize: 12, color: SLATE },
});

export type DailyAiReportOverlayProps = DailyAiReportProps & {
  /** Render only when true (dashboard controls this). */
  visible?: boolean;
  /** Optional style override for the card container. */
  cardContainerStyle?: ViewStyle;
};

export function DailyAiReportOverlay({
  visible,
  onDismiss,
  cardContainerStyle,
  ...reportProps
}: DailyAiReportOverlayProps) {
  if (!visible) return null;

  return (
    <View style={overlayStyles.root} pointerEvents="box-none">
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)' }} />

      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

      <View style={overlayStyles.center}>
        <View style={[overlayStyles.cardWrap, cardContainerStyle]}>
          <DailyAiReport onDismiss={onDismiss} {...reportProps} />
        </View>
      </View>
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  cardWrap: { width: '100%', maxWidth: 520, marginTop: 60 },
});

