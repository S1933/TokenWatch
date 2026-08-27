# Provider Discovery — Phase 0

> **Objectif** : avant d'écrire le moindre adapter, savoir exactement **quelle** donnée de quota on peut récupérer, **par quelle méthode d'auth**, et **sous quelle forme**, pour chacun des 4 providers cibles.
>
> **Date de recherche** : 2026-08-27
>
> ⚠️ Ce document repose sur de la documentation publique + reverse-engineering observé dans des projets open-source (onWatch, codex-reset, opencode-bar, ccusage, openusage). Rien ici n'a été **vérifié en exécutant un appel API réel**. Avant la Phase 3, je validerai chaque endpoint en local.

---

## Synthèse risque

| Provider       | API publique quota ? | Auth                   | Multi-account | Difficulté | Note                                  |
| -------------- | -------------------- | ---------------------- | ------------- | ---------- | ------------------------------------- |
| **OpenCode Go** | ✅ (PR mergée)        | API Key (Bearer)       | Natif         | 🟢 Facile  | Endpoint dispo : `GET /zen/go/v1/usage` |
| **OpenRouter**  | ⚠️ Partiel            | API Key (Bearer)       | Natif         | 🟡 Moyen   | Pas de fenêtre temporelle native      |
| **Claude Code** | ✅ Officiel           | OAuth                  | Workaround    | 🟡 Moyen   | Endpoint officiel `/api/oauth/usage`  |
| **Codex**       | ❌ Reverse-engineered | OAuth (ChatGPT) / Key  | Workaround    | 🔴 Difficile | Aucun endpoint quota documenté       |

**Conclusion** : OpenCode Go est le plus simple à intégrer. Codex est le principal risque technique et tombera probablement en mode `status: manual` ou `status: experimental` au début.

---

## 1. OpenCode Go

### Description
Plan d'abonnement OpenCode ($10/mois, $5 premier mois) donnant accès à ~18 modèles open-weight avec **limites en dollars** plutôt qu'en requests.

### Limites (USD)
| Fenêtre | Limite  |
| ------- | ------- |
| 5h rolling | $12 |
| Weekly | $30 |
| Monthly | $60 |

