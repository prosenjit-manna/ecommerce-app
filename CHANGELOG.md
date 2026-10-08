# Changelog

This file tracks what has been implemented, phase by phase. See [ROADMAP.md](ROADMAP.md) for the full plan.

Format: loosely based on [Keep a Changelog](https://keepachangelog.com/). Newest entries go at the top of the log.
Entry types: **Added**, **Changed**, **Removed**, **Fixed**, **Learned** (key takeaways, gotchas, links to ADRs).

---

## Progress

| Phase | Name | Weeks | Status |
|---|---|---|---|
| 0 | Foundations | 1 | 🟡 In progress |
| 1 | Microservices Core | 2–11 | 🟡 In progress (auth service built) |
| 2 | Containers & CI | 12–13 | ⚪ Not started |
| 3 | AWS Core + Terraform | 14–17 | ⚪ Not started |
| 4 | Kubernetes + GitOps | 18–23 | ⚪ Not started |
| 5 | React Native Mobile App | 24–29 | ⚪ Not started |
| 6 | Hardening & Portfolio | 30–32 | ⚪ Not started |

Legend: ⚪ Not started · 🟡 In progress · ✅ Done (the "Done when" checklist passed)

### Phase 0 checklist
- [x] Directory structure (`apps/`, `services/`, `packages/`, `infra/`, `gitops/`, `docs/adr/`)
- [x] Changelog
- [x] TypeScript strict (shared `packages/config-ts`)
- [ ] ESLint + Prettier (shared `packages/config-eslint`)
- [ ] Husky + commitlint (conventional commits)
- [x] `compose.yaml`: Postgres, Redis, Mailpit (+ LocalStack)
- [ ] `packages/service-kit` + Apollo Router with one "hello" subgraph
- [ ] First ADR in `docs/adr/`
- [x] Move the compose file from `apps/api/` to the repo root (`compose.yaml`)
- [ ] Publish `config-ts` to npm under your scope
- [ ] **Done when:** `podman compose --profile apps up` starts the deps, the router and a subgraph with one command, and a query through `localhost:4000` reaches the subgraph

---

## Log

### 2026-10-08 · Planning
**Changed**
- Tooling: **no monorepo, and Yarn 4 instead of pnpm.** Each service, app and package is a standalone Yarn project in this one git repo (`nodeLinker: node-modules`). The pnpm workspace root and Turborepo were dropped. Shared packages will be published to public npm and installed by version. `services/auth` was moved to Yarn with an inlined tsconfig.
- Observability: API usage, success rate and failure rate tracked in **Grafana** from Phase 1 (Prometheus metrics from every service and the router, dashboards and alerts as code). Added to `ROADMAP.md` and the `docs/backend-api.md` tech stack.
- Testing: **Jest** (not Vitest) for unit and integration tests in every service, matching mobile. Each service ships unit tests in the week it's built. Recorded in the `docs/backend-api.md` tech stack.
- Architecture: **microservices from day one**, so the modular-monolith phase is gone. `docs/backend-api.md`, the folder READMEs and the compose setup were updated to match: `compose.yaml` is now at the repo root, `infra/local/postgres-init/` creates a database per service, and `apps/api/` was removed. `ROADMAP.md` was rewritten: Phase 1 is now "Microservices Core" (weeks 2–11), the old Phase 4 was folded into it, and the later phases were renumbered. It adds a service map, communication rules, and a `packages/service-kit`.

### 2026-10-08 · Auth subgraph
**Added**
- `services/auth/insomnia/collection.yaml`: Insomnia v5 collection that doubles as the auth API docs. It has a Markdown description per request (inputs, every result type, rate limits, side effects), after-response scripts that save `challengeId` and tokens and run tests, a pre-request script that reads OTP codes from Mailpit, error-case requests, Federation and REST folders, and `local`/`gateway`/`staging` environments.
- `services/auth`: standalone Apollo Federation v2 subgraph (Express 5, Apollo Server 5, Drizzle, port 4001) that owns the `User` entity.
- Signup with email verification, password + email OTP 2-step login (on by default per user, can be toggled with `setTwoFactor`), forgot/reset password via an emailed code.
- EdDSA (Ed25519) JWT access tokens (15 min), served at `/.well-known/jwks.json`, plus rotating single-use refresh tokens with reuse detection.
- Per-device sessions (device, created/last IP, GeoLite2 location), `mySessions`, `revokeSession`, `revokeOtherSessions`, `logout`, and a `myAuthEvents` security history.
- Instant revocation of live access tokens through a Redis revoked-session list.
- Rate limiting with `rate-limiter-flexible` + Redis: a global per-IP limit plus per-operation limits and a brute-force lock.
- `packages/config-ts` and a Postgres init script that creates one database per service.

**Learned**
- drizzle-kit's migrations table can't live in the schema that the first migration creates, so it stays in the default `drizzle` schema.
- GraphQL rejects fragments on types outside a union, which is why every failure type implements a shared `UserError` interface.

### 2026-10-05 · Phase 0
**Added**
- Project directory structure, with a README in each top-level folder describing its purpose and phase.
- `CHANGELOG.md` to track implementation progress.

**Changed**
- Backend framework: Express 5 + TypeScript (Fastify removed from the roadmap).

### 2026-10-01 · Planning
**Added**
- `ROADMAP.md`: 32-week learning plan (backend → containers/CI → AWS → microservices → Kubernetes/GitOps → React Native).
