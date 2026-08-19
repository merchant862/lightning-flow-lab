export function recommendChannelPolicies(graph, { imbalanceThreshold = 0.2, minCapacityMsat = 1 } = {}) {
  const recommendations = [];
  for (const channel of graph?.channels?.values() ?? []) {
    if (channel.capacityMsat < minCapacityMsat) continue;
    const firstBalance = channel.balances[channel.node1] ?? 0;
    const ratio = firstBalance / channel.capacityMsat;
    if (ratio <= imbalanceThreshold) {
      recommendations.push({ channelId: channel.id, node: channel.node1, action: "increase_fee_or_rebalance_outbound", rationale: `${channel.node1} holds ${(ratio * 100).toFixed(1)}% of modelled capacity.` });
    } else if (ratio >= 1 - imbalanceThreshold) {
      recommendations.push({ channelId: channel.id, node: channel.node2, action: "increase_fee_or_rebalance_outbound", rationale: `${channel.node2} has limited outbound liquidity in the model.` });
    }
  }
  return recommendations;
}
