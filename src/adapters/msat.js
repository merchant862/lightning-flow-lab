export function parseMsat(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && "msat" in value) return parseMsat(value.msat, fallback);

  const text = String(value).trim();
  if (text.endsWith("msat")) return Number.parseInt(text.slice(0, -4), 10);
  if (text.endsWith("sat")) return Number.parseInt(text.slice(0, -3), 10) * 1000;
  return Number.parseInt(text, 10);
}

export function satsToMsat(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const sats = Number.parseInt(String(value), 10);
  return Number.isFinite(sats) ? sats * 1000 : fallback;
}
