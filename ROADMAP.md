# E-commerce Learning Roadmap — Backend, AWS, Microservices, GitOps, React Native

## Context
You're a full-stack JS developer who wants deeper skills in five areas: backend, AWS, microservices, React Native and DevOps/GitOps. The vehicle is one e-commerce app, built as **microservices from day one** and grown phase by phase.
Constraints: **10–15 hrs/week**, **Express 5 + TypeScript**, **AWS budget $50–100/mo** → about **32 weeks (~7–8 months)**.

Architecture: each service is an **Apollo Federation v2 subgraph** behind **Apollo Router** (one `/graphql` endpoint for clients). Services talk to each other asynchronously over **SNS → SQS**. Each service owns its own database. See [docs/backend-api.md](docs/backend-api.md) for the stack.

## Why this order
Each phase produces what the next one needs:
1. **Microservices first.** There's no monolith step. You design service boundaries up front and build each service as its own deployable unit, so distributed-systems problems (events, sagas, idempotency, tracing) show up from the first weeks.
2. **Containers + CI** come before the cloud: AWS and Kubernetes only deploy images, and with many services you need per-service pipelines early.
3. **AWS** next: run the services on managed building blocks (ECS, RDS, SNS/SQS, S3, IAM).
4. **Kubernetes + GitOps** once several services are running in the cloud and worth orchestrating.
5. **React Native** last, building against a stable, deployed API. *Escape hatch:* if motivation dips, you can move the mobile phase to right after Phase 3, because the API is stable by then.

### The trade-off you're accepting
Starting with microservices costs more up front than starting with a monolith: more moving parts locally, distributed transactions from the first order, and boundaries that are harder to change later. To keep it manageable:
- **Draw boundaries by business capability** (see the service map) and don't split further than that.
- **A shared `service-kit` package** holds the boilerplate (env, logging, Express + Apollo subgraph setup, JWT verification, health checks, errors), so each service holds only business logic. Shared packages are **published to public npm** and installed by version, like any other dependency.
- **No synchronous service-to-service calls.** Data crosses services through federation (at the router) or events. This one rule prevents most "distributed monolith" problems.
- **One command runs everything locally:** `podman compose --profile apps up` starts the dependencies, the router and every service, each running `yarn dev` with hot reload.

Rule: **finish each phase's "Done when" list before moving on.** Depth beats breadth.

---

## Service map

| Service | Port | Owns (data / GraphQL) | Storage | Publishes | Consumes |
|---|---|---|---|---|---|
| **Router** (`apps/api-gateway`) | 4000 | Supergraph, auth header + IP propagation, query limits | — | — | — |
| **auth** ✅ | 4001 | `User` entity, sessions, tokens, OTP | Postgres `auth` | `user.registered`, `user.password_changed` | — |
| **catalog** | 4002 | `Product`, categories, search | Postgres `catalog` | `product.created`, `product.updated`, `product.price_changed` | — |
| **inventory** | 4003 | `Product.stock` (extends `Product`), reservations | Postgres `inventory` | `stock.reserved`, `stock.reservation_failed`, `stock.released` | `order.placed`, `order.cancelled`, `product.created` |
| **cart** | 4004 | `Cart`, guest→user merge | Redis | — | `product.price_changed`, `order.confirmed` |
| **orders** | 4005 | `Order`, checkout **saga orchestrator** | Postgres `orders` | `order.placed`, `order.confirmed`, `order.cancelled` | `stock.*`, `payment.*` |
| **payments** | 4006 | Stripe intents, refunds, webhooks (REST) | Postgres `payments` | `payment.succeeded`, `payment.failed`, `payment.refunded` | `order.placed`, `order.cancelled` |
| **notifications** | 4007 | Email / push delivery log | Postgres `notifications` | — | `user.*`, `order.*`, `payment.*` |

**Communication rules**
- Client → Router → subgraphs: GraphQL. Cross-service data such as `Order.items.product` is joined by the router through federation entities, not by services calling each other.
- Service → service: events only, over SNS topics fanned out to per-consumer SQS queues. Use the **outbox pattern** on the publisher side and **idempotent consumers** with DLQs on the consumer side.
- Stripe → payments: REST webhook with signature verification. `/health` and `/ready` stay REST on every service.

---

