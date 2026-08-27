# TokenWatch

Local, read-only, multi-account AI credit monitor.

> **Single responsibility**: answer *"how many credits do I have left on each of my accounts, and when does each quota reset?"*

## Stack

- **Monorepo**: pnpm workspaces
- **Core**: TypeScript (domain models, `ProviderAdapter` interface, `MockProviderAdapter`)
- **API** *(Phase 7)*: Node.js + Fastify + Zod
- **Web** *(Phase 7)*: React + Vite + TypeScript
- **Data** *(Phase 2)*: SQLite + Drizzle
- **Security** *(Phase 3)*: macOS Keychain

## Status

🚧 **POC** — see [`docs/providers.md`](./docs/providers.md) for Phase 0 (Provider Discovery).

Current phase: **Phase 1 — Core**. No DB, no real adapters, no UI yet.

## Layout

```
tokenwatch/
├── apps/
│   ├── api/         # reserved (Phase 7)
│   └── web/         # reserved (Phase 7)
├── packages/
│   └── core/        # domain models, ProviderAdapter, MockProvider
├── docs/
│   └── providers.md
└── package.json
```

## Quickstart

```bash
pnpm install
pnpm test
```

## Roadmap

See `docs/providers.md` § "Plan de validation Phase 0 → Phase 1" for the full sprint breakdown.
