/**
 * utils/doctor-pdf.ts
 *
 * Builds the HTML string for the doctor-facing PDF summary.
 * Uses expo-print to render on-device — no server needed.
 *
 * Usage:
 *   import { buildDoctorPdfHtml, gatherPdfData } from '@/utils/doctor-pdf';
 *   const data = await gatherPdfData(fromIso, toIso);
 *   const html = buildDoctorPdfHtml(data, patientName);
 *   const { uri } = await Print.printToFileAsync({ html });
 *   await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
 */
 
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConfirmedItem } from '@/services/ai-service';
import type { MonthlyReviewReport } from '@/services/monthly-agent';
import type { LogItem } from '@/hooks/use-log-store';
 
// ─── Storage keys (mirrors ai-service.ts + monthly-agent.ts) ────────────────
 
const CONFIRMED_ITEMS_KEY = 'heartburn.confirmedItems.v1';
const MONTHLY_REVIEW_KEY = 'heartburn.monthlyReview.v1';
const DETECTIVE_SUMMARIES_KEY = 'heartburn.detectiveSummaries.v1';
const PENDING_INVESTIGATION_KEY = 'heartburn.pendingInvestigation.v1';
 
// ─── Types ───────────────────────────────────────────────────────────────────
 
export type PdfSymptomStats = {
  daysTracked: number;
  daysWithSymptoms: number;
  mostFrequentSymptom: string;
  avgSeverity: string;
};
 
export type PdfOpenQuestion = {
  question: string;
};
 
export type PdfData = {
  fromIso: string;
  toIso: string;
  confirmedTriggers: ConfirmedItem[];
  confirmedSafe: ConfirmedItem[];
  symptomStats: PdfSymptomStats;
  monthlyReviewSummary: string | null;
  detectiveConclusions: string[];
  openQuestions: PdfOpenQuestion[];
  protectiveFactors: string[];
};
 
// ─── Helpers ─────────────────────────────────────────────────────────────────
 
function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
 
function isoToTs(iso: string): number {
  return new Date(iso + 'T00:00:00').getTime();
}
 
function formatIso(iso: string): string {
  // "2025-04-01" → "1 Apr 2025"
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
 
function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
 
// ─── Data gathering ──────────────────────────────────────────────────────────
 
async function getConfirmedItems(): Promise<ConfirmedItem[]> {
  const raw = await AsyncStorage.getItem(CONFIRMED_ITEMS_KEY);
  const parsed = safeJsonParse<unknown[]>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (x): x is ConfirmedItem =>
      !!x &&
      typeof (x as any).id === 'string' &&
      typeof (x as any).label === 'string' &&
      typeof (x as any).verdict === 'string'
  );
}
 
async function getMonthlyReview(): Promise<MonthlyReviewReport | null> {
  const raw = await AsyncStorage.getItem(MONTHLY_REVIEW_KEY);
  const parsed = safeJsonParse<unknown>(raw, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as any;
  if (typeof r.summary !== 'string') return null;
  return r as MonthlyReviewReport;
}
 
async function getDetectiveConclusions(fromIso: string, toIso: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DETECTIVE_SUMMARIES_KEY);
  const parsed = safeJsonParse<Record<string, any>>(raw, {});
  const conclusions: string[] = [];
  for (const [dayIso, summary] of Object.entries(parsed)) {
    if (dayIso < fromIso || dayIso > toIso) continue;
    if (Array.isArray(summary?.caseNotes)) {
      for (const note of summary.caseNotes) {
        if (typeof note === 'string' && note.trim()) conclusions.push(note.trim());
      }
    }
  }
  // Deduplicate and cap at 6 most recent
  const unique = [...new Set(conclusions)];
  return unique.slice(-6);
}
 
async function getOpenQuestions(): Promise<PdfOpenQuestion[]> {
  const raw = await AsyncStorage.getItem(PENDING_INVESTIGATION_KEY);
  const parsed = safeJsonParse<any>(raw, null);
  if (!parsed?.openQuestions || !Array.isArray(parsed.openQuestions)) return [];
  const now = Date.now();
  return parsed.openQuestions
    .filter((q: any) => !q.answered && typeof q.expiresAtTs === 'number' && q.expiresAtTs > now)
    .map((q: any) => ({ question: q.question as string }));
}
 
/**
 * Computes symptom stats from the raw logs array passed in from the log store.
 * Call this from the component so we don't duplicate storage reads.
 */
