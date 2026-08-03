# OIDC

Two independent Next.js apps demonstrating OIDC authentication backed by [Ory
Kratos](https://www.ory.sh/kratos/) as the sole identity/session source of truth, each fronted by
a different OIDC provider, for side-by-side architectural comparison:

| | Provider | Bridge | Refresh tokens |
| --- | --- | --- | --- |
| **[`dex-oathkeeper-kratos/`](dex-oathkeeper-kratos/)** (Approach A) | [Dex](https://dexidp.io/) | [Ory Oathkeeper](https://www.ory.sh/oathkeeper/) (`authproxy` connector + header injection) | Not supported by Dex's `authproxy` connector — sessions renew via silent re-authorization instead |
| **[`hydra-kratos/`](hydra-kratos/)** (Approach B) | [Ory Hydra](https://www.ory.sh/hydra/) | Custom login/consent bridge routes in the app itself | Real, standards-compliant `refresh_token` grant |

Each app is fully self-contained (own `deploy/compose.yml`, own `.env`, runs on the host against
its own Docker Compose stack) and can be run independently. See each app's own README for setup
and testing instructions.

## Where to start

- **Just want to run one?** Go to [`dex-oathkeeper-kratos/README.md`](dex-oathkeeper-kratos/README.md)
  or [`hydra-kratos/README.md`](hydra-kratos/README.md).
- **Want the comparison findings?** See [`specs/COMPARISON.md`](specs/COMPARISON.md) — the actual
  deliverable this exercise was built to produce: why Dex can't issue refresh tokens, how each
  approach compensates, and the asymmetric edge case a real refresh grant introduces that silent
  re-authorization can't even express.
- **Want the full design history?** Each app has its own spec under `specs/` —
  [`specs/001-oidc-dex-oathkeeper/`](specs/001-oidc-dex-oathkeeper/) and
  [`specs/002-oidc-hydra-kratos/`](specs/002-oidc-hydra-kratos/) — including `spec.md`,
  `research.md`, `data-model.md`, `contracts/app-routes.md`, `quickstart.md`, and `tasks.md`.

## Repository layout

```
dex-oathkeeper-kratos/   Approach A: Next.js app + Dex/Oathkeeper/Kratos Docker Compose stack
hydra-kratos/             Approach B: Next.js app + Hydra/Kratos Docker Compose stack
specs/                    Design docs and task breakdowns for both approaches, plus COMPARISON.md
```
