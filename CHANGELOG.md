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
- [x] Prometheus + Grafana in compose (`apps` profile)
- [ ] `packages/service-kit` + Apollo Router with one "hello" subgraph (router ✅ in compose with the auth subgraph; `service-kit` still to do)
- [ ] First ADR in `docs/adr/`
- [x] Move the compose file from `apps/api/` to the repo root (`compose.yaml`)
- [ ] Publish `config-ts` to npm under your scope
- [ ] **Done when:** `podman compose --profile apps up` starts the deps, the router and a subgraph with one command, and a query through `localhost:4000` reaches the subgraph

---

## Log

### 2026-10-09 · Service metrics (`@ecommerce/service-kit/metrics`)
**Added**
- `packages/service-kit`: a standalone Yarn package, `@ecommerce/service-kit` 0.1.0 (not published yet). Its `createMetrics({ service })` returns one Prometheus registry with:
  - `http_requests_total{method, route, status}` and `http_request_duration_seconds`. These also cover what Apollo never sees: rate-limit 429s, body-parser 400s, REST routes and 404s. `route` is the route pattern, never the raw URL.
  - `graphql_operations_total{operation, type, outcome, result}`, counted per root field, plus the `graphql_operation_duration_seconds` histogram. `outcome` follows the roadmap classification (`success` / `user_error` / `client_error` / `server_error`). `user_error` means the result implements `UserError`, read from the schema. `result` is the union typename, e.g. `InvalidCredentials`.
  - Node.js runtime metrics (`nodejs_*`, `process_*`) and a `service` label on every series.
- `services/auth`: serves `GET /metrics` and uses the GraphQL plugin. Prometheus's `services` job is now UP.

**Changed**
- `prometheus.yml`: the `services` job no longer adds a static `service` label. The app sets it, and a duplicate would be renamed to `exported_service`.

**Learned**
- The `operation` label is the **root field name**, not the client's operation name. Clients can send any name (unbounded series), and through the router it arrives rewritten (`Login__auth__0`).
- A linked package can load a second copy of `graphql`, and graphql's `instanceof` helpers (`isObjectType`) break across copies. The plugin checks `Symbol.toStringTag` instead.

**To do before committing auth:** `@ecommerce/service-kit` is consumed through `yarn link`, and auth's `package.json` holds a `resolutions` entry with an absolute `portal:` path. Publish 0.1.0 to npm, run `yarn unlink @ecommerce/service-kit` in auth, then `yarn install`.

### 2026-10-09 · Prometheus + Grafana
**Added**
- `prometheus` (v3.15.0, `:9090`) and `grafana` (13.2.3, `:3000`) in `compose.yaml` under the `apps` profile, so `podman compose --profile apps up -d` starts them with the router.
- `infra/observability/prometheus/prometheus.yml`: scrapes the router (`router:9080`) and Prometheus itself every 15s. It also has an `auth` target on the host (`host.containers.internal:4001`), which stays down until auth exposes `/metrics` (week 2). The config reloads with `POST /-/reload`.
- Grafana provisioning: a Prometheus data source (`uid: prometheus`) and a file provider for `infra/observability/grafana/dashboards/`. Local access is anonymous Admin with no login form.
- **Router overview** dashboard: requests/s, router p50/p95/p99, GraphQL errors by code, operations by HTTP status, p95 and request rate per subgraph, query-planning p95, and scrape-target health.

**Learned**
- Prometheus **pulls**: the router only keeps counters in memory and serves them as text. Nothing is stored until a server scrapes them, and they reset when the router restarts.
- `rate()` needs at least two scrapes inside its window, so traffic sent before the first scrape shows 0. Dashboards use `$__rate_interval`, which Grafana sizes to the scrape interval.

### 2026-10-09 · Root Insomnia collection
**Added**
- `insomnia/collection.yaml`: every API in one collection, **generated** by `insomnia/build.mjs` (`yarn build`) from `services/*/insomnia/collection.yaml`. GraphQL goes through the router; Federation and REST requests go straight to each service (`authUrl`, ...).
- `services/api-gateway/insomnia/collection.yaml`: a router smoke query (which also checks the `x-request-id` echo), `GET /health` (:8088) and `GET /metrics` (:9080).

### 2026-10-09 · API gateway
**Added**
- `apps/api-gateway`: **Apollo Router v2.18** on `localhost:4000/graphql` (Sandbox in the browser), fully containerized under the compose `apps` profile, so nothing is installed on the host. `podman compose --profile apps up -d` starts it.
- `supergraph` compose service: a small rover image (rover v0.41.0 + composition plugin v2.15.4, baked in at build time) that composes `supergraph.yaml` into a shared volume and recomposes within about 2s of any subgraph schema change. The router hot-reloads it, and a failed composition keeps the last good supergraph.
- `router.yaml`: propagates `authorization`, `user-agent` and `x-forwarded-for`, passes subgraph errors through, uses a 100 KB request limit and a 10s subgraph timeout, sets CORS for Expo web and Studio, and exposes health on `:8088/health` and Prometheus metrics on `:9080/metrics`.
- `rhai/main.rhai`: one `x-request-id` per client request, sent to every subgraph and echoed back to the client, so subgraph logs share a correlation ID.

