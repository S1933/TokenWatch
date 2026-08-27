# TokenWatch

Local, read-only, multi-account AI credit monitor (CLI).

> **Single responsibility**: answer *"how many credits do I have left on each of my accounts, and when does each quota reset?"*

## What it does

- Reads credentials from **macOS Keychain** (no plaintext storage)
- Refreshes credits from 4 providers: **OpenCode Go**, **OpenRouter**, **Claude Code**, **Codex** (Codex is `unsupported` — see below)
- Outputs **JSON** by default for piping into `jq` / scripts
- Outputs **human-readable text** with `--human` for direct terminal viewing
- Persists snapshots in **SQLite** (local file, ignored by git)

## Why a CLI

Single-user, single-machine, read-only dashboard. No need for a server, a UI, or remote access. A CLI is faster to invoke, easier to script, and respects the *nix philosophy.

## Quickstart

```bash
pnpm install
pnpm help
```

### Add an account

```bash
pnpm add-account --provider opencode-go --name Personal --secret 'sk-...'
pnpm add-account --provider openrouter --name Personal --secret 'sk-or-v1-...'
pnpm add-account --provider claude-code --name Work --path ~/.claude/.credentials.json
pnpm add-account --provider codex --name Personal       # no credentials needed
```

The `--secret` value is stored in macOS Keychain under service `tokenwatch`, account `acc-<uuid>`. SQLite only stores the reference, never the secret.

### View credits

```bash
pnpm credits              # JSON (default)
pnpm credits --human      # human-readable text
pnpm credits --refresh    # force refresh from providers (default: use last snapshot)
```

Pipe to `jq` for filtering:

```bash
pnpm credits | jq '.accounts[] | select(.status == "warning") | {name, status, monthly: .snapshot.windows[] | select(.type == "monthly")}'
```

### List / remove

```bash
pnpm accounts                          # JSON list
pnpm remove-account <id>              # delete by id
```

## Providers

| Provider       | Status        | Source                                              |
| -------------- | ------------- | --------------------------------------------------- |
| **OpenCode Go**  | ✅ Implemented | `GET /zen/go/v1/usage` (Bearer)                    |
| **OpenRouter**   | ✅ Implemented | `/auth/key` + `/credits` (Bearer)                   |
| **Claude Code**  | ✅ Implemented | `GET /api/oauth/usage` (OAuth from credentials file) |
| **Codex**        | ⚠️ Unsupported | No public endpoint for ChatGPT subscription quota |

See `docs/providers.md` for the API shape of each provider.

## Stack

- **Monorepo**: pnpm workspaces
- **Core**: TypeScript (domain models, `ProviderAdapter` interface, 4 adapters)
- **DB**: SQLite + Drizzle, WAL mode, FK enforced
- **CLI**: TypeScript + tsx (no server, no UI)
- **Security**: macOS Keychain (`security` CLI) for all secrets

## Layout

```
tokenwatch/
├── apps/
│   └── api/                # CLI (was: Fastify server, now removed)
├── packages/
│   ├── core/               # ProviderAdapter, 4 adapters, types
│   └── db/                 # Drizzle schema, repositories, migrations
├── docs/
│   └── providers.md
└── package.json            # pnpm credits, pnpm credits:human, etc.
```

## Data location

- **DB**: `./data/tokenwatch.db` relative to the CLI's working directory (override with `TOKENWATCH_DB` env)
- **Keychain entries**: service `tokenwatch`, account `acc-<uuid>`

## Status

🚧 **POC** — see commit history. Currently 70 unit tests in core + 13 in db, all green.
