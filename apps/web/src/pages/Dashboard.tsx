import { useCallback, useEffect, useState } from "react";
import { api, type AccountSummary, type WindowType } from "../api.js";
import { CreditBar } from "../components/CreditBar.js";
import { StatusDot } from "../components/StatusDot.js";
import { formatValue } from "../components/format.js";

const PERIODS: { id: WindowType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "5h", label: "5 Hours" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export function Dashboard(): JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [period, setPeriod] = useState<WindowType | "all">("5h");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getCredits();
      setAccounts(res.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshAll();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  if (error) {
    return (
      <div className="text-rose-400 text-sm">Failed to load credits: {error}</div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-zinc-400 text-sm">
        No accounts configured. <a href="/accounts" className="text-sky-400 hover:underline">Add one</a>.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 text-sm">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-md ${
                period === p.id
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="text-sm px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {period === "all" ? (
        <AllPeriodsView accounts={accounts} />
      ) : (
        <SinglePeriodView accounts={accounts} period={period} />
      )}
    </div>
  );
}

function SinglePeriodView({
  accounts,
  period,
}: {
  accounts: AccountSummary[];
  period: WindowType;
}): JSX.Element {
  const groups = groupByProvider(accounts);
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.provider} className="space-y-2">
          <h2 className="text-zinc-400 text-sm uppercase tracking-wider">
            {group.providerName}
          </h2>
          {group.accounts.map((acc) => {
            const win = acc.lastSnapshot?.windows.find((w) => w.type === period);
            return (
              <div
                key={acc.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusDot status={acc.status} />
                    <span className="font-medium">{acc.name}</span>
                  </div>
                  {win ? (
                    <span className="text-zinc-500 text-sm font-mono">
                      {formatValue(win.used, win.unit)} used
                    </span>
                  ) : null}
                </div>
                {win ? (
                  <CreditBar window={win} />
                ) : acc.lastSnapshot?.error ? (
                  <ErrorState error={acc.lastSnapshot.error} />
                ) : (
                  <div className="text-zinc-500 text-sm">
                    No {period} window for this account.
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function AllPeriodsView({ accounts }: { accounts: AccountSummary[] }): JSX.Element {
  const periods: WindowType[] = ["5h", "weekly", "monthly"];
  return (
    <div className="space-y-8">
      {periods.map((period) => {
        const rows = accounts
          .map((a) => {
            const w = a.lastSnapshot?.windows.find((win) => win.type === period);
            return w ? { account: a, window: w } : null;
          })
          .filter((r): r is { account: AccountSummary; window: NonNullable<typeof r>["window"] } => r !== null);
        if (rows.length === 0) return null;
        return (
          <section key={period}>
            <h2 className="text-zinc-400 text-xs uppercase tracking-wider mb-2">
              {period.toUpperCase()}
            </h2>
            <table className="w-full text-sm">
              <thead className="text-zinc-500 text-left">
                <tr>
                  <th className="font-normal py-1">Account</th>
                  <th className="font-normal py-1 text-right">Available</th>
                  <th className="font-normal py-1 text-right">Reset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map(({ account, window: w }) => (
                  <tr key={account.id}>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <StatusDot status={account.status} />
                        {account.providerName} · {account.name}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">
                      {formatValue(w.remaining, w.unit)}
                    </td>
                    <td className="py-2 text-right text-zinc-400">
                      <ResetText resetAt={w.resetAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

function ResetText({ resetAt }: { resetAt: string | null }): JSX.Element {
  if (!resetAt) return <span className="text-zinc-600">—</span>;
  const d = new Date(resetAt);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return <span className="text-zinc-600">now</span>;
  const days = Math.floor(diff / 86400_000);
  const hours = Math.floor((diff % 86400_000) / 3600_000);
  if (days > 0) return <span>{days}d {hours}h</span>;
  const minutes = Math.floor((diff % 3600_000) / 60_000);
  return <span>{hours}h {minutes}m</span>;
}

function ErrorState({ error }: { error: { code: string; message: string } }): JSX.Element {
  return (
    <div className="text-rose-400 text-sm">
      <div className="font-medium">{error.code}</div>
      <div className="text-rose-300/80">{error.message}</div>
    </div>
  );
}

function groupByProvider(accounts: AccountSummary[]): Array<{
  provider: string;
  providerName: string;
  accounts: AccountSummary[];
}> {
  const map = new Map<string, AccountSummary[]>();
  for (const a of accounts) {
    const list = map.get(a.providerId) ?? [];
    list.push(a);
    map.set(a.providerId, list);
  }
  return Array.from(map.entries()).map(([provider, list]) => ({
    provider,
    providerName: list[0]?.providerName ?? provider,
    accounts: list,
  }));
}
