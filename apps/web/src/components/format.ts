import type { CreditUnit } from "../api.js";

const UNIT_LABEL: Record<CreditUnit, string> = {
  credits: "credits",
  usd: "USD",
  percent: "%",
  tokens: "tokens",
  messages: "messages",
};

export function formatValue(value: number, unit: CreditUnit): string {
  if (unit === "usd") {
    return `$${value.toFixed(2)}`;
  }
  if (unit === "percent") {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)} ${UNIT_LABEL[unit]}`;
}

export function formatLimit(limit: number, unit: CreditUnit): string {
  if (unit === "usd") {
    return `$${limit.toFixed(2)}`;
  }
  if (unit === "percent") {
    return `${Math.round(limit)}%`;
  }
  return `${Math.round(limit)}`;
}
