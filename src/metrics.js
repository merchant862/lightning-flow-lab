export function renderPrometheusMetrics({ graph, attempts = [], settlements = [] } = {}) {
  const channels = [...(graph?.channels?.values() ?? [])];
  const capacityMsat = channels.reduce((sum, channel) => sum + channel.capacityMsat, 0);
  const liquidityMsat = channels.reduce((sum, channel) => sum + (channel.balances[channel.node1] ?? 0), 0);
  const failures = attempts.filter((attempt) => attempt.success !== true && attempt.status !== "SUCCEEDED").length;
  const totalFeesMsat = settlements.reduce((sum, item) => sum + Number(item.totalFeeMsat ?? item.feeMsat ?? 0), 0);

  return [
    "# HELP lightning_flow_nodes Number of nodes in the imported graph.",
    "# TYPE lightning_flow_nodes gauge",
    metric("lightning_flow_nodes", graph?.nodes?.size ?? 0),
    "# HELP lightning_flow_channels Number of channels in the imported graph.",
    "# TYPE lightning_flow_channels gauge",
    metric("lightning_flow_channels", channels.length),
    "# HELP lightning_flow_capacity_msat Total channel capacity in millisatoshis.",
    "# TYPE lightning_flow_capacity_msat gauge",
    metric("lightning_flow_capacity_msat", capacityMsat),
    "# HELP lightning_flow_liquidity_msat Sum of one side of each channel's modelled liquidity.",
    "# TYPE lightning_flow_liquidity_msat gauge",
    metric("lightning_flow_liquidity_msat", liquidityMsat),
    "# HELP lightning_flow_payment_attempts Payment attempts observed.",
    "# TYPE lightning_flow_payment_attempts counter",
    metric("lightning_flow_payment_attempts", attempts.length),
    "# HELP lightning_flow_payment_failures Payment attempts that did not succeed.",
    "# TYPE lightning_flow_payment_failures counter",
    metric("lightning_flow_payment_failures", failures),
    "# HELP lightning_flow_settlement_fees_msat Total recorded settlement fees.",
    "# TYPE lightning_flow_settlement_fees_msat counter",
    metric("lightning_flow_settlement_fees_msat", totalFeesMsat)
  ].join("\n") + "\n";
}

function metric(name, value) {
  return `${name} ${Number.isFinite(value) ? value : 0}`;
}
