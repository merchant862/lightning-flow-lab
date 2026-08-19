import test from "node:test";
import assert from "node:assert/strict";
import { ChannelGraph, PaymentLedger, analyzePaymentFailures, planMultiPartPayment, quoteRoute, settleRoute } from "../src/index.js";

function fixture() {
  return ChannelGraph.fromJSON({
    nodes: [{ id: "alice" }, { id: "bob" }, { id: "carol" }, { id: "dave" }],
    channels: [
      {
        id: "ab",
        node1: "alice",
        node2: "bob",
        capacityMsat: 1_000_000,
        balances: { alice: 700_000, bob: 300_000 },
        policies: { alice: { baseFeeMsat: 100, feeRatePpm: 10 }, bob: {} }
      },
      {
        id: "bd",
        node1: "bob",
        node2: "dave",
        capacityMsat: 1_000_000,
        balances: { bob: 420_000, dave: 580_000 },
        policies: { bob: { baseFeeMsat: 200, feeRatePpm: 20 }, dave: {} }
      },
      {
        id: "ac",
        node1: "alice",
        node2: "carol",
        capacityMsat: 1_000_000,
        balances: { alice: 700_000, carol: 300_000 },
        policies: { alice: { baseFeeMsat: 1000, feeRatePpm: 100 }, carol: {} }
      },
      {
        id: "cd",
        node1: "carol",
        node2: "dave",
        capacityMsat: 1_000_000,
        balances: { carol: 700_000, dave: 300_000 },
        policies: { carol: { baseFeeMsat: 1000, feeRatePpm: 100 }, dave: {} }
      }
    ]
  });
}

test("quotes the cheapest route with amount-dependent fees", () => {
  const route = quoteRoute(fixture(), { source: "alice", target: "dave", amountMsat: 250_000 });

  assert.deepEqual(route.hops.map((hop) => hop.channelId), ["ab", "bd"]);
  assert.equal(route.amountMsat, 250_000);
  assert.equal(route.totalFeeMsat, 308);
});

test("settlement moves liquidity across each channel", () => {
  const graph = fixture();
  const route = settleRoute(graph, { source: "alice", target: "dave", amountMsat: 250_000 });
  const channel = graph.channels.get("ab");

  assert.equal(route.hops.length, 2);
  assert.equal(channel.balances.alice, 449_692);
  assert.equal(channel.balances.bob, 550_308);
});

test("plans a multi-part payment when one path cannot carry the full amount", () => {
  const plan = planMultiPartPayment(fixture(), {
    source: "alice",
    target: "dave",
    amountMsat: 600_000,
    maxParts: 3,
    minPartMsat: 50_000
  });

  assert.equal(plan.parts.length, 3);
  assert.equal(plan.parts.reduce((sum, part) => sum + part.amountMsat, 0), 600_000);
});

test("records a Lightning settlement ledger view", () => {
  const route = quoteRoute(fixture(), { source: "alice", target: "dave", amountMsat: 250_000 });
  const ledger = new PaymentLedger({ clock: () => new Date("2026-08-19T00:00:00.000Z") });

  const paymentId = ledger.recordSettlement(route, { invoice: "lnbc..." });
  const trialBalance = ledger.trialBalance();

  assert.match(paymentId, /^pay_/);
  assert.equal(trialBalance.length, 3);
  assert.equal(trialBalance.find((row) => row.account === "lightning:wallet").creditMsat, route.totalDebitMsat);
});

test("surfaces dominant failure channels for incident analysis", () => {
  const report = analyzePaymentFailures([
    { failureCode: "TEMPORARY_CHANNEL_FAILURE", route: [{ channelId: "ab" }, { channelId: "bd" }] },
    { failureCode: "TEMPORARY_CHANNEL_FAILURE", route: [{ channelId: "ab" }, { channelId: "cd" }] }
  ]);

  assert.equal(report.failureCodes.TEMPORARY_CHANNEL_FAILURE, 2);
  assert.equal(report.riskyChannels[0].channelId, "ab");
});
