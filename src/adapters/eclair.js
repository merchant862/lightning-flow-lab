import { ChannelGraph } from "../graph.js";
import { formBody, requestJson } from "./http.js";
import { parseMsat } from "./msat.js";
import { assertTestnetOnly } from "./testnet-guard.js";

export class EclairClient {
  constructor({ baseUrl = "http://127.0.0.1:8080", password, timeoutMs = 15_000 } = {}) {
    if (!password) throw new TypeError("password is required for Eclair API");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.password = password;
    this.timeoutMs = timeoutMs;
  }

  async getInfo() {
    return this.post("/getinfo");
  }

  async allChannels() {
    return this.post("/allchannels");
  }

  async allUpdates() {
    return this.post("/allupdates");
  }

  async usableBalances() {
    return this.post("/usablebalances");
  }

  async importGraph(options = {}) {
    const info = await this.getInfo();
    const network = assertTestnetOnly("eclair", info, options.network);
    const [channels, updates, balances] = await Promise.all([
      this.allChannels(),
      this.allUpdates(),
      this.usableBalances()
    ]);

    return {
      implementation: "eclair",
      network,
      node: {
        id: info.nodeId,
        alias: info.alias
      },
      graph: mapEclairGraph(channels, updates, balances, info.nodeId)
    };
  }

  async post(path, values = {}) {
    return requestJson(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`:${this.password}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formBody(values),
      timeoutMs: this.timeoutMs
    });
  }
}

export function mapEclairGraph(channels = [], updates = [], balances = [], localNodeId = null) {
  const graph = new ChannelGraph();
  const updatesByScid = groupUpdates(updates);
  const balancesByScid = new Map(balances.map((balance) => [balance.realScid, balance]));

  for (const channel of channels) {
    const id = channel.shortChannelId ?? channel.realScid ?? channel.channelId;
    if (!id) continue;

    const node1 = channel.nodeId1 ?? channel.node1 ?? channel.a;
    const node2 = channel.nodeId2 ?? channel.node2 ?? channel.b;
    if (!node1 || !node2) continue;

    const policies = updatesByScid.get(id) ?? {};
    const balance = balancesByScid.get(id);
    const capacityMsat = inferEclairCapacityMsat(channel, policies, balance);
    const channelBalances = balancedCapacity(node1, node2, capacityMsat);

    if (balance && localNodeId) {
      channelBalances[localNodeId] = parseMsat(balance.canSend);
      channelBalances[balance.remoteNodeId] = parseMsat(balance.canReceive, capacityMsat - channelBalances[localNodeId]);
    }

    graph.addChannel({
      id,
      node1,
      node2,
      capacityMsat,
      balances: channelBalances,
      policies: {
        [node1]: mapEclairPolicy(policies[node1]),
        [node2]: mapEclairPolicy(policies[node2])
      },
      tags: ["eclair"]
    });
  }

  return graph;
}

function groupUpdates(updates) {
  const grouped = new Map();
  for (const update of updates) {
    const id = update.shortChannelId ?? update.realScid;
    if (!id) continue;
    const entry = grouped.get(id) ?? {};
    const source = update.nodeId ?? update.sourceNodeId;
    if (source) entry[source] = update;
    grouped.set(id, entry);
  }
  return grouped;
}

function mapEclairPolicy(update = {}) {
  return {
    baseFeeMsat: parseMsat(update.feeBaseMsat ?? update.feeBase, 0),
    feeRatePpm: Number(update.feeProportionalMillionths ?? update.feeRatePpm ?? 0),
    cltvDelta: Number(update.cltvExpiryDelta ?? update.cltvDelta ?? 0),
    minHtlcMsat: parseMsat(update.htlcMinimumMsat, 1),
    maxHtlcMsat: parseMsat(update.htlcMaximumMsat, Number.MAX_SAFE_INTEGER),
    disabled: update.enabled === false
  };
}

function inferEclairCapacityMsat(channel, policies, balance) {
  const direct = parseMsat(channel.capacityMsat ?? channel.capacity, 0);
  if (direct > 0) return direct;
  if (balance) return parseMsat(balance.canSend) + parseMsat(balance.canReceive);

  const policyMax = Object.values(policies)
    .map((policy) => parseMsat(policy.htlcMaximumMsat, 0))
    .filter((value) => value > 0);
  return policyMax.length > 0 ? Math.max(...policyMax) : 1;
}

function balancedCapacity(node1, node2, capacityMsat) {
  return {
    [node1]: Math.floor(capacityMsat / 2),
    [node2]: capacityMsat - Math.floor(capacityMsat / 2)
  };
}