## API metrics: usage, success rate and failure rate in Grafana
Tracked from Phase 1 onwards, in the same Grafana dashboards locally, on AWS and on Kubernetes.

**Why it needs a definition:** GraphQL returns HTTP 200 even when an operation fails, and expected failures (`InvalidCredentials`, `OutOfStock`) come back as union results, not errors. So HTTP status codes alone can't tell you the success rate. Every GraphQL operation is classified into one **outcome**:

| Outcome | What counts | Example | Counts toward |
|---|---|---|---|
| `success` | `data` returned, no top-level errors, the result isn't a `UserError` | `login` → `OtpChallenge` | Success rate |
| `user_error` | Expected business failure: a `UserError` union member | `InvalidCredentials`, `WeakPassword`, `OutOfStock` | Tracked separately; not a system failure |
| `client_error` | The caller did something wrong | `UNAUTHENTICATED`, `FORBIDDEN`, `GRAPHQL_VALIDATION_FAILED`, `RATE_LIMITED`/429 | Failure rate (client) |
| `server_error` | We broke | `INTERNAL_SERVER_ERROR`, HTTP 5xx, subgraph unreachable, timeouts | **Failure rate (server): this is the one that pages you** |

**How it's collected**
- **Subgraphs:** a metrics plugin in `packages/service-kit` (Apollo Server plugin + `prom-client`) exposes `GET /metrics` on every service:
  - `graphql_operations_total{service, operation, type, outcome, result}`, where `result` is the union typename, e.g. `InvalidCredentials`
  - `graphql_operation_duration_seconds` (histogram)
  - `http_requests_total{service, route, status}` for REST (webhooks, JWKS)
  - Node.js runtime metrics (event-loop lag, heap)
- **Router:** Apollo Router's built-in Prometheus endpoint, for requests, errors and latency per subgraph as seen from the edge.
- **Event consumers:** `events_consumed_total{service, event, outcome}`, `events_published_total`, outbox lag and DLQ depth.
- **Labels stay low-cardinality:** use operation *name* (clients must name their operations; unnamed ones become `anonymous`), never user ids, emails or raw queries.

**Dashboards (as code in `infra/observability/grafana/dashboards/`, provisioned automatically)**
1. **API overview:** requests/s, **success rate %**, **failure rate %** (client vs server), latency p50/p95/p99 for the whole API, and the same per service.
2. **Per operation:** a table of every operation with calls, success %, user-error %, failure %, and p95, sortable to find the worst operations.
3. **Auth:** logins started vs completed (OTP step), `InvalidCredentials`/`InvalidOtp` rates, rate-limit hits, refresh-token reuse detections, active sessions.
4. **Checkout and events:** orders placed vs confirmed vs cancelled, saga compensations, payment failures, consumer errors, DLQ depth.

**Alerts and SLOs:** API success rate ≥ 99.5% over 30 days, with alerts on server failure rate > 2% for 5 minutes, p95 latency > 500 ms, any DLQ message, and a spike in refresh-token reuse.

---

## Phase 0 — Foundations (Week 1)
- **One git repo, no monorepo tooling:** every service, app and package is a **standalone Yarn 4 project** with its own `package.json`, `yarn.lock` and `.yarnrc.yml` (`nodeLinker: node-modules`). There's no root workspace and no Turborepo, so any folder can move to its own repo later without changes.
- Folders: `apps/` (api-gateway, mobile), `services/` (one folder per service), `packages/` (config-ts, config-eslint, service-kit, contracts, shared-types).
- **Shared packages are published to public npm** under your own scope (e.g. `@<your-scope>/config-ts`), versioned with semver, and installed by version in each service. For local iteration on a package, use `yarn link` temporarily, but never commit a linked dependency.
- TypeScript strict, ESLint + Prettier, Husky + commitlint (conventional commits).
- Local dependencies in **one compose file at the repo root** (move it out of `apps/api/`, since there's no monolith any more): Postgres with **one database per service** created by an init script, Redis, Mailpit, LocalStack (SNS/SQS/S3), Jaeger for traces, and **Prometheus + Grafana** for metrics (Prometheus scrapes the router and every service's `/metrics`).
- ADR folder (`docs/adr/`): one short Architecture Decision Record per major choice. The first one: "Microservices from day one with GraphQL Federation".

