export function analyzePaymentFailures(attempts) {
  const channels = new Map();
  const reasons = new Map();

  for (const attempt of attempts) {
    bump(reasons, attempt.failureCode ?? "UNKNOWN");
    for (const channelId of attempt.route?.map((hop) => hop.channelId) ?? []) {
      const state = channels.get(channelId) ?? { failures: 0, lastFailureCode: null };
      state.failures += 1;
      state.lastFailureCode = attempt.failureCode ?? "UNKNOWN";
      channels.set(channelId, state);
    }
  }

  const riskyChannels = [...channels.entries()]
    .map(([channelId, value]) => ({ channelId, ...value }))
    .sort((a, b) => b.failures - a.failures);

  return {
    attempts: attempts.length,
    failureCodes: Object.fromEntries(reasons),
    riskyChannels,
    recommendation: recommend(riskyChannels, reasons)
  };
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function recommend(riskyChannels, reasons) {
  if ((reasons.get("TEMPORARY_CHANNEL_FAILURE") ?? 0) > 0 && riskyChannels.length > 0) {
    return `Temporarily down-rank ${riskyChannels[0].channelId} and probe alternative liquidity.`;
  }
  if ((reasons.get("FEE_INSUFFICIENT") ?? 0) > 0) {
    return "Refresh channel policies before retrying; fee cache is likely stale.";
  }
  return "Keep collecting attempts; no dominant failure pattern detected yet.";
}