**Changed**
- Moved `apps/api-gateway` to `services/api-gateway`, so `apps/` holds only client apps. Updated the compose mounts, the schema path in `supergraph.yaml`, the rover watch script and the docs. The `supergraph` service now mounts only `./services`.

**Learned**
- The router **redacts subgraph errors by default**. Without `include_subgraph_errors`, clients lose auth's `UNAUTHENTICATED` / `reason`.
- Router 2.18 changed the header rules to `headers.all.request.operations: [...]` and moved the request size limit to `limits.router.http_max_request_bytes`. `router config validate` inside the image catches this kind of drift.
- Inside a container, listen on `0.0.0.0`, not `127.0.0.1`. Host services are reachable at `host.containers.internal` (Podman; Docker needs `extra_hosts: host-gateway`).
- File events from the macOS host don't reliably reach the Podman VM, so the schema watcher polls instead of using inotify.
- The router's metrics port is moved to 9080 so it won't clash with the Prometheus server (9090) later.
- Subgraphs behind a router shouldn't answer with HTTP 401/403: the router adds an extra `SUBREQUEST_HTTP_ERROR` next to the real `UNAUTHENTICATED` error.

### 2026-10-08 · Planning
**Changed**
- Tooling: **no monorepo, and Yarn 4 instead of pnpm.** Each service, app and package is a standalone Yarn project in this one git repo (`nodeLinker: node-modules`). The pnpm workspace root and Turborepo were dropped. Shared packages will be published to public npm and installed by version. `services/auth` was moved to Yarn with an inlined tsconfig.
- Observability: API usage, success rate and failure rate tracked in **Grafana** from Phase 1 (Prometheus metrics from every service and the router, dashboards and alerts as code). Added to `ROADMAP.md` and the `docs/backend-api.md` tech stack.
- Testing: **Jest** (not Vitest) for unit and integration tests in every service, matching mobile. Each service ships unit tests in the week it's built. Recorded in the `docs/backend-api.md` tech stack.
- Architecture: **microservices from day one**, so the modular-monolith phase is gone. `docs/backend-api.md`, the folder READMEs and the compose setup were updated to match: `compose.yaml` is now at the repo root, `infra/local/postgres-init/` creates a database per service, and `apps/api/` was removed. `ROADMAP.md` was rewritten: Phase 1 is now "Microservices Core" (weeks 2–11), the old Phase 4 was folded into it, and the later phases were renumbered. It adds a service map, communication rules, and a `packages/service-kit`.

### 2026-10-08 · Auth subgraph
**Added**
- Jest unit tests for `services/auth` (`yarn test`, `yarn test:coverage`), **colocated with the code** (`src/lib/crypto.ts` → `src/lib/crypto.test.ts`; integration tests will be `*.integration.test.ts`): 198 tests in 16 suites covering every helper, service and resolver, with ~98% line and ~91% branch coverage and a 70% threshold. Planting three security bugs (decoy OTP verifying, refresh-token reuse not detected, password reset keeping sessions) made the suite fail each time.
- `services/auth/insomnia/collection.yaml`: Insomnia v5 collection that doubles as the auth API docs. It has a Markdown description per request (inputs, every result type, rate limits, side effects), after-response scripts that save `challengeId` and tokens and run tests, a pre-request script that reads OTP codes from Mailpit, error-case requests, Federation and REST folders, and `local`/`gateway`/`staging` environments.
- `services/auth`: standalone Apollo Federation v2 subgraph (Express 5, Apollo Server 5, Drizzle, port 4001) that owns the `User` entity.
- Signup with email verification, password + email OTP 2-step login (on by default per user, can be toggled with `setTwoFactor`), forgot/reset password via an emailed code.
- EdDSA (Ed25519) JWT access tokens (15 min), served at `/.well-known/jwks.json`, plus rotating single-use refresh tokens with reuse detection.
- Per-device sessions (device, created/last IP, GeoLite2 location), `mySessions`, `revokeSession`, `revokeOtherSessions`, `logout`, and a `myAuthEvents` security history.
- Instant revocation of live access tokens through a Redis revoked-session list.
- Rate limiting with `rate-limiter-flexible` + Redis: a global per-IP limit plus per-operation limits and a brute-force lock.
- `packages/config-ts` and a Postgres init script that creates one database per service.

**Learned**
- ts-jest doesn't support TypeScript 7 (no JS API), so Jest uses @swc/jest. ESM mocks need `jest.unstable_mockModule` before `await import()`, and a module that connects on import (Redis) left unmocked makes Jest hang.
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