**Done when:** `podman compose --profile apps up` starts the dependencies, Apollo Router and one "hello" subgraph with one command, a query through `localhost:4000` reaches the subgraph, and `@<your-scope>/config-ts` is published to npm and used by that subgraph.

## Phase 1 — Microservices Core (Weeks 2–11) ★ highest priority
Use **Express 5 + TypeScript + Apollo Server 5 + `@apollo/subgraph`**, **Drizzle** for SQL, and **zod** for validation. Every service has the same internal layout (`schema.graphql` → resolvers → service → repository, plus `db/schema.ts` and its own migrations), so the patterns you learn in one service carry over to the next. **Each service ships with Jest unit tests in the week it's built**; week 11 adds integration and contract tests on top.

| Week | Build | Learn in depth |
|---|---|---|
| 2 | **Platform skeleton**: `packages/service-kit`, Apollo Router + `rover dev`, supergraph composition, **metrics plugin + `/metrics`**, first **API overview** dashboard | Express middleware chain, async errors in Express 5, pino-http with correlation IDs, router header propagation (`authorization`, `x-forwarded-for`), subgraph vs supergraph, `rover supergraph compose`, Prometheus data model (counters, histograms, labels), the **outcome classification** above, PromQL `rate()` and `histogram_quantile()` |
| 3 | **auth** ✅ (built 2026-10-08) + platform auth | argon2, password + email OTP, JWT (EdDSA) + rotating refresh tokens, sessions per device, rate limiting. Remaining: JWT verification through **JWKS** in `service-kit` so every subgraph trusts auth's tokens, RBAC (customer/admin) helpers, and the **Auth dashboard** |
| 4 | **catalog** | SQL first with Drizzle, migrations per service, indexes, `EXPLAIN ANALYZE`, Relay cursor pagination, Postgres full-text search, the `Product @key` entity, DataLoader and N+1 |
| 5 | **Event backbone + notifications** | SNS → SQS fan-out on LocalStack, the **transactional outbox** (publisher), **idempotent consumers** (processed-message table), DLQs and redrive, event schemas in `packages/contracts`. Move auth's emails behind events (ADR: should OTP stay direct for latency?) |
| 6 | **inventory** | Extending another service's entity (`Product.stock` with `@key`/`@external`), stock reservations with TTL, **optimistic locking**, keeping a local read model updated from `product.*` events |
| 7 | **cart** | Redis data modelling, TTLs, guest→user cart merge, a price cache invalidated by `product.price_changed`, federation references to `Product` |
| 8 | **orders + payments** | Stripe test mode, **idempotency keys**, webhook signature verification (REST in a GraphQL system), DB transactions and isolation levels, order state machine |
| 9 | **Checkout saga** | Orchestrated saga in orders: reserve stock → charge payment → confirm order, with **compensating actions** (release stock, refund), saga state persisted in Postgres, timeouts with BullMQ delayed jobs |
| 10 | **Resilience** | Retries with backoff and jitter, timeouts, circuit breakers (opossum), poison messages and DLQ handling, at-least-once delivery, kill-a-service experiments with `docker compose stop` |
| 11 | **Testing + observability** | Close the gaps in each service's **Jest** unit tests, **Testcontainers** integration tests per service, event **contract tests** (JSON Schema or Pact), `rover subgraph check` for breaking schema changes, **OpenTelemetry** traces router → subgraphs → SQS consumers, viewed in Jaeger, the **per-operation** and **checkout/events** dashboards, **SLO + alert rules** (Grafana alerting to email), and links from a Grafana panel to the matching Jaeger traces (exemplars) |

**Done when:**
- Through the router, a user can register, browse, add to cart, check out with a Stripe test card, and see the order.
- Stopping payments mid-checkout makes the saga compensate or recover correctly.
- One trace covers the whole checkout across every service.
- Grafana shows API usage, success rate and failure rate (overall, per service and per operation). Stopping a service makes its server failure rate rise on the dashboard and fires an alert.
- Each service has at least 70% coverage, plus integration tests against real Postgres, Redis and LocalStack.

