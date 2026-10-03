/**
 * Copy for the demo's side panels (wide screens only).
 * Edit freely: this file is just text. First person is Stewart's voice.
 */

export const REPO_URL = 'https://github.com/Insightio-Prog/refluxio';

export const DEMO_NOTE =
  'This is a live demo with made-up sample data. The daily AI report runs on a small, limited budget, so if it pauses, everything else still works without any AI.';

export interface WriteupSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export const WRITEUP_TITLE = 'Refluxio';
export const WRITEUP_TAGLINE = 'Your personal GERD detective. Log what you eat and how you feel, and Claude hunts for the triggers.';

export const WRITEUP: WriteupSection[] = [
  {
    heading: 'What it does',
    paragraphs: [
      'Reflux is hard to pin down because the cause is rarely the last thing you ate. Refluxio keeps a diary of food, drink, symptoms, posture, sleep, pollen and more, then looks for the pattern behind your bad days.',
      'Each morning an AI "detective" reviews yesterday, keeps a list of suspects, raises or lowers its confidence as evidence builds, and eventually gives a verdict: confirmed trigger or confirmed safe, with a safe amount where it can.',
    ],
  },
  {
    heading: 'How it works',
    bullets: [
      'You log meals, snacks, drinks, medication, symptoms and environment (tight clothing, smoke, pollen) in a couple of taps.',
      'A daily report from Claude reads yesterday\'s logs against the suspect list and updates it. Claude keeps a memory of the case and builds on it over time.',
      'A risk engine turns confirmed findings and safe thresholds into a risk score for today, using what you\'ve eaten so far.',
      'A monthly review looks across 30 days for patterns the daily agent missed and prunes false suspects.',
      'A heatmap, patterns view and a GP summary PDF turn the data into something you can act on.',
    ],
  },
  {
    heading: 'How it was made',
    paragraphs: [
      'I\'m a chef, not a trained developer. I can read a bit of C#, and that\'s about it. I built Refluxio by working with Claude and Cursor: I decide what it should do and how it should feel, Claude and Cursor write the code, and I test it, break it and send it back.',
      'It started as something I wanted for myself. The skill I\'ve built is knowing what to ask for, spotting what\'s wrong and steering it until it works.',
    ],
  },
  {
    heading: 'The tech',
    bullets: [
      'Expo, React Native and TypeScript, exported to the web with expo-router.',
      'All data stays on your device (local storage). There is no account and no backend.',
      'Claude (Sonnet) through a small Cloudflare Worker. The prompts, model and limits live on the server, so the browser can only ask for a "daily" or "monthly" report.',
      'Zod validates everything the AI returns before it touches the app.',
    ],
  },
  {
    heading: 'What I\'d improve',
    bullets: [
      'Web barcode scanning. On the phone app the camera reads barcodes and looks up ingredients; on the web demo you search by name instead.',
      'Break up the very large screen files into smaller components.',
      'Tests for the risk engine and the AI response parsing.',
      'A proper backend with sync, so the diary follows you across devices.',
    ],
  },
];

export interface ScreenNote {
  title: string;
  body: string;
  tips?: string[];
}

/** Left panel: what the current screen is for. Matched against the route path. */
export const SCREEN_NOTES: Array<{ match: (path: string) => boolean; note: ScreenNote }> = [
  {
    match: (p) => p.startsWith('/onboarding'),
    note: {
      title: 'Getting started',
      body: 'On the phone you pick your suspect foods and how strongly you suspect them. In this demo you can skip straight to a made-up four-week history.',
      tips: ['Tap "Explore with four weeks of sample data" to see the app with a full diary.'],
    },
  },
  {
    match: (p) => p.includes('home') || p === '/' || p === '',
    note: {
      title: 'Today',
      body: 'Your risk score for today, your clear-day streak and a quick-log box for snacks, meals, meds, symptoms and environment.',
      tips: [
        'The risk score rises as you log foods the detective is suspicious of.',
        'Tap ADD NEW under MEALS to build a meal, or tap a favourite to log it fast.',
        'Open the Report tab to have Claude review yesterday.',
      ],
    },
  },
  {
    match: (p) => p.includes('report'),
    note: {
      title: 'Daily report',
      body: 'Each morning Claude reads yesterday\'s logs against the suspect list and writes a short report. Yesterday\'s is ready to read.',
      tips: [
        'Scroll down and tap "Run the live AI detective" to have Claude write a fresh one (about 20 seconds).',
        'Each visitor gets a few live reports a day, so please use them wisely.',
      ],
    },
  },
  {
    match: (p) => p.includes('patterns') || p.includes('heatmap'),
    note: {
      title: 'Patterns',
      body: 'A calendar heatmap of your worst and best days, what the detective has confirmed, and the environment view with pollen.',
      tips: ['Tap a day to read the case notes for it.'],
    },
  },
  {
    match: (p) => p.includes('diary'),
    note: {
      title: 'Diary',
      body: 'Everything you logged, newest first, grouped by day.',
    },
  },
  {
    match: (p) => p.includes('log') || p.includes('test-scan'),
    note: {
      title: 'Log a meal',
      body: 'Build a meal from items, set the amounts, and log it. Amounts feed the safe-threshold tracking.',
    },
  },
];
