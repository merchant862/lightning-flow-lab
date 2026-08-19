import { InsufficientLiquidityError } from "./errors.js";

const DEFAULT_POLICY = {
  baseFeeMsat: 1000,
  feeRatePpm: 100,
  cltvDelta: 40,
  minHtlcMsat: 1,
  maxHtlcMsat: Number.MAX_SAFE_INTEGER,
  disabled: false
};

export class ChannelGraph {
  constructor() {
    this.nodes = new Map();
    this.channels = new Map();
  }

  static fromJSON(document) {
    const graph = new ChannelGraph();
    for (const node of document.nodes ?? []) graph.addNode(node.id, node);
    for (const channel of document.channels ?? []) graph.addChannel(channel);
    return graph;
  }

  clone() {
    return ChannelGraph.fromJSON(this.toJSON());
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()].map((node) => ({ ...node })),
      channels: [...this.channels.values()].map((channel) => ({
        ...channel,
        balances: { ...channel.balances },
        policies: {
          [channel.node1]: { ...channel.policies[channel.node1] },
          [channel.node2]: { ...channel.policies[channel.node2] }
        }
      }))
    };
  }

  addNode(id, metadata = {}) {
    if (!id) throw new TypeError("Node id is required");
    this.nodes.set(id, { id, alias: metadata.alias ?? id, ...metadata });
    return this;
  }

  addChannel(input) {
    const channel = normalizeChannel(input);
    this.addNode(channel.node1);
    this.addNode(channel.node2);
    this.channels.set(channel.id, channel);
    return this;
  }

  directedEdges() {
    const edges = [];
    for (const channel of this.channels.values()) {
      edges.push(toEdge(channel, channel.node1, channel.node2));
      edges.push(toEdge(channel, channel.node2, channel.node1));
    }
    return edges;
  }

  incomingEdges(nodeId) {
    return this.directedEdges().filter((edge) => edge.to === nodeId);
  }

  reserve(route) {
    for (const hop of route.hops) {
      const channel = this.channels.get(hop.channelId);
      const available = channel.balances[hop.from];
      if (available < hop.incomingMsat) {
        throw new InsufficientLiquidityError("Channel cannot carry route", {
          channelId: hop.channelId,
          from: hop.from,
          available,
          required: hop.incomingMsat
        });
      }
    }

    for (const hop of route.hops) {
      const channel = this.channels.get(hop.channelId);
      channel.balances[hop.from] -= hop.incomingMsat;
      channel.balances[hop.to] += hop.incomingMsat;
    }

    return this;
  }
}

function normalizeChannel(input) {
  const id = input.id ?? `${input.node1}:${input.node2}`;
  const capacityMsat = Number(input.capacityMsat);
  if (!input.node1 || !input.node2 || !Number.isSafeInteger(capacityMsat)) {
    throw new TypeError(`Invalid channel ${id}`);
  }

  const node1Balance = input.balances?.[input.node1] ?? Math.floor(capacityMsat / 2);
  const node2Balance = input.balances?.[input.node2] ?? capacityMsat - node1Balance;

  return {
    id,
    node1: input.node1,
    node2: input.node2,
    capacityMsat,
    balances: {
      [input.node1]: Number(node1Balance),
      [input.node2]: Number(node2Balance)
    },
    policies: {
      [input.node1]: { ...DEFAULT_POLICY, ...(input.policies?.[input.node1] ?? {}) },
      [input.node2]: { ...DEFAULT_POLICY, ...(input.policies?.[input.node2] ?? {}) }
    },
    tags: input.tags ?? []
  };
}

function toEdge(channel, from, to) {
  return {
    channelId: channel.id,
    from,
    to,
    capacityMsat: channel.capacityMsat,
    liquidityMsat: channel.balances[from],
    policy: channel.policies[from],
    tags: channel.tags
  };
}
