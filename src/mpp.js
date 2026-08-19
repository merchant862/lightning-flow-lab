import { quoteRoute } from "./router.js";
import { RouteNotFoundError } from "./errors.js";

export function planMultiPartPayment(graph, request) {
  const amountMsat = Number(request.amountMsat);
  const maxParts = request.maxParts ?? 4;
  const minPartMsat = request.minPartMsat ?? 10_000;
  const workingGraph = graph.clone();
  const parts = [];
  let remaining = amountMsat;

  for (let index = 0; index < maxParts && remaining > 0; index += 1) {
    let attemptAmount = Math.ceil(remaining / (maxParts - index));
    attemptAmount = Math.max(minPartMsat, attemptAmount);
    attemptAmount = Math.min(attemptAmount, remaining);

    let route = null;
    while (attemptAmount >= minPartMsat && !route) {
      try {
        route = quoteRoute(workingGraph, { ...request, amountMsat: attemptAmount });
      } catch (error) {
        if (!(error instanceof RouteNotFoundError)) throw error;
        attemptAmount = Math.floor(attemptAmount / 2);
      }
    }

    if (!route) break;
    workingGraph.reserve(route);
    parts.push(route);
    remaining -= route.amountMsat;
  }

  if (remaining > 0) {
    throw new RouteNotFoundError("Unable to split payment across available liquidity", {
      requestedMsat: amountMsat,
      plannedMsat: amountMsat - remaining,
      remainingMsat: remaining
    });
  }

  return {
    source: request.source,
    target: request.target,
    amountMsat,
    totalDebitMsat: parts.reduce((sum, part) => sum + part.totalDebitMsat, 0),
    totalFeeMsat: parts.reduce((sum, part) => sum + part.totalFeeMsat, 0),
    parts
  };
}
