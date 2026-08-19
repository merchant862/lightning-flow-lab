export function toMsat(value, unit = "msat") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`Invalid amount: ${value}`);
  }

  if (unit === "sat") return Math.round(amount * 1000);
  if (unit === "btc") return Math.round(amount * 100_000_000_000);
  if (unit === "msat") return Math.round(amount);
  throw new TypeError(`Unsupported unit: ${unit}`);
}

export function msatToSat(msat) {
  return Number(msat) / 1000;
}

export function formatMsat(msat) {
  const value = Number(msat);
  if (!Number.isFinite(value)) return "n/a";
  return `${value} msat (${msatToSat(value).toFixed(3)} sat)`;
}
