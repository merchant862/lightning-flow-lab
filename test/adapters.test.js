import test from "node:test";
import assert from "node:assert/strict";
import { mapCoreLightningGraph, mapEclairGraph, mapLndGraph, assertTestnetOnly, UnsafeNetworkError } from "../src/index.js";

test("blocks mainnet node metadata", () => {
  assert.throws(
    () => assertTestnetOnly("lnd", { chains: [{ chain: "bitcoin", network: "mainnet" }] }),
    UnsafeNetworkError
  );
});

test("does not allow an explicit testnet flag to override mainnet metadata", () => {
  assert.throws(
    () => assertTestnetOnly("lnd", { network: "mainnet" }, "testnet"),
    UnsafeNetworkError
  );
});

test("allows testnet-family node metadata", () => {
  assert.equal(assertTestnetOnly("lnd", { chains: [{ chain: "bitcoin", network: "testnet" }] }), "testnet");
  assert.equal(assertTestnetOnly("core-lightning", { network: "signet" }), "signet");
  assert.equal(assertTestnetOnly("eclair", {}, "regtest"), "regtest");
});

test("maps LND graph and local channel balances", () => {
  const graph = mapLndGraph(
    {
      nodes: [
        { pub_key: "local", alias: "Local" },
        { pub_key: "remote", alias: "Remote" }
      ],
      edges: [
        {
          channel_id: "123",
          node1_pub: "local",
          node2_pub: "remote",
          capacity: "1000",
          node1_policy: {
            fee_base_msat: "100",
            fee_rate_milli_msat: "10",
            time_lock_delta: 40,
            min_htlc: "1",
            max_htlc_msat: "900000"
          },
          node2_policy: {
            fee_base_msat: "200",
            fee_rate_milli_msat: "20",
            time_lock_delta: 50
          }
        }
      ]
    },
    [{ chan_id: "123", remote_pubkey: "remote", local_balance: "700", remote_balance: "300" }],
    "local"
  );

  const channel = graph.channels.get("123");
  assert.equal(channel.capacityMsat, 1_000_000);
  assert.equal(channel.balances.local, 700_000);
  assert.equal(channel.policies.local.baseFeeMsat, 100);
});

test("maps Core Lightning directed gossip into bidirectional channels", () => {
  const graph = mapCoreLightningGraph(
    [
      {
        short_channel_id: "1x1x0",
        source: "a",
        destination: "b",
        amount_msat: "1000000msat",
        active: true,
        base_fee_millisatoshi: 10,
        fee_per_millionth: 20,
        delay: 12
      },
      {
        short_channel_id: "1x1x0",
        source: "b",
        destination: "a",
        amount_msat: "1000000msat",
        active: false,
        base_fee_millisatoshi: 11,
        fee_per_millionth: 21,
        delay: 13
      }
    ],
    [{ short_channel_id: "1x1x0", peer_id: "b", to_us_msat: "650000msat" }],
    "a"
  );

  const channel = graph.channels.get("1x1x0");
  assert.equal(channel.balances.a, 650_000);
  assert.equal(channel.policies.b.disabled, true);
});

test("maps Eclair graph with usable balance enrichment", () => {
  const graph = mapEclairGraph(
    [{ shortChannelId: "2x2x0", nodeId1: "local", nodeId2: "peer" }],
    [
      {
        shortChannelId: "2x2x0",
        nodeId: "local",
        feeBaseMsat: 10,
        feeProportionalMillionths: 20,
        cltvExpiryDelta: 12,
        htlcMaximumMsat: 500000
      },
      {
        shortChannelId: "2x2x0",
        nodeId: "peer",
        feeBaseMsat: 11,
        feeProportionalMillionths: 21,
        cltvExpiryDelta: 13,
        htlcMaximumMsat: 500000
      }
    ],
    [{ realScid: "2x2x0", remoteNodeId: "peer", canSend: 300000, canReceive: 200000 }],
    "local"
  );

  const channel = graph.channels.get("2x2x0");
  assert.equal(channel.capacityMsat, 500000);
  assert.equal(channel.balances.local, 300000);
  assert.equal(channel.policies.peer.feeRatePpm, 21);
});
