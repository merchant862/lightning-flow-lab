export function scoreRouteReliability(attempts = [], { now = Date.now(), halfLifeMs = 86_400_000 } = {}) {
  const channels = new Map();
  for (const attempt of attempts) {
    const success = attempt.success === true || attempt.status === "SUCCEEDED" || attempt.status === "success";
    const age = Math.max(0, now - toTimestamp(attempt.timestamp ?? attempt.createdAt ?? attempt.settledAt, now));
    const weight = Math.pow(0.5, age / halfLifeMs);
    for (const hop of attempt.route ?? []) {
      const state = channels.get(hop.channelId) ?? { weightedAttempts: 0, weightedSuccesses: 0, lastFailureCode: null };
      state.weightedAttempts += weight;
      if (success) state.weightedSuccesses += weight;
      else state.lastFailureCode = attempt.failureCode ?? "UNKNOWN";
      channels.set(hop.channelId, state);
    }
  }

  return [...channels.entries()]
    .map(([channelId, state]) => ({
      channelId,
      weightedAttempts: round(state.weightedAttempts),
      weightedSuccesses: round(state.weightedSuccesses),
      reliability: state.weightedAttempts === 0 ? 0 : round(state.weightedSuccesses / state.weightedAttempts, 4),
      lastFailureCode: state.lastFailureCode
    }))
    .sort((a, b) => a.reliability - b.reliability);
}

function toTimestamp(value, fallback) {
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
