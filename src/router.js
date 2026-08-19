import { RouteNotFoundError } from "./errors.js";

export function quoteRoute(graph, request) {
  const amountMsat = Number(request.amountMsat);
  const source = request.source;
  const target = request.target;
  const maxFeeMsat = request.maxFeeMsat ?? Number.MAX_SAFE_INTEGER;
  const ignoredChannels = new Set(request.ignoredChannels ?? []);

  if (!source || !target || !Number.isSafeInteger(amountMsat) || amountMsat <= 0) {
    throw new TypeError("source, target and positive integer amountMsat are required");
  }

  const settled = new Set();
  const best = new Map([[target, { requiredMsat: amountMsat, feeMsat: 0, cltvDelta: 0, next: null }]]);

  while (!settled.has(source)) {
    const current = pickUnsettled(best, settled);
    if (!current) break;
    settled.add(current.node);

    for (const edge of graph.incomingEdges(current.node)) {
      if (ignoredChannels.has(edge.channelId) || settled.has(edge.from)) continue;

      const downstream = best.get(current.node);
      const hop = priceHop(edge, downstream.requiredMsat);
      if (!hop.canCarry) continue;

      const candidate = {
        requiredMsat: hop.incomingMsat,
        feeMsat: hop.feeMsat + downstream.feeMsat,
        cltvDelta: edge.policy.cltvDelta + downstream.cltvDelta,
        next: {
          ...edge,
          incomingMsat: hop.incomingMsat,
          outgoingMsat: downstream.requiredMsat,
          feeMsat: hop.feeMsat
        }
      };

      const previous = best.get(edge.from);
      if (!previous || score(candidate) < score(previous)) {
        best.set(edge.from, candidate);
      }
    }
  }

  const sourceState = best.get(source);
  if (!sourceState || sourceState.feeMsat > maxFeeMsat) {
    throw new RouteNotFoundError("No route satisfies amount, fee, and liquidity constraints", {
      source,
      target,
      amountMsat,
      maxFeeMsat
    });
  }

  const hops = [];
  let cursor = source;
  while (cursor !== target) {
    const next = best.get(cursor)?.next;
    if (!next) {
      throw new RouteNotFoundError("Route reconstruction failed", { source, target });
    }
    hops.push(next);
    cursor = next.to;
  }

  return {
    source,
    target,
    amountMsat,
    totalDebitMsat: sourceState.requiredMsat,
    totalFeeMsat: sourceState.feeMsat,
    totalCltvDelta: sourceState.cltvDelta,
    hops
  };
}

export function settleRoute(graph, request) {
  const route = quoteRoute(graph, request);
  graph.reserve(route);
  return route;
}

function priceHop(edge, downstreamMsat) {
  const policy = edge.policy;
  const feeMsat = policy.baseFeeMsat + Math.ceil((downstreamMsat * policy.feeRatePpm) / 1_000_000);
  const incomingMsat = downstreamMsat + feeMsat;
  const canCarry =
    !policy.disabled &&
    downstreamMsat >= policy.minHtlcMsat &&
    downstreamMsat <= policy.maxHtlcMsat &&
    edge.liquidityMsat >= incomingMsat;

  return { canCarry, feeMsat, incomingMsat };
}

function score(state) {
  return state.requiredMsat + state.cltvDelta;
}

function pickUnsettled(best, settled) {
  let winner = null;
  for (const [node, state] of best.entries()) {
    if (settled.has(node)) continue;
    if (!winner || score(state) < score(winner.state)) winner = { node, state };
  }
  return winner;
}
