import { desc, eq } from "drizzle-orm";
import type { CreditSnapshot, CreditUnit, WindowType } from "@tokenwatch/core";
import { newId, type Db } from "../client.js";
import { creditSnapshots, creditWindows } from "../schema/index.js";

export interface SnapshotRow {
  id: string;
  accountId: string;
  fetchedAt: Date;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface SnapshotWithWindows extends SnapshotRow {
  windows: CreditSnapshotRow[];
}

export interface CreditSnapshotRow {
  id: string;
  snapshotId: string;
  type: WindowType;
  used: number;
  limit: number;
  remaining: number;
  unit: CreditUnit;
  resetAt: Date | null;
}

export interface SaveSnapshotInput {
  accountId: string;
  fetchedAt?: Date;
  windows?: Array<{
    type: WindowType;
    used: number;
    limit: number;
    remaining: number;
    unit: CreditUnit;
    resetAt: Date | null;
  }>;
  error?: { code: string; message: string };
}

export function saveSnapshot(db: Db, input: SaveSnapshotInput): string {
  const id = newId();
  const now = new Date();
  const fetchedAt = input.fetchedAt ?? now;
  db.transaction((tx) => {
    tx.insert(creditSnapshots)
      .values({
        id,
        accountId: input.accountId,
        fetchedAt,
        errorCode: input.error?.code ?? null,
        errorMessage: input.error?.message ?? null,
        createdAt: now,
      })
      .run();
    if (input.windows && input.windows.length > 0) {
      tx.insert(creditWindows)
        .values(
          input.windows.map((w) => ({
            id: newId(),
            snapshotId: id,
            type: w.type,
            used: w.used,
            limit: w.limit,
            remaining: w.remaining,
            unit: w.unit,
            resetAt: w.resetAt,
          })),
        )
        .run();
    }
  });
  return id;
}

export function getSnapshot(db: Db, id: string): SnapshotWithWindows | undefined {
  const snap = db
    .select()
    .from(creditSnapshots)
    .where(eq(creditSnapshots.id, id))
    .get();
  if (!snap) return undefined;
  return { ...snap, windows: getWindowsForSnapshot(db, id) };
}

export function getLatestSnapshot(
  db: Db,
  accountId: string,
): SnapshotWithWindows | undefined {
  const snap = db
    .select()
    .from(creditSnapshots)
    .where(eq(creditSnapshots.accountId, accountId))
    .orderBy(desc(creditSnapshots.fetchedAt))
    .limit(1)
    .get();
  if (!snap) return undefined;
  return { ...snap, windows: getWindowsForSnapshot(db, snap.id) };
}

export function listSnapshotsForAccount(
  db: Db,
  accountId: string,
  limit = 50,
): SnapshotWithWindows[] {
  const snaps = db
    .select()
    .from(creditSnapshots)
    .where(eq(creditSnapshots.accountId, accountId))
    .orderBy(desc(creditSnapshots.fetchedAt))
    .limit(limit)
    .all();
  return snaps.map((s) => ({ ...s, windows: getWindowsForSnapshot(db, s.id) }));
}

function getWindowsForSnapshot(db: Db, snapshotId: string): CreditSnapshotRow[] {
  return db
    .select()
    .from(creditWindows)
    .where(eq(creditWindows.snapshotId, snapshotId))
    .all();
}
