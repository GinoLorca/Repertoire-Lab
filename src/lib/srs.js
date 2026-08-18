// Spaced repetition on the MoveTrainer ladder. A correct run moves a line up
// one tier, so reviews spread further apart; a mistake drops it back to the
// bottom tier, so you see it again in a few hours.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const LEVELS = [
  { label: '4 hours', ms: 4 * HOUR_MS },
  { label: '12 hours', ms: 12 * HOUR_MS },
  { label: '3 days', ms: 3 * DAY_MS },
  { label: '1 week', ms: 7 * DAY_MS },
  { label: '2 weeks', ms: 14 * DAY_MS },
  { label: '1 month', ms: 30 * DAY_MS },
  { label: '3 months', ms: 90 * DAY_MS },
  { label: '6 months', ms: 180 * DAY_MS },
];

export const TOP_LEVEL = LEVELS.length;

// success = finished the line with no mistakes.
export function schedule(prevSrs, success) {
  const level = prevSrs?.level ?? 0; // 0 = never reviewed
  const nextLevel = success ? Math.min(level + 1, TOP_LEVEL) : 1;
  const interval = LEVELS[nextLevel - 1].ms;
  return {
    level: nextLevel,
    due: Date.now() + interval,
    interval,
    reviews: (prevSrs?.reviews ?? 0) + 1,
    // Clean runs are what "practiced" means for the green marker.
    successes: (prevSrs?.successes ?? 0) + (success ? 1 : 0),
    lapses: (prevSrs?.lapses ?? 0) + (success ? 0 : 1),
    lastReview: Date.now(),
    lastResult: success ? 'pass' : 'fail',
  };
}

export function levelLabel(srs) {
  const level = srs?.level ?? 0;
  if (!level) return 'new';
  return `L${level}`;
}

export function intervalLabel(srs) {
  const level = srs?.level ?? 0;
  if (!level) return null;
  return LEVELS[Math.min(level, TOP_LEVEL) - 1].label;
}

// "in 3 days" / "due now" — how long until this line comes back.
export function dueLabel(variation, now = Date.now()) {
  const due = variation?.srs?.due;
  if (!variation?.learned || !due) return null;
  const ms = due - now;
  if (ms <= 0) return 'due now';
  const hours = ms / HOUR_MS;
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60000))} min`;
  if (hours < 24) return `in ${Math.round(hours)} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `in ${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return `in ${months} month${months === 1 ? '' : 's'}`;
}

export function isDue(variation) {
  if (!variation.learned) return false;
  return (variation.srs?.due ?? 0) <= Date.now();
}

// Green means: taught at least once *and* recalled cleanly at least once.
export function isPracticed(variation) {
  return !!variation?.learned && (variation.srs?.successes ?? 0) > 0;
}

export function dueCount(chapter) {
  return chapter.variations.filter(isDue).length;
}

export function unlearnedCount(chapter) {
  return chapter.variations.filter((v) => !v.learned).length;
}

export function learnedCount(chapter) {
  return chapter.variations.filter((v) => v.learned).length;
}

export function practicedCount(chapter) {
  return chapter.variations.filter(isPracticed).length;
}

// A chapter is green when everything inside it is.
export function chapterPracticed(chapter) {
  return chapter.variations.length > 0 && chapter.variations.every(isPracticed);
}

export function openingPracticed(opening) {
  const chapters = opening.chapters.filter((c) => c.variations.length > 0);
  return chapters.length > 0 && chapters.every(chapterPracticed);
}
