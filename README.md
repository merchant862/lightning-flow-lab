# Lightning Flow Lab

Lightning Flow Lab is a small Node.js toolkit for modelling Bitcoin Lightning payment flow. It can run against static fixtures or import read-only graph data from testnet LND, Core Lightning, and Eclair nodes.

It focuses on the operational parts a payments team cares about: channel liquidity, route fees, multi-part payments, settlement accounting, and failed-payment incident analysis.

This is not a wallet. Runtime node adapters are intentionally testnet-only and fail closed if a node reports `mainnet`. Write operations require explicit CLI commands and should only be used with disposable testnet funds.

## Features

- Channel graph model with bidirectional balances and forwarding policies
- Backward route quoting with BOLT-style base fee, ppm fee rate, CLTV delta, HTLC limits, disabled channels, and liquidity checks
- Single-path settlement that moves channel balances
- Multi-part payment planner that splits around constrained liquidity
- Lightweight ledger view for Lightning settlement/accounting records
- Incident analyzer for failed payment attempts and risky channel detection
- Read-only testnet adapters for LND REST, Core Lightning `lightning-cli`, and Eclair HTTP API
- Read-only testnet adapter for LDK Server gRPC
- Testnet-only payment, channel-open, cooperative-close, and force-close operations across adapters
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

## Testnet Node Adapters

The adapter commands import real channel graph data into the same internal `ChannelGraph` model used by the simulator. They are read-only and guarded by network detection. Allowed networks are `testnet`, `testnet3`, `testnet4`, `signet`, and `regtest`; `mainnet` is rejected.

### LND REST

LND is accessed through its REST API. The client reads `getinfo`, `describegraph`, and local channels, then enriches graph edges with local channel balances when available.

```bash
node src/cli.js node-info \
  --impl lnd \
  --url https://127.0.0.1:8080 \
  --macaroon ~/.lnd/data/chain/bitcoin/testnet/admin.macaroon
```

```bash
node src/cli.js import-graph \
  --impl lnd \
  --url https://127.0.0.1:8080 \
  --macaroon ~/.lnd/data/chain/bitcoin/testnet/admin.macaroon
```

### Core Lightning

Core Lightning is accessed through `lightning-cli`. The client reads `getinfo`, `listchannels`, and `listpeerchannels`.

```bash
node src/cli.js import-graph \
  --impl cln \
  --network testnet \
  --lightning-cli lightning-cli
```

If your node uses a custom RPC socket:

```bash
node src/cli.js import-graph \
  --impl cln \
  --network testnet \
  --rpc-file ~/.lightning/testnet/lightning-rpc
```

### Eclair

Eclair is accessed through its HTTP API. Pass the API password directly or set `ECLAIR_API_PASSWORD`.

```bash
ECLAIR_API_PASSWORD=testnet-password node src/cli.js import-graph \
  --impl eclair \
  --network testnet \
  --url http://127.0.0.1:8080
```

### LDK Server

LDK is integrated through the official LDK Server gRPC API. The adapter reads node metadata and the network graph using the read-only graph RPCs. LDK Server's `api.proto` is supplied by the LDK Server checkout, and its self-signed TLS certificate must be pinned.

```bash
LDK_SERVER_API_KEY=your-api-key node src/cli.js import-graph \
  --impl ldk \
  --network testnet \
  --address 127.0.0.1:3536 \
  --proto /path/to/ldk-server/ldk-server-grpc/src/proto/api.proto \
  --tls-cert ~/.ldk-server/tls.crt
```

## Testnet Write Operations

The adapters expose the common operational actions below. Every write call fetches node metadata first and rejects mainnet. Use a restricted testnet credential where the node supports it, and never put secrets directly in shell history.

```bash
node src/cli.js pay --impl lnd --network testnet \
  --url https://127.0.0.1:8080 \
  --macaroon ~/.lnd/data/chain/bitcoin/testnet/admin.macaroon \
  --invoice lntb1...
```

```bash
node src/cli.js open-channel --impl cln --network testnet \
  --lightning-cli lightning-cli \
  --peer 02... \
  --amount 100000
```

```bash
node src/cli.js close-channel --impl eclair --network testnet \
  --url http://127.0.0.1:8080 \
  --password "$ECLAIR_API_PASSWORD" \
  --channel 123x1x0
```

Pass `--force true` only when a cooperative close is not possible. Force closing can create on-chain delays and fees.

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

- Add direct embedded LDK Node Rust bridge support
- Add payment probes and route reliability scoring
- Export Prometheus-style metrics for liquidity and routing failure trends
- Add policy recommendations for rebalancing and fee updates

## API References

- LND REST exposes `/v1/getinfo` and `/v1/graph` for node metadata and graph import.
- Core Lightning `listchannels` returns directed gossip channel entries, and `listpeerchannels` returns local channel state.
- Eclair exposes HTTP endpoints such as `getinfo`, `allchannels`, `allupdates`, and `usablebalances`.
- LDK Server exposes authenticated gRPC graph methods such as `GraphListChannels`, `GraphGetChannel`, `GraphListNodes`, and `GraphGetNode`.

## License

MIT. Use it, fork it, and improve it.
