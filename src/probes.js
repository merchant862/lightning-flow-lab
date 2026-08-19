import { quoteRoute } from "./router.js";

export function probeRoute(graph, request) {
  const route = quoteRoute(graph, request);
  return { type: "dry_run_route_probe", wouldSettle: false, ...route };
}
