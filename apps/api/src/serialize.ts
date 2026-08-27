type SnapshotLike =
  | {
      id: string;
      accountId: string;
      fetchedAt: Date;
      errorCode: string | null;
      errorMessage: string | null;
      windows: ReadonlyArray<{
        type: string;
        used: number;
        limit: number;
        remaining: number;
        unit: string;
        resetAt: Date | null;
      }>;
    }
  | undefined;

export function serializeSnapshot(snap: SnapshotLike) {
  if (!snap) return null;
  return {
    id: snap.id,
    accountId: snap.accountId,
    fetchedAt: snap.fetchedAt.toISOString(),
    error: snap.errorCode
      ? { code: snap.errorCode, message: snap.errorMessage ?? "" }
      : null,
    windows: snap.windows.map((w) => ({
      type: w.type,
      used: w.used,
      limit: w.limit,
      remaining: w.remaining,
      unit: w.unit,
      resetAt: w.resetAt ? w.resetAt.toISOString() : null,
    })),
  };
}
