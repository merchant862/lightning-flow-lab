#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { ChannelGraph, formatMsat, planMultiPartPayment, quoteRoute } from "./index.js";

const args = parseArgs(process.argv.slice(2));

try {
  if (args.command !== "quote") {
    printUsage();
    process.exit(args.command ? 1 : 0);
  }

  const network = JSON.parse(await readFile(args.network, "utf8"));
  const graph = ChannelGraph.fromJSON(network);
  const request = {
    source: args.from,
    target: args.to,
    amountMsat: Number(args.amount),
    maxParts: Number(args.parts ?? 1)
  };

  const result =
    request.maxParts > 1 ? planMultiPartPayment(graph, request) : quoteRoute(graph, request);

  console.log(JSON.stringify(summarize(result), null, 2));
} catch (error) {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}

function summarize(result) {
  if (result.parts) {
    return {
      type: "multi_part_payment",
      parts: result.parts.length,
      amount: formatMsat(result.amountMsat),
      totalFee: formatMsat(result.totalFeeMsat),
      routes: result.parts.map((part) => part.hops.map((hop) => `${hop.from}->${hop.to}`))
    };
  }

  return {
    type: "single_path_payment",
    amount: formatMsat(result.amountMsat),
    totalDebit: formatMsat(result.totalDebitMsat),
    totalFee: formatMsat(result.totalFeeMsat),
    cltvDelta: result.totalCltvDelta,
    route: result.hops.map((hop) => ({
      channelId: hop.channelId,
      path: `${hop.from}->${hop.to}`,
      feeMsat: hop.feeMsat,
      outgoingMsat: hop.outgoingMsat
    }))
  };
}

function parseArgs(tokens) {
  const parsed = { command: tokens[0] };
  for (let index = 1; index < tokens.length; index += 2) {
    parsed[tokens[index].replace(/^--/, "")] = tokens[index + 1];
  }
  return parsed;
}

function printUsage() {
  console.log("Usage: ln-flow quote --network examples/sample-network.json --from treasury --to merchant --amount 250000 [--parts 2]");
}
