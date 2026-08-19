import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { ChannelGraph } from "../graph.js";
import { parseMsat } from "./msat.js";
import { assertTestnetOnly } from "./testnet-guard.js";

const require = createRequire(import.meta.url);

export class LdkServerClient {
  constructor({
    address = "127.0.0.1:3536",
    apiKey,
    protoPath,
    tlsCertPath,
    rejectUnauthorized = true,
    timeoutMs = 15_000
  } = {}) {
    if (!apiKey) throw new TypeError("apiKey is required for LDK Server");
    if (!protoPath) throw new TypeError("protoPath is required for LDK Server");
    this.address = address;
    this.apiKey = apiKey;
    this.protoPath = resolve(protoPath);
    this.tlsCertPath = tlsCertPath ? resolve(tlsCertPath) : undefined;
    this.rejectUnauthorized = rejectUnauthorized;
    this.timeoutMs = timeoutMs;
    this.clientPromise = null;
  }

  async getInfo() {
    return this.call("GetNodeInfo", {});
  }

  async listChannels() {
    return this.call("ListChannels", {});
  }

  async importGraph(options = {}) {
    const info = await this.getInfo();
    const network = assertTestnetOnly("ldk", normalizeLdkInfo(info), options.network);
    const [channelIds, nodeIds] = await Promise.all([
      this.call("GraphListChannels", {}),
      this.call("GraphListNodes", {})
    ]);
    const [channels, nodes] = await Promise.all([
      Promise.all((channelIds.shortChannelIds ?? channelIds.short_channel_ids ?? []).map(async (id) => {
        const result = await this.call("GraphGetChannel", { shortChannelId: id, short_channel_id: id });
        return { ...(result.channel ?? result), shortChannelId: String(id) };
      })),
      Promise.all((nodeIds.nodeIds ?? nodeIds.node_ids ?? []).map(async (id) => {
        const result = await this.call("GraphGetNode", { nodeId: id });
        return { ...(result.node ?? result), nodeId: String(id) };
      }))
    ]);

    return {
      implementation: "ldk",
      network,
      node: { id: info.nodeId ?? info.node_id, alias: info.nodeAlias ?? info.node_alias },
      graph: mapLdkGraph(channels.map((item) => item.channel ?? item), nodes.map((item) => item.node ?? item), info.nodeId ?? info.node_id)
    };
  }

  async call(method, request) {
    const client = await this.getClient();
    return new Promise((resolve, reject) => {
      const metadata = new client.grpc.Metadata();
      const serialized = client.methods[method].requestSerialize(request);
      const frame = Buffer.allocUnsafe(5 + serialized.length);
      frame[0] = 0;
      frame.writeUInt32BE(serialized.length, 1);
      serialized.copy(frame, 5);
      const timestamp = Math.floor(Date.now() / 1000);
      const timestampBytes = Buffer.alloc(8);
      timestampBytes.writeBigUInt64BE(BigInt(timestamp));
      const signature = createHmac("sha256", this.apiKey)
        .update(Buffer.concat([timestampBytes, frame]))
        .digest("hex");
      metadata.set("x-auth", `HMAC ${timestamp}:${signature}`);
      client.methods[method].fn(request, metadata, { deadline: Date.now() + this.timeoutMs }, (error, response) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  async getClient() {
    if (!this.clientPromise) this.clientPromise = loadGrpcClient(this);
    return this.clientPromise;
  }
}

async function loadGrpcClient(options) {
  const grpc = require("@grpc/grpc-js");
  const protoLoader = require("@grpc/proto-loader");
  const packageDefinition = await protoLoader.load(options.protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [dirname(resolve(options.protoPath))]
  });
  const api = grpc.loadPackageDefinition(packageDefinition).api;
  const rootCert = options.tlsCertPath ? await readFile(options.tlsCertPath) : undefined;
  const credentials = rootCert
    ? grpc.credentials.createSsl(rootCert)
    : grpc.credentials.createInsecure();
  const client = new api.LightningNode(options.address, credentials);
  client.grpc = { Metadata: grpc.Metadata };
  client.methods = {};
  for (const method of ["GetNodeInfo", "ListChannels", "GraphListChannels", "GraphGetChannel", "GraphListNodes", "GraphGetNode"]) {
    const fn = client[method[0].toLowerCase() + method.slice(1)].bind(client);
    client.methods[method] = { fn, requestSerialize: client[method[0].toLowerCase() + method.slice(1)].requestSerialize };
  }
  return client;
}

export function mapLdkGraph(channels = [], nodes = [], localNodeId = null) {
  const graph = new ChannelGraph();
  for (const node of nodes) {
    const id = node.nodeId ?? node.node_id ?? node.id;
    if (id) graph.addNode(id, { alias: node.alias ?? node.nodeAlias ?? node.node_alias });
  }

  for (const channel of channels) {
    const node1 = channel.nodeOne ?? channel.node_one ?? channel.node1;
    const node2 = channel.nodeTwo ?? channel.node_two ?? channel.node2;
    const id = String(channel.shortChannelId ?? channel.short_channel_id ?? channel.id ?? channel.channelId);
    if (!node1 || !node2 || id === "undefined") continue;
    const capacityMsat = channel.capacitySats !== undefined || channel.capacity_sats !== undefined
      ? parseMsat(channel.capacitySats ?? channel.capacity_sats) * 1000
      : parseMsat(channel.capacityMsat ?? channel.capacity_msat ?? channel.capacity ?? 0);
    const localBalance = parseMsat(channel.outboundCapacityMsat ?? channel.outbound_capacity_msat, Math.floor(capacityMsat / 2));
    const balances = { [node1]: Math.floor(capacityMsat / 2), [node2]: capacityMsat - Math.floor(capacityMsat / 2) };
    if (localNodeId && channel.counterpartyNodeId) {
      balances[localNodeId] = localBalance;
      balances[channel.counterpartyNodeId] = capacityMsat - localBalance;
    }
    graph.addChannel({
      id,
      node1,
      node2,
      capacityMsat,
      balances,
      policies: {
        [node1]: mapLdkPolicy(channel.oneToTwo ?? channel.one_to_two),
        [node2]: mapLdkPolicy(channel.twoToOne ?? channel.two_to_one)
      },
      tags: ["ldk"]
    });
  }
  return graph;
}

function mapLdkPolicy(update = {}) {
  const fees = update.fees ?? {};
  return {
    baseFeeMsat: Number(fees.baseMsat ?? fees.base_msat ?? 0),
    feeRatePpm: Number(fees.proportionalMillionths ?? fees.proportional_millionths ?? 0),
    cltvDelta: Number(update.cltvExpiryDelta ?? update.cltv_expiry_delta ?? 0),
    minHtlcMsat: parseMsat(update.htlcMinimumMsat ?? update.htlc_minimum_msat, 1),
    maxHtlcMsat: parseMsat(update.htlcMaximumMsat ?? update.htlc_maximum_msat, Number.MAX_SAFE_INTEGER),
    disabled: update.enabled === false
  };
}

function normalizeLdkInfo(info) {
  const network = String(info.network ?? "").toLowerCase();
  return { ...info, network: network === "bitcoin" ? "mainnet" : network };
}
