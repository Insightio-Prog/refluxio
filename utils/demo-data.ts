/**
 * Sample data for the public web demo.
 *
 * Builds four weeks of believable (completely made-up) logs plus the "memory"
 * the AI detective would have built up from them: suspects, confirmed findings,
 * day summaries and past reports, including a hand-written one for yesterday.
 * Visitors can still run the live AI on yesterday from the report screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { demoPollenForDay } from '@/utils/pollen-service';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_BACK = 28;

type Sev = 'mild' | 'moderate' | 'severe';
type Pos = 'Seated (Upright)' | 'Seated (Slouched)' | 'Upright / Standing' | 'Lying Down (Lying Flat)' | 'Lying Down (Elevated)';

type DemoLog = {
  id: string;
  createdAt: number;
  type: string;
  key: string;
  symptomSeverity?: Sev;
  bodyPosition?: Pos;
};

// Small seeded random generator so every visitor gets the same story.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function isoDay(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function at(dayStart: number, hour: number, minute = 0) {
  return dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
}

type DaySummary = { dayIso: string; topIngredient: string; caseNotes: string[]; tip?: string; score: 0 | 1 | 2 | 3 };

const SAFE_BREAKFASTS = ['Porridge (60g)', 'Scrambled eggs on toast (1x)', 'Banana (1x)', 'Greek yoghurt (150g)'];
const SAFE_LUNCHES = ['Chicken salad sandwich (1x)', 'Jacket potato with beans (1x)', 'Chicken and rice (350g)', 'Vegetable soup (300ml)'];
const SAFE_DINNERS = ['Baked salmon with potatoes (400g)', 'Roast chicken dinner (450g)', 'Omelette and salad (1x)', 'Shepherd’s pie (400g)'];
const TRIGGER_DINNERS = [
  { key: 'Chicken tikka masala (450g)', culprit: 'Spicy curry' },
  { key: 'Spaghetti bolognese (400g)', culprit: 'Tomato sauce' },
  { key: 'Pepperoni pizza (1x)', culprit: 'Tomato sauce' },
  { key: 'Chilli con carne (400g)', culprit: 'Spicy chilli' },
];

// back = days ago. Yesterday (1) is a spicy-curry evening so the live report has something to find.
const RECENT_SCRIPT: Record<number, { coffee: boolean; trigger: boolean; late: boolean; sev?: Sev }> = {
  1: { coffee: true, trigger: true, late: false, sev: 'moderate' },
  2: { coffee: false, trigger: false, late: false },
  3: { coffee: false, trigger: false, late: false },
  4: { coffee: true, trigger: false, late: false },
  5: { coffee: false, trigger: true, late: true, sev: 'severe' },
  6: { coffee: false, trigger: false, late: false },
  7: { coffee: false, trigger: false, late: false },
};

export function buildDemoLogs(nowTs = Date.now()): { logs: DemoLog[]; summaries: DaySummary[] } {
  const rand = rng(20261003);
  const todayStart = new Date(nowTs);
  todayStart.setHours(0, 0, 0, 0);
  const logs: DemoLog[] = [];
  const summaries: DaySummary[] = [];
  let id = 0;
  const add = (ts: number, type: string, key: string, extra: Partial<DemoLog> = {}) => {
    logs.push({ id: `demo-${++id}`, createdAt: ts, type, key, ...extra });
  };

  for (let back = DAYS_BACK; back >= 1; back -= 1) {
    const dayStart = todayStart.getTime() - back * DAY_MS;
    const dow = new Date(dayStart).getDay(); // 0 = Sunday
    const weekend = dow === 0 || dow === 6;
    const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

    // Early on the story is rougher; the last two weeks improve as triggers are spotted.
    const earlyWeeks = back > 14;
    // The most recent week is scripted so the screens show a clear, readable story.
    const script = RECENT_SCRIPT[back];
    const bigCoffee = script ? script.coffee : rand() < (earlyWeeks ? 0.55 : 0.2);
    const triggerDinner = script ? script.trigger : rand() < (earlyWeeks ? 0.45 : 0.18);
    const lateMeal = script ? script.late : rand() < (earlyWeeks ? 0.35 : 0.12);
    const chocolate = rand() < 0.22;
    const tight = rand() < 0.12;
    const highPollen = ['high', 'very_high'].includes(demoPollenForDay(dayStart + 12 * 3600 * 1000).grass);

    // Breakfast and coffee
    add(at(dayStart, weekend ? 9 : 7, 20 + Math.floor(rand() * 20)), 'meal', pick(SAFE_BREAKFASTS), {
      bodyPosition: 'Seated (Upright)',
    });
    add(at(dayStart, weekend ? 9 : 7, 40), 'drink', bigCoffee ? 'Coffee (350ml)' : 'Coffee (150ml)');
    // Lunch
    add(at(dayStart, 12, 30 + Math.floor(rand() * 30)), 'meal', pick(SAFE_LUNCHES), {
      bodyPosition: weekend ? 'Seated (Slouched)' : 'Seated (Upright)',
    });
    if (rand() < 0.5) add(at(dayStart, 15, 10), 'snack', pick(['Apple (1x)', 'Rice cakes (2x)', 'Handful of almonds (30g)']));
    if (chocolate) add(at(dayStart, 20, 15), 'snack', 'Milk chocolate (40g)');
    // Dinner
    let culprit: string | null = null;
    const dinnerHour = lateMeal ? 21 : 18;
    if (triggerDinner) {
      const dinner = back === 1 ? TRIGGER_DINNERS[0] : pick(TRIGGER_DINNERS);
      culprit = dinner.culprit;
      add(at(dayStart, dinnerHour, 15), 'meal', dinner.key, {
        bodyPosition: lateMeal ? 'Lying Down (Lying Flat)' : 'Seated (Slouched)',
      });
    } else {
      add(at(dayStart, dinnerHour, 15), 'meal', pick(SAFE_DINNERS), {
        bodyPosition: lateMeal ? 'Seated (Slouched)' : 'Seated (Upright)',
      });
    }
    if (tight && !script) add(at(dayStart, 13, 0), 'environment', 'Tight clothing / Belt');
    if (!script && rand() < 0.1) add(at(dayStart, 17, 0), 'environment', 'Intense / Core workout');

    // Symptoms
    let worst = 0;
    const notes: string[] = [];
    const symptom = (hour: number, minute: number, key: string, sev: Sev) => {
      add(at(dayStart, hour, minute), 'symptom', key, { symptomSeverity: sev });
      worst = Math.max(worst, sev === 'severe' ? 3 : sev === 'moderate' ? 2 : 1);
    };
    if (triggerDinner && (script || rand() < 0.85)) {
      const sev: Sev = script?.sev ?? (lateMeal ? 'severe' : rand() < 0.5 ? 'moderate' : 'mild');
      symptom(dinnerHour + 1, 20, 'Chest Pain', sev);
      notes.push(`${culprit} at ${dinnerHour}:15 was followed by ${sev} chest pain within two hours.`);
      if (lateMeal) notes.push('Dinner was late and eaten lying down, so gravity could not help.');
    }
    if (bigCoffee && !script && rand() < 0.5) {
      symptom(9, 30, 'Chest Pain', 'mild');
      notes.push('A large 350ml coffee on an empty-ish stomach was followed by mild discomfort.');
    }
    if (highPollen && !script && rand() < 0.7) {
      symptom(14, 0, 'Sneezing', 'mild');
      symptom(14, 45, 'Throat Clear', 'mild');
      notes.push('High grass pollen. Sneezing and throat clearing, likely environmental rather than food.');
    }
    if (tight && worst > 0 && rand() < 0.6) {
      notes.push('Tight clothing was logged, a possible mechanical contributor.');
    }
    if (worst === 0) notes.push(`Clear day. Ate ${logs.filter((l) => l.createdAt >= dayStart && l.type === 'meal').length} regular meals with no symptoms.`);

    summaries.push({
      dayIso: isoDay(dayStart),
      topIngredient: culprit ?? (bigCoffee ? 'Coffee' : '—'),
      caseNotes: notes.slice(0, 4),
      tip:
        worst >= 2
          ? 'Keep tonight’s meal early, plain and upright. A short walk after eating helps gravity do its job.'
          : worst === 1
            ? 'A smaller coffee and an upright posture after meals have worked well on calmer days.'
            : 'Nothing to change. Repeat what worked today.',
      score: worst as 0 | 1 | 2 | 3,
    });
  }

  return { logs: logs.sort((a, b) => b.createdAt - a.createdAt), summaries };
}

function cannedReport(summary: DaySummary) {
  const worst = summary.score;
  return {
    headline: 'The Gut Check',
    body:
      worst === 0
        ? 'A quiet day for your gut. Everything you ate stayed comfortable, which adds to the evidence for your safe list.'
        : worst === 1
          ? `A mild day. ${summary.caseNotes[0] ?? 'Small symptoms showed up, nothing alarming.'} Worth keeping an eye on, but not a worry yet.`
          : `A rougher day. ${summary.caseNotes[0] ?? 'Symptoms followed the evening meal.'} The pattern is getting clearer, which is progress.`,
    detectiveLog: [
      worst === 0
        ? 'Everything logged sat comfortably today, so the safe-food evidence keeps building.'
        : `${summary.caseNotes.join(' ')} I have nudged ${summary.topIngredient === '—' ? 'the watch list' : summary.topIngredient.toLowerCase()} up the suspect list.`,
    ],
    strategy: ['Keep dinner earlier and upright', 'Coffee: small and with food'],
  };
}

export async function loadDemoData(nowTs = Date.now()): Promise<void> {
  const { logs, summaries } = buildDemoLogs(nowTs);
  const today = new Date(nowTs);
  today.setHours(0, 0, 0, 0);
  const firstUse = new Date(today.getTime() - DAYS_BACK * DAY_MS);

  const detectiveSummaries = Object.fromEntries(summaries.map((s) => [s.dayIso, s]));

  // Every day gets a ready-made report. Yesterday's is hand-written so the demo
  // opens on a good one; visitors can still run the live AI on it.
  const yesterdayIso = isoDay(today.getTime() - DAY_MS);
  const reportCache: Record<string, unknown> = Object.fromEntries(
    summaries.map((s) => [s.dayIso, cannedReport(s)])
  );
  reportCache[yesterdayIso] = {
    headline: 'The Gut Check',
    body:
      "Moderate chest pain at 18:20 came about an hour after last night's chicken tikka masala, eaten while slouched on the sofa. " +
      'Spicy food now has 7 occurrences and my confidence is climbing, though I need to know how hot the curry was before I call it. ' +
      'Your morning coffee was small and sat comfortably, which is good news for your safe list.',
    detectiveLog: [
      'Greek yoghurt at breakfast and the chicken and rice at lunch (eaten upright, well timed) caused no trouble at all.',
      'The evening is where things unravelled: curry at 17:15, a slouched posture and symptoms by 18:20. Posture plus spice is a classic double hit.',
      'I have moved spicy foods up the suspect list, and I am holding off on a verdict until I hear how hot the curry was.',
    ],
    strategy: [
      'Eat the evening meal earlier and sit upright for an hour afterwards',
      'Try the same curry mild next time, to test whether the heat or the posture is the trigger',
      'Keep coffee small and with food',
    ],
    needMoreInfo: { question: 'Was the curry mild or hot?' },
  };

  const pollenHistory = summaries.map((s) => {
    const p = demoPollenForDay(new Date(`${s.dayIso}T12:00:00`).getTime());
    return { dayIso: s.dayIso, ...p };
  });

  const potentialTriggers = [
    { id: 'coffee', label: 'Coffee', strikeCount: 6, status: 'high', lastSeenTs: nowTs - 3 * DAY_MS },
    { id: 'tomato-sauce', label: 'Tomato sauce', strikeCount: 4, status: 'high', lastSeenTs: nowTs - 5 * DAY_MS },
    { id: 'spicy-foods', label: 'Spicy foods', strikeCount: 5, status: 'medium', lastSeenTs: nowTs - 4 * DAY_MS },
    { id: 'chocolate', label: 'Chocolate', strikeCount: 1, status: 'low', lastSeenTs: nowTs - 9 * DAY_MS },
    { id: 'citrus', label: 'Citrus', strikeCount: 0, status: 'low' },
  ];

  const pendingInvestigation = {
    schemaVersion: 1,
    updatedAtTs: nowTs - 2 * DAY_MS,
    items: [
      { id: 'tomato-sauce', label: 'Tomato sauce', occurrences: 5, confidence: 0.64 },
      { id: 'spicy-foods', label: 'Spicy foods', occurrences: 6, confidence: 0.58, needMoreInfo: true, question: 'Was the curry mild or hot?' },
      { id: 'chocolate', label: 'Chocolate', occurrences: 6, confidence: 0.12, safeThreshold: '40g', testedSafe: false },
    ],
    openQuestions: [],
  };

  const confirmedItems = [
    { id: 'coffee', label: 'Coffee', verdict: 'confirmed-trigger', confirmedAtTs: nowTs - 10 * DAY_MS, reason: 'Symptoms followed 350ml coffees on 6 of 8 occasions.', occurrences: 8 },
    { id: 'porridge', label: 'Porridge', verdict: 'confirmed-safe', confirmedAtTs: nowTs - 8 * DAY_MS, reason: 'Eaten 12 times with no symptoms. Safe up to 60g.', safeThreshold: '60g', occurrences: 12 },
  ];

  const protectiveFactors = [
    { id: 'early-dinner', label: 'Early dinner', confirmedAtTs: nowTs - 7 * DAY_MS, monthLabel: 'September 2026', appearedInReviews: 1 },
    { id: 'upright-after-meals', label: 'Upright after meals', confirmedAtTs: nowTs - 7 * DAY_MS, monthLabel: 'September 2026', appearedInReviews: 1 },
  ];

  const monthlyReview = {
    generatedAtTs: nowTs - 7 * DAY_MS,
    summary:
      'Your month improved markedly once the late evening meals stopped. Heartburn clustered around large coffees and tomato or spice-heavy dinners.',
    topPattern: 'Symptoms were most frequent within two hours of dinners eaten after 8pm.',
    newlyConfirmed: ['Coffee'],
    removed: ['Citrus'],
    protectiveFactors: ['Early dinner', 'Upright after meals'],
    clearDays: summaries.filter((s) => s.score === 0).length,
    worstTrigger: 'Tomato sauce',
    monthLabel: 'September 2026',
  };

  const favorites = [
    { id: 'fav-1', name: 'Porridge', type: 'food', category: 'meal', usualPortion: 60, riskLevel: 'low' },
    { id: 'fav-2', name: 'Coffee', type: 'drink', category: 'snack', usualPortion: 150, riskLevel: 'high' },
    { id: 'fav-3', name: 'Banana', type: 'food', category: 'snack', usualPortion: 1, riskLevel: 'low' },
  ];

  await AsyncStorage.multiSet([
    ['heartburnDiary.logs.v1', JSON.stringify(logs)],
    ['heartburn.potentialTriggers.v1', JSON.stringify(potentialTriggers)],
    ['heartburn.pendingInvestigation.v1', JSON.stringify(pendingInvestigation)],
    ['heartburn.confirmedItems.v1', JSON.stringify(confirmedItems)],
    ['heartburn.detectiveSummaries.v1', JSON.stringify(detectiveSummaries)],
    ['heartburn.dailyReportCache.v1', JSON.stringify(reportCache)],
    ['heartburn.pollenHistory.v1', JSON.stringify(pollenHistory)],
    ['heartburn.protectiveFactors.v1', JSON.stringify(protectiveFactors)],
    ['heartburn.monthlyReview.v1', JSON.stringify(monthlyReview)],
    ['heartburn.lastMonthlyRun.v1', String(nowTs - 7 * DAY_MS)],
    ['heartburn.favorites.v1', JSON.stringify(favorites)],
    ['heartburn.onboardingNote.v1', 'Sample user: 40s, reflux mostly in the evenings, trying to work out which foods and habits set it off.'],
    ['heartburn.firstUseDate.v1', firstUse.toISOString()],
    ['heartburn.hasCompletedOnboarding.v1', 'true'],
  ]);
}
