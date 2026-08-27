export type CreditUnit = "credits" | "usd" | "percent" | "tokens" | "messages";

export const CREDIT_UNITS: readonly CreditUnit[] = [
  "credits",
  "usd",
  "percent",
  "tokens",
  "messages",
] as const;

export type WindowType = "5h" | "daily" | "weekly" | "monthly";

export const WINDOW_TYPES: readonly WindowType[] = [
  "5h",
  "daily",
  "weekly",
  "monthly",
] as const;

export interface CreditWindow {
  type: WindowType;
  used: number;
  limit: number;
  remaining: number;
  unit: CreditUnit;
  resetAt: Date | null;
}

export interface CreditSnapshot {
  accountId: string;
  fetchedAt: Date;
  windows: CreditWindow[];
}
