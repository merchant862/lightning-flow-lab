import { ChannelGraph } from "../graph.js";
import { readHexFile, requestJson } from "./http.js";
import { parseMsat, satsToMsat } from "./msat.js";
import { assertTestnetOnly } from "./testnet-guard.js";

export class LndRestClient {
  constructor({ baseUrl = "https://127.0.0.1:8080", macaroonPath, rejectUnauthorized = false } = {}) {
    if (!macaroonPath) throw new TypeError("macaroonPath is required for LND REST");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.macaroonPath = macaroonPath;
    this.rejectUnauthorized = rejectUnauthorized;
  }

  async getInfo() {
    return this.get("/v1/getinfo");
  }

  async describeGraph({ includeUnannounced = false } = {}) {
    const suffix = includeUnannounced ? "?include_unannounced=true" : "";
    return this.get(`/v1/graph${suffix}`);
  }

  async listChannels() {
    return this.get("/v1/channels");
  }

  async importGraph(options = {}) {
    const info = await this.getInfo();
    const network = assertTestnetOnly("lnd", info, options.network);
    const [remoteGraph, localChannels] = await Promise.all([
      this.describeGraph({ includeUnannounced: options.includeUnannounced }),
      this.listChannels()
    ]);

    return {
      implementation: "lnd",
      network,
      node: {
        id: info.identity_pubkey,
        alias: info.alias
      },
      graph: mapLndGraph(remoteGraph, localChannels.channels ?? [], info.identity_pubkey)
    };
  }

  async get(path) {
    const macaroon = await readHexFile(this.macaroonPath);
    return requestJson(`${this.baseUrl}${path}`, {
      headers: { "Grpc-Metadata-macaroon": macaroon },
      rejectUnauthorized: this.rejectUnauthorized
    });
  }
}

export function mapLndGraph(document, localChannels = [], localNodeId = null) {
  const graph = new ChannelGraph();
  for (const node of document.nodes ?? []) {
    graph.addNode(node.pub_key, { alias: node.alias, color: node.color });
  }

  const localByChanId = new Map(localChannels.map((channel) => [String(channel.chan_id), channel]));
  for (const edge of document.edges ?? []) {
    const capacityMsat = satsToMsat(edge.capacity);
    const balances = balancedCapacity(edge.node1_pub, edge.node2_pub, capacityMsat);
    const local = localByChanId.get(String(edge.channel_id));

    if (local && localNodeId) {
      const remote = local.remote_pubkey;
      balances[localNodeId] = satsToMsat(local.local_balance);
      balances[remote] = satsToMsat(local.remote_balance, capacityMsat - balances[localNodeId]);
    }

    graph.addChannel({
      id: String(edge.channel_id),
      node1: edge.node1_pub,
      node2: edge.node2_pub,
      capacityMsat,
      balances,
      policies: {
        [edge.node1_pub]: mapLndPolicy(edge.node1_policy),
        [edge.node2_pub]: mapLndPolicy(edge.node2_policy)
      },
      tags: ["lnd"]
    });
  }

  return graph;
}

function mapLndPolicy(policy = {}) {
  return {
    baseFeeMsat: parseMsat(policy.fee_base_msat, 0),
    feeRatePpm: Number(policy.fee_rate_milli_msat ?? 0),
    cltvDelta: Number(policy.time_lock_delta ?? 0),
    minHtlcMsat: parseMsat(policy.min_htlc, 1),
    maxHtlcMsat: parseMsat(policy.max_htlc_msat, Number.MAX_SAFE_INTEGER),
    disabled: Boolean(policy.disabled)
  };
}

function balancedCapacity(node1, node2, capacityMsat) {
  return {
    [node1]: Math.floor(capacityMsat / 2),
    [node2]: capacityMsat - Math.floor(capacityMsat / 2)
  };
}
