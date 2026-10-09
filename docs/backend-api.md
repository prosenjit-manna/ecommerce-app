# Backend / API — Architecture & Tech Stack

> Scope: `services/api-gateway` (Apollo Router), the other `services/*` (one subgraph per service), `packages/service-kit` (shared server code).
> Status: `services/auth` is built; the other services are planned. See [ROADMAP.md](../ROADMAP.md) for the phase timeline and [CHANGELOG.md](../CHANGELOG.md) for progress.

---

## 1. Architecture at a glance

The API is a **GraphQL Federation** system made of **microservices from day one**. There is no monolith. Each service is its own Apollo **subgraph** with its own database, and Apollo Router combines them into one **supergraph** that clients see as a single `/graphql` endpoint.

```
Mobile / Admin ──► Router (services/api-gateway, :4000, single /graphql endpoint)
                     ├─► auth           :4001  (User, sessions, tokens)
                     ├─► catalog        :4002  (Product, categories, search)
                     ├─► inventory      :4003  (extends Product.stock, reservations)
                     ├─► cart           :4004  (Cart, refs Product)
                     ├─► orders         :4005  (Order, checkout saga, refs Product/User)
                     ├─► payments       :4006  (Stripe intents, refunds)
                     └─► notifications  :4007  (mostly event-driven)

Service ↔ service:   async events over SNS → SQS (outbox + idempotent consumers)
Stripe webhooks:      REST (routed by ALB path to payments)
Health / readiness:   REST (/health, /ready) on every service
JWT verification:     every subgraph verifies auth's tokens with the public key from /.well-known/jwks.json
```

