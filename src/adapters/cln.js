import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChannelGraph } from "../graph.js";
import { parseMsat } from "./msat.js";
import { assertTestnetOnly } from "./testnet-guard.js";

const execFileAsync = promisify(execFile);

export class CoreLightningClient {
  constructor({ lightningCli = "lightning-cli", network, rpcFile, timeoutMs = 15_000 } = {}) {
    this.lightningCli = lightningCli;
    this.network = network;
    this.rpcFile = rpcFile;
    this.timeoutMs = timeoutMs;
  }

  async getInfo() {
    return this.call("getinfo");
  }

  async listChannels() {
    return this.call("listchannels");
  }

  async listPeerChannels() {
    return this.call("listpeerchannels");
  }

  async payInvoice(invoice, options = {}) {
    await this.assertTestnet(options.network);
    return this.call("pay", [invoice]);
  }

  async openChannel({ nodeId, amountSat, announce = true }, options = {}) {
    await this.assertTestnet(options.network);
    return this.call("fundchannel", [nodeId, amountSat]);
  }

  async closeChannel({ channelId, unilateralTimeout = 0 }, options = {}) {
    await this.assertTestnet(options.network);
    return this.call("close", [channelId, unilateralTimeout]);
  }

  async importGraph(options = {}) {
    const info = await this.getInfo();
    const network = assertTestnetOnly("core-lightning", info, options.network ?? this.network);
    const [channels, peers] = await Promise.all([this.listChannels(), this.listPeerChannels()]);

    return {
      implementation: "core-lightning",
      network,
      node: {
        id: info.id,
        alias: info.alias
      },
      graph: mapCoreLightningGraph(channels.channels ?? [], peers.channels ?? [], info.id)
    };
  }

  async call(method, params = []) {
    const args = [];
    if (this.network) args.push(`--network=${this.network}`);
    if (this.rpcFile) args.push(`--rpc-file=${this.rpcFile}`);
    args.push(method, ...params);

    const { stdout } = await execFileAsync(this.lightningCli, args, {
      timeout: this.timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });
    return JSON.parse(stdout);
  }

  async assertTestnet(network) {
    return assertTestnetOnly("core-lightning", await this.getInfo(), network ?? this.network);
  }
}

export function mapCoreLightningGraph(channels, peerChannels = [], localNodeId = null) {
  const graph = new ChannelGraph();
  const grouped = new Map();

  for (const edge of channels) {
    const id = edge.short_channel_id;
    const group = grouped.get(id) ?? [];
    group.push(edge);
    grouped.set(id, group);
  }

  const localByScid = new Map(peerChannels.filter((channel) => channel.short_channel_id).map((channel) => [channel.short_channel_id, channel]));

  for (const [id, directions] of grouped.entries()) {
    const first = directions[0];
    const second = directions.find((edge) => edge.source === first.destination && edge.destination === first.source);
    const node1 = first.source;
    const node2 = first.destination;
    const capacityMsat = parseMsat(first.amount_msat);
    const balances = balancedCapacity(node1, node2, capacityMsat);
    const local = localByScid.get(id);

    if (local && localNodeId) {
      balances[localNodeId] = parseMsat(local.to_us_msat ?? local.our_amount_msat, balances[localNodeId]);
      balances[local.peer_id] = capacityMsat - balances[localNodeId];
    }

    graph.addChannel({
      id,
      node1,
      node2,
      capacityMsat,
      balances,
      policies: {
        [node1]: mapCoreLightningPolicy(first),
        [node2]: mapCoreLightningPolicy(second)
      },
      tags: ["core-lightning"]
    });
  }

  return graph;
}

function mapCoreLightningPolicy(edge = {}) {
  return {
    baseFeeMsat: parseMsat(edge.base_fee_millisatoshi, 0),
    feeRatePpm: Number(edge.fee_per_millionth ?? 0),
    cltvDelta: Number(edge.delay ?? 0),
    minHtlcMsat: parseMsat(edge.htlc_minimum_msat, 1),
    maxHtlcMsat: parseMsat(edge.htlc_maximum_msat, Number.MAX_SAFE_INTEGER),
    disabled: edge.active === false
  };
}

function balancedCapacity(node1, node2, capacityMsat) {
  return {
    [node1]: Math.floor(capacityMsat / 2),
    [node2]: capacityMsat - Math.floor(capacityMsat / 2)
  };
}