## Phase 2 — Containers & CI (Weeks 12–13)
- One multi-stage **Dockerfile pattern** shared by every service (distroless or alpine, non-root user, small image), `.dockerignore`, graceful shutdown.
- Compose profile that runs **every service plus the router as containers**, not just the dependencies.
- GitHub Actions with **one workflow per service**, triggered by `paths:` filters (`services/<name>/**`), so a PR only builds what it touched: `yarn install --immutable` → lint → typecheck → test (service containers) → **supergraph composition check** → build image → Trivy scan → push to **ECR** using **OIDC** (no long-lived AWS keys). Cache Yarn per service with `actions/setup-node` (`cache: yarn`, `cache-dependency-path: services/<name>/yarn.lock`).
- **Package release workflow:** pushing a tag like `config-ts@1.2.0` publishes that package to npm with **provenance** (`npm publish --provenance` from CI, no long-lived npm token in secrets once trusted publishing is set up). **Renovate or Dependabot** opens PRs in each service when a shared package has a new version.

**Done when:** a PR touching one service only builds and tests that service, tagging a package publishes it to npm, CI fails on a breaking subgraph change, and merging to `main` produces a tagged image per changed service in ECR.

## Phase 3 — AWS Core + Terraform (Weeks 14–17)
Before anything else, set up an **AWS Budgets alert at $60 and $90** and enable MFA on the root account.
- **Terraform** for everything (`infra/terraform/`), with an S3 backend and state locking. No click-ops. Use **one reusable module per service** (ECS service, task role, queues, secrets).
- Week 14: IAM (users vs roles, least privilege, **one task role per service**), VPC (public/private subnets; use **fck-nat** on a t4g.nano instead of a ~$32/mo NAT Gateway).
- Week 15: **RDS Postgres** (t4g.micro, one instance with **one database and one DB user per service**), **ElastiCache Redis**, **Secrets Manager** per service, real **SNS topics + SQS queues + DLQs** from Terraform.
- Week 16: Run the router and all services on **ECS Fargate** (Fargate Spot, 0.25 vCPU tasks) with **Cloud Map** service discovery between router and subgraphs. Put only the router behind the **ALB**, plus the payments webhook path. Add an ACM certificate and Route 53 domain.
- Week 17: **S3 + CloudFront** for product images (presigned uploads from catalog), **Lambda** for image resizing on S3 events, CloudWatch logs and alarms, and OpenTelemetry → **X-Ray**. Metrics: an **OpenTelemetry Collector / Grafana Alloy** sidecar remote-writes each service's metrics to **Grafana Cloud's free tier** (10k series, 14-day retention), so the same dashboards and alerts work in the cloud for $0. Amazon Managed Grafana starts at about $9/user/month.

**Done when:** `terraform apply` builds the whole environment from scratch, `terraform destroy` removes it cleanly, the API is live on HTTPS, an order placed in the cloud produces a full trace in X-Ray, and the cloud API shows up in the Grafana API overview dashboard.

