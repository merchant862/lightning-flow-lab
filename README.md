# Lightning Flow Lab

Lightning Flow Lab is a small Node.js toolkit for modelling Bitcoin Lightning payment flow. It focuses on the operational parts a payments team cares about: channel liquidity, route fees, multi-part payments, settlement accounting, and failed-payment incident analysis.

This is not a replacement for LND, Core Lightning, Eclair, or LDK. It is an open-source lab project for experimenting with policies before wiring the same ideas into a real node.

## Features

- Channel graph model with bidirectional balances and forwarding policies
- Backward route quoting with BOLT-style base fee, ppm fee rate, CLTV delta, HTLC limits, disabled channels, and liquidity checks
- Single-path settlement that moves channel balances
- Multi-part payment planner that splits around constrained liquidity
- Lightweight ledger view for Lightning settlement/accounting records
- Incident analyzer for failed payment attempts and risky channel detection
- Zero runtime dependencies; runs on Node.js built-ins

## Quick Start

```bash
npm test
npm run demo
```

Direct CLI usage:

```bash
node src/cli.js quote \
  --network examples/sample-network.json \
  --from treasury \
  --to merchant \
  --amount 250000
```

Multi-part payment quote:

```bash
node src/cli.js quote \
  --network examples/sample-network.json \
  --from treasury \
  --to merchant \
  --amount 500000 \
  --parts 3
```

## Library Usage

```js
import { ChannelGraph, quoteRoute, settleRoute } from "lightning-flow-lab";

const graph = ChannelGraph.fromJSON({
  nodes: [{ id: "alice" }, { id: "bob" }],
  channels: [{
    id: "alice-bob",
    node1: "alice",
    node2: "bob",
    capacityMsat: 1_000_000,
    balances: { alice: 800_000, bob: 200_000 },
    policies: {
      alice: { baseFeeMsat: 1000, feeRatePpm: 100, cltvDelta: 40 },
      bob: { baseFeeMsat: 1000, feeRatePpm: 100, cltvDelta: 40 }
    }
  }]
});

const payment = {
  source: "alice",
  target: "bob",
  amountMsat: 100_000
};

const route = quoteRoute(graph, payment);
settleRoute(graph, payment);
```

## Roadmap

- Import channel snapshots from LND `describegraph` and Core Lightning `listchannels`
- Add payment probes and route reliability scoring
- Export Prometheus-style metrics for liquidity and routing failure trends
- Add policy recommendations for rebalancing and fee updates

## License

MIT. Use it, fork it, and improve it.
