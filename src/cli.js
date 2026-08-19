#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  ChannelGraph,
  CoreLightningClient,
  EclairClient,
  LdkServerClient,
  LndRestClient,
  detectNetwork,
  formatMsat,
  planMultiPartPayment,
  quoteRoute
} from "./index.js";

const args = parseArgs(process.argv.slice(2));

try {
  if (args.command === "quote") {
    await runQuote(args);
  } else if (args.command === "node-info") {
    await runNodeInfo(args);
  } else if (args.command === "import-graph") {
    await runImportGraph(args);
  } else {
    printUsage();
    process.exit(args.command ? 1 : 0);
  }
} catch (error) {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}

async function runQuote(args) {
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
}

async function runNodeInfo(args) {
  const client = buildClient(args);
  const info = await client.getInfo();
  console.log(
    JSON.stringify(
      {
        implementation: args.impl,
        network: detectNetwork(info),
        id: info.identity_pubkey ?? info.id ?? info.nodeId,
        alias: info.alias,
        syncedToChain: info.synced_to_chain ?? info.blockchainSync
      },
      null,
      2
    )
  );
}

async function runImportGraph(args) {
  const client = buildClient(args);
  const imported = await client.importGraph({ network: args.network });
  console.log(JSON.stringify(imported.graph.toJSON(), null, 2));
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
  console.log(`Usage:
  ln-flow quote --network examples/sample-network.json --from treasury --to merchant --amount 250000 [--parts 2]
  ln-flow node-info --impl lnd --url https://127.0.0.1:8080 --macaroon ~/.lnd/data/chain/bitcoin/testnet/admin.macaroon
  ln-flow import-graph --impl lnd --url https://127.0.0.1:8080 --macaroon ~/.lnd/data/chain/bitcoin/testnet/admin.macaroon
  ln-flow import-graph --impl cln --network testnet --lightning-cli lightning-cli
  ln-flow import-graph --impl eclair --network testnet --url http://127.0.0.1:8080 --password testnet-password
  LDK_SERVER_API_KEY=your-api-key ln-flow import-graph --impl ldk --network testnet --address 127.0.0.1:3536 --proto /path/to/api.proto --tls-cert ~/.ldk-server/tls.crt`);
}

function buildClient(args) {
  if (args.impl === "lnd") {
    return new LndRestClient({
      baseUrl: args.url,
      macaroonPath: expandHome(args.macaroon),
      rejectUnauthorized: args["reject-unauthorized"] === "true"
    });
  }

  if (args.impl === "cln") {
    return new CoreLightningClient({
      lightningCli: args["lightning-cli"],
      network: args.network,
      rpcFile: args["rpc-file"] ? expandHome(args["rpc-file"]) : undefined
    });
  }

  if (args.impl === "eclair") {
    return new EclairClient({
      baseUrl: args.url,
      password: args.password ?? process.env.ECLAIR_API_PASSWORD
    });
  }

  if (args.impl === "ldk") {
    return new LdkServerClient({
      address: args.address,
      apiKey: args["api-key"] ?? process.env.LDK_SERVER_API_KEY,
      protoPath: expandHome(args.proto),
      tlsCertPath: expandHome(args["tls-cert"]),
      rejectUnauthorized: args["reject-unauthorized"] !== "false"
    });
  }

  throw new TypeError("--impl must be one of: lnd, cln, eclair, ldk");
}

function expandHome(path) {
  if (!path?.startsWith("~/")) return path;
  return `${process.env.HOME}${path.slice(1)}`;
}