export function computeSymptomStats(
  logs: LogItem[],
  fromIso: string,
  toIso: string
): PdfSymptomStats {
  const fromTs = isoToTs(fromIso);
  const toTs = isoToTs(toIso) + 86400000; // inclusive end
 
  const inRange = logs.filter((l) => l.createdAt >= fromTs && l.createdAt < toTs);
  const symptomLogs = inRange.filter((l) => l.type === 'symptom');
 
  // Days tracked = distinct calendar days with any log
  const allDays = new Set(inRange.map((l) => new Date(l.createdAt).toISOString().slice(0, 10)));
  const symptomDays = new Set(symptomLogs.map((l) => new Date(l.createdAt).toISOString().slice(0, 10)));
 
  // Most frequent symptom label
  const freq: Record<string, number> = {};
  for (const l of symptomLogs) {
    const key = l.key ?? 'Unknown';
    freq[key] = (freq[key] ?? 0) + 1;
  }
  const mostFrequentSymptom =
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
 
  // Average severity
  const severityScore = (s: string | undefined) => {
    if (s === 'severe') return 3;
    if (s === 'moderate') return 2;
    if (s === 'mild') return 1;
    return 0;
  };
  const withSeverity = symptomLogs.filter((l) => l.symptomSeverity);
  const avgScore =
    withSeverity.length > 0
      ? withSeverity.reduce((acc, l) => acc + severityScore(l.symptomSeverity), 0) / withSeverity.length
      : 0;
  const avgSeverity =
    avgScore >= 2.5 ? 'Severe' : avgScore >= 1.5 ? 'Moderate' : avgScore >= 0.5 ? 'Mild' : '—';
 
  return {
    daysTracked: allDays.size,
    daysWithSymptoms: symptomDays.size,
    mostFrequentSymptom,
    avgSeverity,
  };
}
 
/**
 * Gather all data needed for the PDF.
 * Pass logs in from the component (already in memory from the log store).
 */
export async function gatherPdfData(
  logs: LogItem[],
  fromIso: string,
  toIso: string
): Promise<PdfData> {
  const [allConfirmed, monthlyReview, detectiveConclusions, openQuestions] = await Promise.all([
    getConfirmedItems(),
    getMonthlyReview(),
    getDetectiveConclusions(fromIso, toIso),
    getOpenQuestions(),
  ]);
 
  const confirmedTriggers = allConfirmed
    .filter((i) => i.verdict === 'confirmed-trigger')
    .sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0))
    .slice(0, 8);
 
  const confirmedSafe = allConfirmed.filter((i) => i.verdict === 'confirmed-safe');
 
  const protectiveFactors = monthlyReview?.protectiveFactors ?? [];
 
  const symptomStats = computeSymptomStats(logs, fromIso, toIso);
 
  return {
    fromIso,
    toIso,
    confirmedTriggers,
    confirmedSafe,
    symptomStats,
    monthlyReviewSummary: monthlyReview?.summary ?? null,
    detectiveConclusions,
    openQuestions,
    protectiveFactors,
  };
}
 
// ─── HTML template ────────────────────────────────────────────────────────────
 