The full service map (data ownership, databases, published and consumed events) is in [ROADMAP.md](../ROADMAP.md#service-map).

### Ground rules
- **No synchronous service-to-service calls.** Data from several services is joined at the router through federation entities (`Product @key(fields: "id")`). Everything else goes through events.
- **Database per service.** No service reads another service's tables. Locally, all databases live in one Postgres container; in AWS, in one RDS instance with a database and user per service.
- **Shared code goes in `packages/`, not between services.** `service-kit` holds infrastructure code (env, logging, Express + Apollo setup, JWT/JWKS verification, rate limiting, errors), `contracts` holds event schemas, and `shared-types` holds zod schemas shared with mobile. Business logic is never shared.

### Build order (Phase 1)
auth ✅ → catalog → event backbone + notifications → inventory → cart → orders + payments → checkout saga. Each step adds one service on top of the ones that already exist.

### Which protocol is used where

| Concern | Protocol | Why |
|---|---|---|
| Client-facing reads and writes (mobile, admin) | **GraphQL** (through the router) | One endpoint, and each screen fetches exactly the fields it needs |
| Service-to-service commands and events | **SNS → SQS** events | Keeps services decoupled, and the checkout saga depends on it |
| Stripe webhooks | **REST** | Stripe calls a URL and signs the request |
| `/health`, `/ready` | **REST** | Load-balancer and Kubernetes probes expect plain HTTP |
| Image uploads | GraphQL mutation that returns a **presigned S3 URL**, then a direct upload to S3 | Never send files through GraphQL |

---

## 2. Tech stack

### Runtime and tooling
| Area | Choice |
|---|---|
| Runtime | Node.js 24 |
| Language | TypeScript (strict), shared base config published as `@<your-scope>/config-ts` (services inline it until it's published) |
| Package manager | **Yarn 4** (via Corepack) with `nodeLinker: node-modules`. Install scripts stay disabled (Yarn 4's default); argon2 uses its prebuilt binaries |
| Repo structure | One git repo, **no monorepo tooling**: every service, app and package is a standalone Yarn project with its own `package.json` and `yarn.lock` |
| Shared code | Packages in `packages/` are **published to public npm** under your scope and installed by version (semver). Renovate/Dependabot bumps them in each service |
| Lint / format | ESLint (`packages/config-eslint`) + Prettier |
| Commits | Husky + commitlint (conventional commits) |
| Local dependencies | `compose.yaml` at the repo root (Podman or Docker): Postgres (one database per service, created by `infra/local/postgres-init/`), Redis, Mailpit, LocalStack (SNS/SQS/S3) |

### API layer
| Area | Choice |
|---|---|
| HTTP framework | **Express 5** |
| GraphQL server | **Apollo Server 5**, mounted on Express at `/graphql` |
| Federation | **Apollo Federation v2** (`@apollo/subgraph`) |
| Gateway / router | **Apollo Router** (`services/api-gateway`), serving the **supergraph** |
| Supergraph composition | **`rover supergraph compose`** builds `supergraph.graphql` from every **subgraph** schema (config: `supergraph.yaml`). It runs locally and in CI, and the router loads the result. |
| Mobile GraphQL client | **Apollo Client** (normalized cache) + codegen-typed hooks |
| Schema style | **SDL-first**: each service owns a `schema.graphql` |
| Type generation | **GraphQL Code Generator** (typed resolvers; typed hooks for mobile) |
| N+1 prevention | **DataLoader**, one instance per request, created in the context |
| Input validation | **zod** (inside resolvers and REST handlers), with shared schemas in `packages/shared-types` |
| Logging | **pino** / pino-http (structured logs with correlation IDs) |
| Docs | The GraphQL schema is the documentation. OpenAPI (zod-to-openapi) covers only the REST endpoints (webhooks, health). |

### Auth and security
| Area | Choice |
|---|---|
| Password hashing | argon2 |
| Tokens | EdDSA (Ed25519) JWT access tokens, issued by auth and verified by every subgraph through JWKS, plus rotating refresh tokens with reuse detection |
| Authorization | RBAC (customer / admin), with JWT → `context.user` and checks in resolvers or directives |
| Abuse protection | Rate limiting, query **depth and complexity limits**, introspection disabled in prod, persisted queries (APQ) |

### Data
| Area | Choice |
|---|---|
| Primary database | **PostgreSQL**, **one database per service** (each service also uses a Postgres schema named after itself, e.g. `auth.users`) |
| Query layer | **Drizzle ORM** (SQL-first, typed schema in TS) + **drizzle-kit** for migrations. Each service owns its own Drizzle schema and migrations folder. |
| Cache / cart | **Redis** |
| Background jobs | **BullMQ** (retries, backoff) |
| Pagination | Relay-style cursor connections (`edges`, `pageInfo`) |

### Payments and messaging
| Area | Choice |
|---|---|
| Payments | Stripe (test mode): idempotency keys, webhook signature verification |
| Events | AWS **SNS → SQS** fan-out (or EventBridge); LocalStack in local development |
| Reliability | Outbox pattern, idempotent consumers, DLQs, retries with backoff, timeouts, circuit breakers |
| Checkout | Orchestrated **saga**: reserve stock → charge payment → confirm order, with compensating actions on failure |
| Event contracts | Shared event schemas in `packages/contracts` |

### Testing
| Area | Choice |
|---|---|
| Test runner | **Jest 30** in every service, and on mobile, so there's one runner across the repo |
| TypeScript + ESM | **@swc/jest** compiles tests (it only strips types; `yarn typecheck` type-checks `src/` and `test/`). ts-jest can't be used: it needs TypeScript < 7, and TypeScript 7 has no JS API. Services are ESM (`"type": "module"`), so Jest runs with `NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning'` |
| Unit | Jest. Every service ships unit tests **from the week it's built** (target: at least 70% coverage on services). Tests are **colocated**: `foo.ts` → `foo.test.ts` in the same folder |
| Mocking | `jest.unstable_mockModule()` + dynamic `await import()` (ESM modules can't use hoisted `jest.mock`). Register mocks by **absolute path** (`src('lib/mailer.ts')` helper in `test/helpers/fixtures.ts`). Unit tests never touch Postgres, Redis, SQS or SMTP: repositories, the Redis client and the mailer are mocked. Anything that opens a connection on import (e.g. `redis.ts`) **must** be mocked, or Jest never exits |
| Integration | Jest + **Testcontainers** (real Postgres, Redis and LocalStack), run as a separate Jest project |
| Coverage | Jest's built-in coverage (`--coverage`) with per-service `coverageThreshold`, enforced in CI |
| Schema safety | `rover subgraph check` / `graphql-inspector`: breaking schema changes fail CI |
| Event contracts | Pact or JSON-schema checks for SNS/SQS messages |
| Manual / smoke API testing | **Insomnia** collections + **Inso CLI** (see section 4) |
| Load | k6 (Phase 6) |

### Observability and deployment
| Area | Choice |
|---|---|
| Tracing | OpenTelemetry: router → subgraphs → SQS consumers, sent to X-Ray or Grafana Tempo |
| Metrics / alerts | **Prometheus + Grafana**: a `prom-client` metrics plugin in `service-kit` exposes `/metrics` on every service, and Apollo Router exports its own metrics. Dashboards show API usage plus success and failure rates per service and per operation, using the outcome classification (`success` / `user_error` / `client_error` / `server_error`) in [ROADMAP.md](../ROADMAP.md#api-metrics-usage-success-rate-and-failure-rate-in-grafana). Local: compose; AWS: Grafana Cloud free tier; K8s: kube-prometheus-stack |
| Containers | Multi-stage Dockerfile, non-root user, graceful shutdown |
| CI | GitHub Actions: lint → typecheck → test → schema check → build → Trivy → push to ECR (OIDC) |
| Hosting | ECS Fargate, one ECS service per microservice with Cloud Map discovery (Phase 3), then EKS + Argo CD + Argo Rollouts (Phase 4) |
| Infrastructure as code | Terraform |

---

## 3. GraphQL conventions

### Service layout
Every service follows the layout of `services/auth`:
```
services/<name>/
  package.json, yarn.lock, .yarnrc.yml, tsconfig.json, drizzle.config.ts, codegen.ts, .env.example
  src/
    index.ts              # boot + graceful shutdown
    app.ts                # Express: request context, logging, rate limit, /health, /ready, /graphql
    config/env.ts         # zod-validated env
    db/schema.ts          # Drizzle tables (pgSchema('<name>'))
    db/migrations/        # drizzle-kit output
    graphql/schema.graphql    # SDL owned by this subgraph
    graphql/resolvers.ts      # thin: auth check → zod validate → call service
    graphql/context.ts        # JWT → ctx.auth, per-request DataLoaders
    graphql/generated.ts      # GraphQL Code Generator output
    modules/<area>/       # <area>.service.ts (business logic) + <area>.repository.ts (Drizzle queries)
      <area>.service.test.ts          # unit test, next to the file it tests
      <area>.repository.integration.test.ts  # Jest + Testcontainers (real Postgres / Redis / LocalStack)
    lib/                  # service-local helpers (moves to packages/service-kit once a second service needs it)
  test/                   # shared test infrastructure only, no tests
    helpers/fixtures.ts   # row builders (user, session, challenge, ...) + src() path helper for mocks
    setup.ts              # test env vars (generated JWT keys, OTP pepper, ...)
  jest.config.ts          # two projects: unit (*.test.ts), integration (*.integration.test.ts)
  tsconfig.build.json     # excludes *.test.ts, so tests never reach dist/
  insomnia/collection.yaml
```

**What each service unit-tests:** pure helpers (crypto, validation, mapping), every service-layer branch (success plus each union failure: invalid input, rate limited, not found, ...), and resolvers' validation and auth checks. Repository SQL is covered by the integration tests, not by unit tests.

### Rules
- **Entities:** `type Product @key(fields: "id")` is owned by catalog. Other services extend it (for example, inventory adds `stock`) and resolve it with `__resolveReference`.
- **Pagination:** Relay connections everywhere (`products(first, after)`).
- **Errors:** model expected failures as **union result types** (`PlaceOrderResult = Order | OutOfStock | PaymentDeclined`). Use top-level `errors` only for unexpected failures and auth failures.
- **Mutations:** a single `input` argument and a payload type. Checkout mutations take an idempotency key.
- **Long-running work:** `placeOrder` starts the saga and returns an order with a `PENDING` status. The client polls (or later subscribes) for status updates.
- **No breaking changes without deprecation:** use `@deprecated` first, and CI schema checks enforce this.

### Supergraph / subgraph workflow
```
services/auth/src/graphql/schema.graphql     ─┐
services/catalog/src/graphql/schema.graphql  ─┼─► supergraph.yaml ─► rover supergraph compose ─► supergraph.graphql ─► Apollo Router
services/…/src/graphql/schema.graphql        ─┘
```
- Each subgraph is listed in `services/api-gateway/supergraph.yaml` with its routing URL and schema file.
- **Local development:** `rover dev` runs the router and recomposes the supergraph whenever a subgraph schema changes.
- **CI:** composition fails the build if subgraphs conflict. `supergraph.graphql` is a build artifact, generated by CI and not edited by hand.
- **Phase 4:** CI publishes `supergraph.graphql` into `gitops/` as a ConfigMap, and Argo CD rolls the router out.
- **Router configuration** (`router.yaml`): CORS, header propagation (`Authorization`, `User-Agent`, `X-Forwarded-For` and the correlation ID passed through to subgraphs; auth uses the last two for session tracking, with `TRUST_PROXY=1`), query limits, OpenTelemetry export.

### Topics to learn in depth
DataLoader and the N+1 problem · query planning across subgraphs · `@key` / `@external` / `@requires` / `@override` · persisted queries · query complexity limits · error modelling · subscriptions under federation (later).

---

## 4. API testing with Insomnia

### Collections: one per backend service, plus one for the gateway
Each collection lives next to the code it tests:

```
services/api-gateway/insomnia/collection.yaml   # end-to-end flows through the router
services/auth/insomnia/collection.yaml
services/catalog/insomnia/collection.yaml
services/cart/insomnia/collection.yaml
services/inventory/insomnia/collection.yaml
services/orders/insomnia/collection.yaml
services/payments/insomnia/collection.yaml
services/notifications/insomnia/collection.yaml
```

- **Service collections** call the subgraph directly (for example `localhost:4001/graphql`) to test one service on its own.
- **The gateway collection** calls the router and holds the cross-service flows: register → login → browse → add to cart → checkout → get the order.

### Root collection: every API in one place
`insomnia/collection.yaml` holds every API in one collection. **It's generated, so don't edit it:** edit a service collection, then run `yarn build` in `insomnia/` (`build.mjs`).

- One top folder per service, with the gateway first.
- GraphQL operations go through the router (`apiGatewayUrl`), like the mobile app. Federation queries (`_service`, `_entities`) and plain HTTP endpoints go straight to the service, because the router doesn't expose them.
- Each service's `baseUrl` becomes `<service>Url` (`authUrl`, `catalogUrl`, ...). Shared variables like `email` and `accessToken` are merged, and the build warns when two services disagree on a value.
- Sub-environments with the same name (`local`, `staging`) are merged. Each service's `gateway` sub-environment is dropped, because the root collection always uses the router.
- Ids are derived from the source ids, so you can import the root collection next to the service collections without the two overwriting each other.

### Folders inside each service collection
| Folder | Contents |
|---|---|
| Auth | Login; an after-response script saves the token |
| Queries | e.g. `product(id)`, `products(first, after)` |
| Mutations | e.g. `createProduct`, `updateStock` |
| Federation | `_service { sdl }` and `_entities(representations: …)`, to debug entity resolution the way the router does it |
| REST | `/health`, `/ready` (and `/webhooks` for payments) |
| Error cases | Invalid input, unauthorized, not found, depth limit exceeded |

### Environments
- **Base environment:** `baseUrl`, `graphqlPath`, `accessToken`.
- **Sub-environments:** `local` (`yarn dev`), `docker` (compose), `staging`, and later `prod`.
- **Secrets:** use **private** sub-environments, which are left out of exports and Git Sync. Never commit tokens or Stripe keys.
- **Token chaining:** the Login request runs `insomnia.environment.set('accessToken', …)`, and every other request sends `Bearer {{ accessToken }}`.

### GraphQL in Insomnia
- Use the **GraphQL body type**. Schema introspection gives autocomplete and validation (only on `local` and `staging`, since introspection is off in prod).
- Put variables in the variables panel, not inline, so requests look like what the mobile app sends.
- In tests, assert that **`errors` is absent** and check the shape of `data`. GraphQL returns HTTP 200 even when a query fails.
- **Stripe webhooks:** test them with `stripe listen --forward-to` and `stripe trigger`, not Insomnia. Stripe signs webhooks, so a request made by hand fails signature verification.

### Automation
- Add after-response test scripts with `insomnia.test(...)` and `insomnia.expect(...)`.
- Run them in CI with the **Inso CLI** (`inso run collection …`) against `docker compose` as a smoke test after the Jest suites.

### When to add what
| Phase | Insomnia work |
|---|---|
| 1 | One collection per service as you build it (with the Federation folder), plus the gateway collection, which grows one flow at a time |
| 2 | `inso` in GitHub Actions against the full compose stack (all services + router) |
| 3 | A `staging` environment pointed at the ECS deployment |
| 4 | Run the gateway collection after each Argo CD sync |

### Notes
- Use a **local or Git Sync project** so the collections stay in the repo, not in Insomnia's cloud.
- Commit exported **YAML**, which diffs more cleanly than JSON.
- Insomnia is for exploration, manual checks and smoke tests. It does **not** replace Jest or Testcontainers.

---

## 5. Open decisions
- [x] **Microservices timing:** separate services from day one, no monolith (decided 2026-10-08). See the service map in [ROADMAP.md](../ROADMAP.md#service-map).
- [x] Query layer: **Drizzle** only.
- [x] Mobile GraphQL client: **Apollo Client** only.
- [x] Gateway: **Apollo Router** + a supergraph composed from subgraphs with `rover`.
- [ ] Write ADRs in `docs/adr/`: "Microservices from day one" and "Use GraphQL Federation for the client API".
- [x] Timeline: stays at 32 weeks. Phase 1 grew to 10 weeks by absorbing the old extraction phase.
- [ ] Auth emails: keep OTP emails sent directly by auth (lower latency), or move them behind events to notifications? Decide in Phase 1, week 5.