## Phase 4 — Kubernetes + GitOps (Weeks 18–23)
- Week 18: Kubernetes fundamentals locally on **kind**: Deployments, Services, Ingress, ConfigMaps/Secrets, probes, resource limits, HPA. Run all services and the router in the cluster.
- Week 19: One shared **Helm library chart** used by every service, plus **Kustomize** overlays for `staging` and `prod`.
- Week 20: **EKS via Terraform** (control plane ~$73/mo, so use spot t4g nodes and **destroy it when you're not studying**). Add the AWS Load Balancer Controller and IRSA/Pod Identity, with one service account per service.
- Week 21: **Argo CD** with the app-of-apps pattern (one Application per service) and a `gitops/` folder (or separate repo) holding the desired state. CI updates image tags and the supergraph ConfigMap in Git instead of deploying directly (or use Argo CD Image Updater).
- Week 22: **External Secrets Operator** (connected to Secrets Manager), **Prometheus + Grafana** (kube-prometheus-stack) with a `ServiceMonitor` per service from the Helm library chart, the same dashboards provisioned from Git (ConfigMaps), alerts via Alertmanager, queue-depth autoscaling for consumers with **KEDA** (SQS scaler).
- Week 23: **Argo Rollouts** canary deploys, rolled out one service at a time. An `AnalysisTemplate` queries Prometheus for the canary's **server failure rate and p95**, and rolls back automatically if it's worse than stable.

**Done when:** merging a PR deploys only the changed service to staging, a promotion PR deploys to prod, and a bad release of one service rolls itself back without touching the others.

## Phase 5 — React Native Mobile App (Weeks 24–29)
Stack: **Expo + Expo Router + TypeScript**, **Apollo Client** (normalized cache, GraphQL Code Generator typed hooks), Zustand for client state, and shared zod schemas and types from `packages/`.
- Week 24: Navigation and the auth flow (signup → email code, login → OTP), tokens in `expo-secure-store`, a refresh-token link with retry, a "your devices" screen using `mySessions`.
- Week 25: Catalog (FlashList, infinite scroll with cursor pagination, image caching) and search.
- Week 26: Cart (offline-first with persisted state, syncs on reconnect), checkout with the **Stripe React Native SDK**, polling order status while the saga runs.
- Week 27: Push notifications (Expo Push, sent by the notifications service from order events), deep links for order status.
- Week 28: Testing (Jest + React Native Testing Library, Maestro for E2E), performance profiling.
- Week 29: **EAS Build + EAS Update** (over-the-air updates) wired into GitHub Actions, internal TestFlight/Play testing.

**Done when:** you can install a signed build on your phone, buy something end to end, and get a push notification when the order ships.

## Phase 6 — Hardening & Portfolio (Weeks 30–32)
- Week 30: Load test the checkout through the router with **k6**, watch success rate and latency in Grafana during the run (k6 results can also stream into Grafana), and fix the top 2 bottlenecks. Run chaos experiments: kill pods, drop a consumer, fail over the DB, flood a DLQ.
- Week 31: Security pass: OWASP API Top 10, GraphQL depth and complexity limits plus persisted queries at the router, dependency scanning, secrets audit, least-privilege review of every task role and service account.
- Week 32: Cost review, then the write-up: architecture diagram, service map, event catalog, ADRs, and a README for each service. These become your portfolio.

---

## Target repo layout
```
ecommerce-app/
  apps/        api-gateway (Apollo Router + supergraph config), mobile
  services/    auth, catalog, inventory, cart, orders, payments, notifications
  packages/    service-kit, contracts, shared-types, config-eslint, config-ts
  infra/       terraform/, helm/, k8s/, observability/ (Prometheus config, Grafana dashboards + alert rules as code)
  gitops/      argocd apps + env overlays (or separate repo)
  docs/adr/
  compose.yaml local dependencies (Postgres, Redis, Mailpit, LocalStack, Jaeger, Prometheus, Grafana)
```

## Weekly rhythm (10–15 hrs)
- About 70% building, 30% reading or docs. Read a chapter only when you're about to use it.
- Suggested references: *Microservices Patterns* by Chris Richardson (Phase 1: sagas, outbox, service boundaries), *Designing Data-Intensive Applications* (Phase 1), *Building Microservices* by Sam Newman (boundaries and the trade-offs above), AWS Well-Architected, Argo CD docs.
- End each week with a short ADR or log entry covering what you built, what broke, and what you learned.

## Cost guardrails
- Budget alerts at $60 and $90; tag all resources `project=ecommerce-learning` plus `service=<name>`.
- Microservices multiply per-task costs. Keep Fargate tasks at 0.25 vCPU / 0.5 GB on **Fargate Spot**, share one RDS instance (a database per service inside it), and set every ECS service's `desired_count` to 0 (or `terraform destroy` the compute stack) when you're not studying. Expect about $40–70/mo in Phase 3 while running.
- In Phase 4, keep EKS up only during study sessions by running `terraform destroy` on the cluster stack and keeping RDS and the VPC in a separate stack.
- Use LocalStack for SQS/SNS/S3 during local development.

## Verification
Each phase's **"Done when"** checklist is the gate. Concretely:
- **Phase 1:** a scripted checkout flow through the router passes; a fault-injection run (stop payments or inventory mid-saga) ends in a consistent state; one Jaeger trace covers the whole checkout.
- **Phase 2:** CI is green on a PR, affected-only builds work, and a breaking schema change fails the pipeline.
- **Phases 3–4:** a clean `terraform apply` from zero, a health check over HTTPS, and Argo CD showing every service Synced and Healthy.
- **Phase 5:** a Maestro E2E run of the purchase flow on a real device build.