### Authentification
**API Key (Bearer token)** — recommandée et désormais officielle (PR #2879 mergée dans le repo opencode).

```bash
curl https://opencode.ai/zen/go/v1/usage \
  -H "Authorization: Bearer $OPENCODE_GO_KEY"
```

### Endpoint quota
```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <key>
```

### Réponse attendue (proposée dans issue #31084)
```json
{
  "rolling5h": { "usageDollars": 2.34, "limitDollars": 12, "usagePercent": 19.5, "resetInSec": 7200 },
  "weekly":    { "usageDollars": 8.91, "limitDollars": 30, "usagePercent": 29.7, "resetInSec": 345600 },
  "monthly":   { "usageDollars": 15.00, "limitDollars": 60, "usagePercent": 25.0, "resetInSec": 1414800 }
}
```

### Mapping vers CreditSnapshot
| Window | `type` | `unit` | `used` | `limit` | `remaining` | `resetAt` |
| ------ | ------ | ------ | ------ | ------- | ----------- | --------- |
| 5h     | `5h`   | `usd`  | `usageDollars` | `limitDollars` | `limitDollars - usageDollars` | now + `resetInSec` |
| Weekly | `weekly` | `usd` | idem | idem | idem | idem |
| Monthly | `monthly` | `usd` | idem | idem | idem | idem |

### Fenêtres exposées
3 : `5h`, `weekly`, `monthly`.

### Multi-account
**Natif** : un compte = une API key. Posséder N comptes = N keys à stocker, pas de complication.

### Fallback (si endpoint non dispo)
Si `GET /zen/go/v1/usage` retourne 404 ou n'est pas déployé :
- **Méthode legacy** : dashboard scraping avec `OPENCODE_GO_AUTH_COOKIE` + `OPENCODE_GO_WORKSPACE_ID`
- Endpoints historiques : `https://opencode.ai/workspace/{id}/billing` (scraping HTML)
- **À éviter** : trop fragile, change à chaque release UI

### Rate limits
Pas documentés publiquement. Projet `opencode-bar` interroge toutes les 60s sans problème.

### Sources
- [opencode.ai/docs/go](https://opencode.ai/docs/go/)
- Issue [#31084 — Public API for Go plan usage/limits](https://github.com/anomalyco/opencode/issues/31084) (closed, completed)
- Issue [#16017 — Add Go plan usage/balance API endpoint](https://github.com/anomalyco/opencode/issues/16017) (PR #16513 merged)
- [opgginc/opencode-bar](https://github.com/opgginc/opencode-bar)

---

## 2. OpenRouter

### Description
Gateway OpenAI-compatible unifiant 378+ modèles. Facturation par **crédits USD prépayés**.

### Authentification
**API Key (Bearer token)** — il y a 2 types :
1. **Regular key** : pour les appels modèles + `GET /auth/key` (metadata)
2. **Management key** : pour `/credits`, `/keys`, `/workspaces/*` (admin)

Pour le POC, l'utilisateur doit fournir au moins une **management key** si on veut `/credits`. Sinon, fallback sur agrégation locale à partir de l'historique.

### Endpoints utiles

| Endpoint | Auth requise | Retour |
| -------- | ------------ | ------ |
| `GET /api/v1/auth/key` | Regular | Metadata clé courante (label, usage, limit, limit_remaining, limit_reset) |
| `GET /api/v1/credits` | Management | `{ total_credits, total_usage }` (lifetime) |
| `GET /api/v1/keys` | Management | Liste de toutes les clés avec leurs limits |
| `GET /api/v1/activity` | Regular | Activité récente (groupée par date) |
| `GET /api/v1/datasets/rankings-daily` | Regular | Public rankings |

### Fenêtres exposées
**⚠️ Problème central** : `/credits` ne retourne PAS de fenêtres temporelles. C'est un compteur lifetime.

Pour obtenir des fenêtres 5h/weekly/monthly, deux options :
1. **Agrégation locale** : stocker snapshots en local et calculer la delta (cf. `window_credit_spend` dans `openusage`)
2. **Workspaces Enterprise** : `GET /api/v1/workspaces/{id}/budgets/{interval}` — budgets daily/weekly/monthly/lifetime, mais **Enterprise only**

### Mapping vers CreditSnapshot
Pour le POC, deux fenêtres représentables nativement :
| Window | Source | `unit` |
| ------ | ------ | ------ |
| `monthly` (lifetime) | `/credits` | `usd` |
| Clé courante | `/auth/key` (champ `usage`, `limit`, `limit_remaining`) | `usd` |

Pour daily/weekly : **computed** via delta local, pas via API.

### Multi-account
**Natif** : plusieurs API keys, chacune avec son propre limit. Le `GET /keys` (avec management key) liste tout.

### Rate limits
- Par clé, limitée en fonction du plan
- Headers de réponse : `x-ratelimit-*` (à vérifier)
- Recommandation : ne pas poller plus d'1×/30s

### Sources
- [openrouter.ai/docs/api-reference/credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits)
- [openrouter.ai/docs/api-reference/authentication](https://openrouter.ai/docs/api_reference/authentication)
- [janekbaraniewski/openusage — openrouter.md](https://github.com/janekbaraniewski/openusage/blob/main/docs/site/docs/providers/openrouter.md)

---

## 3. Claude Code (Anthropic)

### Description
CLI d'Anthropic. Authentifié via OAuth, utilise les quotas d'abonnement (Pro/Max/Team/Enterprise) ou pay-per-token (API key).

### Authentification
**OAuth token** (subscription) stocké dans :
- **macOS** : Keychain service `Claude Code-credentials`
- **Linux** : `~/.claude/.credentials.json` (chmod 600)
- **Windows** : `%USERPROFILE%\.claude\.credentials.json`

Header requis sur les appels API :
```
anthropic-beta: oauth-2025-04-20
Authorization: Bearer <access_token>
```

Pour CI : `claude setup-token` génère un token 1 an.

### Endpoints utiles

| Endpoint | Usage |
| -------- | ----- |
| `GET https://api.anthropic.com/api/oauth/profile` | Email, tier, plan |
| `GET https://api.anthropic.com/api/oauth/usage` | Utilization 5h/7d + reset times |

### Réponse `/api/oauth/usage` (attendue)
```json
{
  "five_hour": { "utilization": 0.42, "resets_at": "2026-08-27T22:18:00Z" },
  "seven_day": { "utilization": 0.28, "resets_at": "2026-08-30T16:00:00Z" },
  "seven_day_sonnet": { "utilization": 0.15, "resets_at": "..." },
  "seven_day_opus":   { "utilization": 0.31, "resets_at": "..." }
}
```

### Fenêtres exposées
- `5h` (rolling)
- `7d` (rolling)
- Éventuellement des fenêtres par modèle (Sonnet/Opus) en fonction du plan

### Mapping vers CreditSnapshot
| Window | `type` | `unit` | `used` | `limit` | `remaining` | `resetAt` |
| ------ | ------ | ------ | ------ | ------- | ----------- | --------- |
| 5h | `5h` | `percent` | `utilization * 100` | `100` | `100 - utilization * 100` | `resets_at` |
| 7d | `weekly` | `percent` | idem | idem | idem | idem |

⚠️ **Note** : Claude Code ne donne pas de "credits absolus", juste un % d'utilisation. Notre modèle `CreditSnapshot` supporte `unit: "percent"` ou on garde l'unit `credits` avec `limit=100` et `remaining=100-utilization*100`.

### Alternative : headers d'API
Chaque réponse API inclut :
- `anthropic-ratelimit-unified-{claim}-utilization`
- `anthropic-ratelimit-unified-{claim}-reset`
- `anthropic-ratelimit-unified-status`

Ces headers donnent la même info mais nécessitent de **faire un vrai appel API** à chaque refresh. Plus lourd que `/api/oauth/usage`.

### Multi-account
**Pas natif**. Le CLI ne supporte qu'un compte actif à la fois.

Workarounds existants (à ne pas réinventer) :
- `CLAUDE_CONFIG_DIR` env var : un dossier par compte (méthode officielle)
- Outils tiers : `cc-switch`, `cc-auth`, `claude-code-multi-accounts`

**Pour le POC** : on lit chaque `~/.claude-{label}/.credentials.json` indépendamment. Pas besoin de switcher, juste de lire en parallèle.

### Rate limits
- `/api/oauth/usage` : pas de limite documentée, à confirmer
- Recommandation : refresh toutes les 60s minimum

### Sources
- [code.claude.com/docs/en/authentication](https://code.claude.com/docs/en/authentication)
- [code.claude.com/docs/en/monitoring-usage](https://code.claude.com/docs/en/monitoring-usage)
- [github.com/wakamex/ccusage](https://github.com/wakamex/ccusage) — implémentation de référence
- [github.com/rsnodgrass/claude-code-auth](https://github.com/rsnodgrass/claude-code-auth) — multi-account

---

## 4. Codex (OpenAI)

### Description
CLI d'OpenAI pour Codex. **Deux chemins d'auth** fondamentalement différents :

| Path | Auth | Quota | Modèles |
| ---- | ---- | ----- | ------- |
| **ChatGPT** | OAuth | 5h rolling + weekly (message-based) | Catalogue ChatGPT |
| **API Key** | `OPENAI_API_KEY` (Bearer) | RPM/TPM tiers (pay-per-token) | Tout le catalogue OpenAI |

⚠️ **Le POC cible le path ChatGPT** (c'est là qu'il y a un "quota" à monitorer). Le path API key n'a pas vraiment de notion de quota = rien à afficher.

### Authentification ChatGPT
**OAuth** stocké dans `~/.codex/auth.json` :
```json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "...",
    "refresh_token": "...",
    "last_refresh": "2026-08-27T..."
  }
}
```

Le token est rafraîchi automatiquement par le CLI (built-in) si > 8 jours.

### ⚠️ Endpoint quota : **NON DOCUMENTÉ**
Contrairement à Claude Code, **OpenAI n'expose pas officiellement** d'endpoint pour récupérer le quota ChatGPT Codex.

Reverse-engineering observé dans des projets open-source :
- `onWatch` (Go) : interroge un endpoint `chatgpt.com/backend-api/codex/...` (non documenté)
- `codex-reset` (CLI) : endpoint "experimental"
- `caut` (Rust) : web + cookie scraping
- `Dicklesworthstone/coding_agent_usage_tracker` : web scraping

**Pour le POC** : on doit choisir entre :
1. **Web scraping** du dashboard ChatGPT (fragile, peut casser)
2. **Cookie-based auth** vers un endpoint privé (expérimental, peut violer ToS)
3. **Status `unsupported`** par défaut pour Codex dans la v1
4. **Status `manual`** : l'utilisateur entre ses valeurs à la main

**Recommandation** : commencer par `unsupported`/`manual` pour le POC, puis explorer en Phase 6 si temps/budget.

### Format si on récupérait les données
| Path | Window | Unit | Source probable |
| ---- | ------ | ---- | --------------- |
| ChatGPT | 5h rolling | messages ou credits | reverse-engineering |
| ChatGPT | weekly | messages ou credits | idem |
| API key | n/a | n/a | pas de quota à monitorer |

### Multi-account ChatGPT
**Pas natif**. Le CLI ne supporte qu'un compte à la fois.

Workaround : un `CODEX_HOME` par compte, soit `~/.codex`, `~/.codex-b`, etc.

**Pour le POC** : on lit chaque `auth.json` indépendamment. Comme pour Claude Code.

### Refresh des tokens
- Auto-refresh si > 8 jours
- Sinon 401 → refresh-and-retry built-in
- Pour notre usage : pas besoin de gérer le refresh nous-mêmes, on lit juste le token actuel

### Rate limits
- Endpoints reverse-engineered : aucun SLA, risque de ban
- Recommandation : ne pas poller plus d'1×/5min sur un endpoint non documenté

### Sources
- [github.com/openai/codex](https://github.com/openai/codex)
- [codex.danielvaughan.com — authentication](https://codex.danielvaughan.com/2026/04/01/codex-cli-authentication-flows-credential-management/)
- [github.com/hcsolakoglu/codex-reset](https://github.com/hcsolakoglu/codex-reset) — reset credits
- [github.com/onllm-dev/onWatch](https://github.com/onllm-dev/onWatch) — Codex multi-account
- [github.com/ndycode/codex-multi-auth](https://github.com/ndycode/codex-multi-auth) — multi-account OAuth

---

## 5. Décisions d'architecture découlant de la Discovery

### 5.1 Modèle `CreditWindow.unit`
On garde l'enum `credits | usd | percent | tokens | messages`. Les 4 providers se répartissent :
- **OpenCode Go** : `usd`
- **OpenRouter** : `usd`
- **Claude Code** : `percent` (avec `limit: 100`, `used: utilization * 100`)
- **Codex** : `messages` ou `credits` (si on arrive à récupérer)

### 5.2 Multi-account strategy
| Provider | Comment on isole N comptes |
| -------- | -------------------------- |
| OpenCode Go | N API keys → stockées dans Keychain (`opencode-go/personal`, `opencode-go/backup`) |
| OpenRouter | N API keys → Keychain (`openrouter/personal`) — 1 seule suffit en pratique |
| Claude Code | N `CLAUDE_CONFIG_DIR` → pointe sur `~/.claude-{label}/.credentials.json` |
| Codex | N `CODEX_HOME` → pointe sur `~/.codex-{label}/auth.json` |

**Conséquence** : l'interface `Account` doit pouvoir porter, par provider, des champs spécifiques :
```ts
type AccountCredentials =
  | { kind: "api_key"; keychainRef: string }
  | { kind: "oauth_file"; path: string }     // Claude Code / Codex
  | { kind: "oauth_cookie"; cookie: string; workspaceId: string }  // OpenCode legacy
```

### 5.3 Refresh strategy
- **5 min** par défaut (background)
- **Manuelle** via bouton `↻ Refresh`
- **Par compte** : si Claude Code est down, OpenCode Go continue
- **Status** par compte : `healthy` | `warning` | `error` | `unsupported` | `manual`

### 5.4 Stratégie Codex (Phase 6)
- v1 : `status: "unsupported"` (pas d'adapter), bouton "manual" pour entrer ses valeurs
- v2 (optionnel) : exploration de l'endpoint non documenté avec gestion d'erreur robuste
- Si aucun chemin propre : rester en `unsupported` indefinitely

### 5.5 OpenRouter daily/weekly/monthly
- v1 : on expose seulement "credits restants" (lifetime)
- v2 : on calcule des deltas locaux à partir de l'historique SQLite → on peut déduire daily/weekly/monthly
- v2 (Enterprise only) : utilisation des workspace budgets

---

## 6. Plan de validation Phase 0 → Phase 1

Avant de coder les adapters, je dois valider ces hypothèses en local. **Pour chaque provider**, je dois :

### OpenCode Go
- [ ] Créer une API key sur https://opencode.ai
- [ ] `curl https://opencode.ai/zen/go/v1/usage -H "Authorization: Bearer $KEY"` → vérifier le format
- [ ] Si 404 : basculer sur fallback cookie + scraping (ou status: manual)

### OpenRouter
- [ ] Créer une regular key + management key
- [ ] `curl https://openrouter.ai/api/v1/auth/key` et `/credits`
- [ ] Vérifier que la regular key retourne bien les `usage`, `limit`, `limit_remaining`, `limit_reset`

### Claude Code
- [ ] S'assurer que `claude` est installé et authentifié
- [ ] `curl https://api.anthropic.com/api/oauth/usage -H "Authorization: Bearer $(security find-generic-password -s 'Claude Code-credentials' -w)" -H "anthropic-beta: oauth-2025-04-20"`
- [ ] Vérifier la structure de réponse

### Codex
- [ ] S'assurer que `codex` est installé et authentifié
- [ ] Tenter d'explorer l'endpoint non documenté OU
- [ ] Décider de partir sur `status: unsupported` d'emblée

**Livrable Phase 0** : ce document mis à jour avec les **vraies réponses API**, puis passage à la Phase 1 (Core + MockProvider).

---

## 7. Risques résiduels

| Risque | Impact | Mitigation |
| ------ | ------ | ---------- |
| OpenCode Go `/usage` pas encore déployé | 🟠 Moyen | Fallback cookie+scraping documenté |
| OpenRouter pas de fenêtre temporelle | 🟢 Faible | Agrégation locale via historique |
| Claude Code `/oauth/usage` change de format | 🟡 Moyen | Tests de régression, versioning |
| Codex endpoint non documenté | 🔴 Élevé | Default `unsupported`, pas de hack fragile |
| Multi-account Claude/Codex via env vars | 🟡 Moyen | Lire les fichiers credentials en parallèle (pas de switch) |
| Tokens OAuth expirés | 🟢 Faible | `last_refresh` check, prompt re-auth |

---

## 8. Décision recommandée

Vu l'analyse :

- **Phase 1 (Mock + Core)** : immédiate, aucun risque
- **Phase 2 (DB)** : immédiate après
- **Phase 3 (OpenRouter)** : **le vrai premier** car le plus simple après le mock
- **Phase 4 (OpenCode Go)** : deuxième réel, API publique, facile
- **Phase 5 (Claude Code)** : troisième, endpoint officiel mais OAuth à gérer
- **Phase 6 (Codex)** : **status `unsupported` par défaut** + exploration prudente ; ne pas perdre de temps sur du reverse-engineering fragile dans le POC

**C'est la position que je vais tenir en Phase 5/6 si tu confirmes le plan.**