export function buildDoctorPdfHtml(data: PdfData, patientName?: string): string {
  const {
    fromIso,
    toIso,
    confirmedTriggers,
    confirmedSafe,
    symptomStats,
    monthlyReviewSummary,
    detectiveConclusions,
    openQuestions,
    protectiveFactors,
  } = data;
 
  const dateRange = `${formatIso(fromIso)} – ${formatIso(toIso)}`;
  const generatedDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const nameRow = patientName?.trim()
    ? `<span class="meta-name">${patientName.trim()}</span> · `
    : '';
 
  // Trigger rows
  const triggerRows =
    confirmedTriggers.length > 0
      ? confirmedTriggers
          .map((t) => {
            const confidence = typeof t.occurrences === 'number'
              ? `${t.occurrences} occasion${t.occurrences !== 1 ? 's' : ''}`
              : '—';
            const shortReason = t.reason?.length > 80
              ? t.reason.slice(0, 77) + '…'
              : (t.reason ?? '—');
            return `
              <tr>
                <td class="td-label">${capitalise(t.label)}</td>
                <td class="td-center">${confidence}</td>
                <td class="td-reason">${shortReason}</td>
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="3" class="td-empty">No confirmed triggers yet — tracking in progress.</td></tr>`;
 
  // Safe items
  const safeList =
    confirmedSafe.length > 0
      ? confirmedSafe.map((i) => capitalise(i.label)).join(', ')
      : 'None confirmed yet.';
 
  // Protective factors
  const protectiveList =
    protectiveFactors.length > 0
      ? protectiveFactors.map((f) => `<li>${capitalise(f)}</li>`).join('')
      : '<li>Not yet identified.</li>';
 
  // Detective conclusions
  const conclusionItems =
    detectiveConclusions.length > 0
      ? detectiveConclusions.map((c) => `<li>${c}</li>`).join('')
      : '<li>Insufficient data in this date range.</li>';
 
  // Open questions
  const openQuestionsBlock =
    openQuestions.length > 0
      ? `
        <div class="section">
          <h2 class="section-title">Open Questions</h2>
          <p class="section-note">Patterns the AI has flagged but not yet confirmed — may be worth exploring.</p>
          <ul class="open-questions">
            ${openQuestions.map((q) => `<li>${q.question}</li>`).join('')}
          </ul>
        </div>`
      : '';
 
  // AI summary block
  const aiSummaryBlock = monthlyReviewSummary
    ? `
      <div class="section">
        <h2 class="section-title">AI Summary</h2>
        <p class="summary-text">${monthlyReviewSummary}</p>
      </div>`
    : '';
 
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Refluxio Health Summary</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
 
    * { box-sizing: border-box; margin: 0; padding: 0; }
 
    body {
      font-family: 'Outfit', Arial, sans-serif;
      font-size: 13px;
      color: #1e293b;
      background: #ffffff;
      padding: 36px 40px 48px;
      max-width: 720px;
      margin: 0 auto;
    }
 
    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .header-left {}
    .app-name {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.3px;
    }
    .app-tagline {
      font-size: 11px;
      color: #64748b;
      margin-top: 2px;
    }
    .header-right {
      text-align: right;
      font-size: 11px;
      color: #64748b;
      line-height: 1.6;
    }
    .meta-name { font-weight: 600; color: #0f172a; }
 
    /* ── Stat strip ── */
    .stat-strip {
      display: flex;
      gap: 12px;
      margin-bottom: 22px;
    }
    .stat-card {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1;
    }
    .stat-label {
      font-size: 10px;
      color: #64748b;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .stat-card.highlight .stat-value { color: #991b1b; }
 
    /* ── Sections ── */
    .section {
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #64748b;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
    }
    .section-note {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 8px;
    }
 
    /* ── Trigger table ── */
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead th {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #64748b;
      text-align: left;
      padding: 6px 10px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    .td-label {
      font-weight: 600;
      color: #0f172a;
      width: 30%;
    }
    .td-center {
      color: #475569;
      width: 18%;
      font-size: 12px;
    }
    .td-reason {
      color: #64748b;
      font-size: 12px;
      width: 52%;
    }
    .td-empty {
      color: #94a3b8;
      font-style: italic;
      padding: 10px;
    }
 
    /* ── Safe items ── */
    .safe-text {
      color: #475569;
      line-height: 1.6;
    }
    .safe-label { font-weight: 500; color: #2d6a4f; }
 
    /* ── Lists ── */
    ul.bullet-list, ul.open-questions {
      padding-left: 18px;
    }
    ul.bullet-list li, ul.open-questions li {
      margin-bottom: 5px;
      line-height: 1.5;
      color: #475569;
    }
    ul.open-questions li {
      color: #64748b;
      font-style: italic;
    }
 
    /* ── AI summary ── */
    .summary-text {
      line-height: 1.65;
      color: #334155;
    }
 
    /* ── Footer ── */
    .footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 10px;
      color: #94a3b8;
      text-align: center;
      line-height: 1.6;
    }
 
    /* ── Two-column layout for safe + protective ── */
    .two-col {
      display: flex;
      gap: 20px;
    }
    .two-col .col { flex: 1; }
  </style>
</head>
<body>
 
  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="app-name">Refluxio</div>
      <div class="app-tagline">Personal GERD &amp; Heartburn Tracker</div>
    </div>
    <div class="header-right">
      ${nameRow}${dateRange}<br/>
      Generated ${generatedDate}<br/>
      <em>Prepared for GP appointment</em>
    </div>
  </div>
 
  <!-- Stat strip -->
  <div class="stat-strip">
    <div class="stat-card">
      <div class="stat-value">${symptomStats.daysTracked}</div>
      <div class="stat-label">Days Tracked</div>
    </div>
    <div class="stat-card highlight">
      <div class="stat-value">${symptomStats.daysWithSymptoms}</div>
      <div class="stat-label">Days with Symptoms</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${symptomStats.mostFrequentSymptom}</div>
      <div class="stat-label">Most Frequent Symptom</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${symptomStats.avgSeverity}</div>
      <div class="stat-label">Avg Severity</div>
    </div>
  </div>
 
  <!-- Confirmed triggers -->
  <div class="section">
    <h2 class="section-title">Confirmed Triggers</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Occurrences</th>
          <th>Pattern noted</th>
        </tr>
      </thead>
      <tbody>
        ${triggerRows}
      </tbody>
    </table>
  </div>
 
  <!-- Safe items + Protective factors (two columns) -->
  <div class="two-col">
    <div class="col">
      <div class="section">
        <h2 class="section-title">Confirmed Safe</h2>
        <p class="safe-text">${safeList}</p>
      </div>
    </div>
    <div class="col">
      <div class="section">
        <h2 class="section-title">What's Helping</h2>
        <ul class="bullet-list">${protectiveList}</ul>
      </div>
    </div>
  </div>
 
  <!-- AI Summary -->
  ${aiSummaryBlock}
 
  <!-- Detective conclusions -->
  <div class="section">
    <h2 class="section-title">Key Findings</h2>
    <ul class="bullet-list">${conclusionItems}</ul>
  </div>
 
  <!-- Open questions -->
  ${openQuestionsBlock}
 
  <!-- Footer -->
  <div class="footer">
    Data collected via the Refluxio personal health tracking app &nbsp;·&nbsp;
    This report is generated from self-reported data and AI analysis &nbsp;·&nbsp;
    Not a medical diagnosis &nbsp;·&nbsp; insightio.co.uk
  </div>
 
</body>
</html>`;
}