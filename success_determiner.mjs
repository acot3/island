const THRESHOLDS = {
  easy: 0.8,
  moderate: 0.6,
  hard: 0.35,
  extreme: 0.15,
};

export function determineSuccess(difficulty) {
  const threshold = THRESHOLDS[difficulty];
  const roll = Math.random();
  const success = roll < threshold;

  return { success, roll: Math.round(roll * 100), threshold: threshold * 100 };
}
