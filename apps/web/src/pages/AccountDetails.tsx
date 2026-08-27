import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type AccountSummary, type Snapshot, type WindowType } from "../api.js";
import { CreditBar } from "../components/CreditBar.js";
import { StatusDot } from "../components/StatusDot.js";
import { formatValue } from "../components/format.js";

export function AccountDetails(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.getAccounts();
      const found = res.accounts.find((a) => a.id === id) ?? null;
      setAccount(found);
      setError(found ? null : "Account not found");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      await api.refreshAccount(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  if (error) {
    return <div className="text-rose-400 text-sm">{error}</div>;
  }
  if (!account) {
    return <div className="text-zinc-500 text-sm">Loading…</div>;
  }

  const snap = account.lastSnapshot;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <StatusDot status={account.status} />
            {account.providerName}
          </div>
          <h1 className="text-2xl mt-1">{account.name}</h1>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="text-sm px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {snap?.error && <ErrorState snapshot={snap} />}

      {snap && !snap.error && snap.windows.length > 0 && (
        <div className="space-y-4">
          {snap.windows.map((w) => (
            <div
              key={w.type}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400 uppercase tracking-wider text-xs">
                  {labelFor(w.type)}
                </span>
                <span className="text-zinc-500 font-mono">
                  fetched {timeAgo(snap.fetchedAt)}
                </span>
              </div>
              <CreditBar window={w} />
              <div className="text-xs text-zinc-500 font-mono">
                {formatValue(w.used, w.unit)} used of {formatValue(w.limit, w.unit)}
              </div>
            </div>
          ))}
        </div>
      )}

      {snap && !snap.error && snap.windows.length === 0 && (
        <div className="text-zinc-500 text-sm">No windows reported.</div>
      )}

      {!snap && (
        <div className="text-zinc-500 text-sm">No snapshot yet — click Refresh.</div>
      )}

      <div className="text-zinc-600 text-xs">
        Account ID: <code className="font-mono">{account.id}</code>
      </div>
    </div>
  );
}

function labelFor(type: WindowType): string {
  if (type === "5h") return "5 Hours";
  if (type === "daily") return "Daily";
  if (type === "weekly") return "Weekly";
  return "Monthly";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ErrorState({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  if (!snapshot.error) return <></>;
  return (
    <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 p-4 text-sm">
      <div className="text-rose-300 font-medium">{snapshot.error.code}</div>
      <div className="text-rose-200/80 mt-1">{snapshot.error.message}</div>
    </div>
  );
}
