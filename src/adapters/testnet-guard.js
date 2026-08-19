const SAFE_NETWORKS = new Set(["testnet", "testnet3", "testnet4", "signet", "regtest"]);

export class UnsafeNetworkError extends Error {
  constructor(implementation, network) {
    super(`${implementation} node is on ${network || "unknown"}; only testnet-family networks are allowed`);
    this.name = "UnsafeNetworkError";
    this.details = { implementation, network, allowedNetworks: [...SAFE_NETWORKS] };
  }
}

export function assertTestnetOnly(implementation, info, explicitNetwork) {
  const detectedNetwork = normalizeNetwork(detectNetwork(info));
  const requestedNetwork = explicitNetwork === undefined
    ? null
    : normalizeNetwork(explicitNetwork);

  if (detectedNetwork !== "unknown" && !SAFE_NETWORKS.has(detectedNetwork)) {
    throw new UnsafeNetworkError(implementation, detectedNetwork);
  }
  if (requestedNetwork && !SAFE_NETWORKS.has(requestedNetwork)) {
    throw new UnsafeNetworkError(implementation, requestedNetwork);
  }
  if (requestedNetwork && detectedNetwork !== "unknown" && requestedNetwork !== detectedNetwork) {
    throw new UnsafeNetworkError(implementation, `${detectedNetwork} (requested ${requestedNetwork})`);
  }
  return detectedNetwork === "unknown" ? requestedNetwork : detectedNetwork;
}

export function detectNetwork(info = {}) {
  if (info.network) return info.network;
  if (info.chain?.network) return info.chain.network;
  if (Array.isArray(info.chains) && info.chains[0]?.network) return info.chains[0].network;
  if (info.testnet === true) return "testnet";
  if (info.testnet === false) return "mainnet";
  return "unknown";
}

function normalizeNetwork(network) {
  return String(network ?? "unknown").toLowerCase();
}
