import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AccountSummary, type ProviderSlug } from "../api.js";
import { StatusDot } from "../components/StatusDot.js";

const PROVIDER_LABELS: Record<ProviderSlug, string> = {
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  "claude-code": "Claude Code",
  codex: "Codex",
};

export function AccountsList(): JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getAccounts();
      setAccounts(res.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm("Delete this account?")) return;
    try {
      await api.deleteAccount(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const groups = groupByProvider(accounts);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">Accounts</h1>
        <button
          onClick={() => setAdding(true)}
          className="text-sm px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500"
        >
          + Add account
        </button>
      </div>

      {error && <div className="text-rose-400 text-sm">{error}</div>}

      {accounts.length === 0 && !adding && (
        <div className="text-zinc-500 text-sm">No accounts yet.</div>
      )}

      <div className="space-y-6">
        {groups.map(({ provider, providerName, accounts: list }) => (
          <section key={provider}>
            <h2 className="text-zinc-400 text-sm uppercase tracking-wider mb-2">
              {providerName}
            </h2>
            <div className="space-y-1">
              {list.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <StatusDot status={a.status} />
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-zinc-500 text-xs">
                        {a.status} · {a.credentialsKind}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Link
                      to={`/accounts/${a.id}`}
                      className="text-zinc-400 hover:text-zinc-100"
                    >
                      Details
                    </Link>
                    <button
                      onClick={() => void remove(a.id)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {adding && <AddAccountForm onClose={() => setAdding(false)} onCreated={load} />}
    </div>
  );
}

function groupByProvider(accounts: AccountSummary[]): Array<{
  provider: ProviderSlug;
  providerName: string;
  accounts: AccountSummary[];
}> {
  const map = new Map<ProviderSlug, AccountSummary[]>();
  for (const a of accounts) {
    const list = map.get(a.providerId) ?? [];
    list.push(a);
    map.set(a.providerId, list);
  }
  return Array.from(map.entries()).map(([provider, list]) => ({
    provider,
    providerName: PROVIDER_LABELS[provider],
    accounts: list,
  }));
}

function AddAccountForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}): JSX.Element {
  const [providerId, setProviderId] = useState<ProviderSlug>("opencode-go");
  const [name, setName] = useState("");
  const [keychainRef, setKeychainRef] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let credentials:
        | { kind: "api_key"; keychainRef: string }
        | { kind: "oauth_file"; path: string }
        | { kind: "manual" };
      if (providerId === "claude-code") {
        credentials = { kind: "oauth_file", path };
      } else if (providerId === "codex") {
        credentials = { kind: "manual" };
      } else {
        credentials = { kind: "api_key", keychainRef };
      }
      await api.createAccount({ providerId, name, credentials });
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4"
      >
        <h2 className="text-lg">Add account</h2>

        <label className="block text-sm">
          <span className="text-zinc-400">Provider</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value as ProviderSlug)}
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2"
          >
            {(Object.keys(PROVIDER_LABELS) as ProviderSlug[]).map((slug) => (
              <option key={slug} value={slug}>
                {PROVIDER_LABELS[slug]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-zinc-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Personal"
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2"
            required
          />
        </label>

        {(providerId === "opencode-go" || providerId === "openrouter") && (
          <label className="block text-sm">
            <span className="text-zinc-400">Keychain reference</span>
            <input
              type="text"
              value={keychainRef}
              onChange={(e) => setKeychainRef(e.target.value)}
              placeholder="openrouter/personal"
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 font-mono"
              required
            />
            <span className="text-zinc-600 text-xs block mt-1">
              e.g. <code>security add-generic-password -s tokenwatch -a "{keychainRef || "openrouter/personal"}" -w</code>
            </span>
          </label>
        )}

        {providerId === "claude-code" && (
          <label className="block text-sm">
            <span className="text-zinc-400">Credentials file path</span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/x/.claude-work/.credentials.json"
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 font-mono"
              required
            />
            <span className="text-zinc-600 text-xs block mt-1">
              On macOS, run <code>security find-generic-password -s "Claude Code-credentials" -w</code> and save to a file.
            </span>
          </label>
        )}

        {providerId === "codex" && (
          <div className="text-zinc-500 text-sm bg-zinc-950 border border-zinc-800 rounded-md p-3">
            Codex will be created in <code>manual</code> mode. Quota tracking is currently unsupported.
          </div>
        )}

        {error && <div className="text-rose-400 text-sm">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="text-sm px-3 py-1.5 rounded-md bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
