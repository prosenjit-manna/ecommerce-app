# E-commerce Learning Roadmap — Backend, AWS, Microservices, GitOps, React Native

## Context
You're a full-stack JS developer who wants deeper skills in five areas: backend, AWS, microservices, React Native and DevOps/GitOps. The vehicle is one e-commerce app, built in  (currently empty) and grown phase by phase.
Constraints: **10–15 hrs/week**, **Express + TypeScript**, **AWS budget $50–100/mo** → about **32 weeks (~7–8 months)**.

## Why this order
Each phase produces what the next one needs:
1. **Backend first.** You can't split a system into microservices until you have one, so start with a well-built *modular monolith*.
2. **Containers + CI** come before the cloud: AWS and Kubernetes only deploy images.
3. **AWS** before microservices: you learn the managed building blocks (RDS, SQS/SNS, S3, IAM) that the services will rely on.
4. **Microservices** come next, carved out of the monolith one module at a time (the "strangler" pattern). This mirrors how real migrations are done.
5. **Kubernetes + GitOps** once you have several services worth orchestrating.
6. **React Native** last, building against a stable, deployed API. *Escape hatch:* if motivation dips, you can move Phase 6 to right after Phase 3, because the API is stable by then.

Rule: **finish each phase's "Done when" list before moving on.** Depth beats breadth.

---

## Phase 0 — Foundations (Week 1)
- Monorepo: **pnpm workspaces + Turborepo**: `apps/` (api, mobile, admin later), `packages/` (shared types, zod schemas, eslint/tsconfig).
- TypeScript strict, ESLint + Prettier, Husky + commitlint (conventional commits).
- `docker-compose.yml`: Postgres, Redis, Mailpit.
- ADR folder (`docs/adr/`): write one short Architecture Decision Record per major choice. These notes are where much of the learning gets recorded.

**Done when:** `pnpm dev` starts an empty Express app and Docker deps with one command.

## Phase 1 — Backend Deep Dive: Modular Monolith (Weeks 2–7) ★ highest priority
Use **Express 5 + TypeScript**. Every module (`auth`, `catalog`, `cart`, `orders`, `payments`, `inventory`) gets its own folder, its own routes, service and repository layers, and its own DB schema. Modules talk to each other only through an in-process interface, which prepares them to be split out in Phase 4.

| Week | Build | Learn in depth |
|---|---|---|
| 2 | Project skeleton, config, logging | Express middleware chain and routers, async error handling in Express 5, zod validation middleware, pino-http structured logs, a central error-handling middleware, env config |
| 3 | Auth | argon2 hashing, JWT access + rotating refresh tokens, RBAC (customer/admin), rate limiting |
| 4 | Catalog + Postgres | SQL first (Drizzle or Kysely, not a heavy ORM), migrations, indexes, `EXPLAIN ANALYZE`, cursor pagination, full-text search |
| 5 | Cart + Redis | Caching strategies, TTLs, cache invalidation, guest→user cart merge |
| 6 | Orders + Payments (Stripe test mode) | DB transactions, isolation levels, **idempotency keys**, webhooks with signature verification, **outbox pattern** |
| 7 | Inventory + background jobs + tests | BullMQ queues/retries, optimistic locking for stock, Vitest unit tests + **Testcontainers** integration tests, OpenAPI docs generated from zod schemas (`@asteasolutions/zod-to-openapi`) and served with `swagger-ui-express` |

**Done when:** a user can register, browse, add to cart, check out with a Stripe test card, and see the order. You have at least 70% coverage on services, plus integration tests against real Postgres and Redis.

## Phase 2 — Containers & CI (Weeks 8–9)
- Multi-stage Dockerfile (distroless or alpine, non-root user, small image), `.dockerignore`, health/readiness endpoints, graceful shutdown.
- GitHub Actions: lint → typecheck → test (with service containers) → build image → Trivy scan → push to **ECR** using **OIDC** (no long-lived AWS keys).
- Turborepo remote caching and affected-only builds.

**Done when:** every PR runs the full pipeline, and merging to `main` produces a tagged image in ECR.

## Phase 3 — AWS Core + Terraform (Weeks 10–13)
Before anything else, set up an **AWS Budgets alert at $60 and $90** and enable MFA on the root account.
- **Terraform** for everything (`infra/terraform/`), with an S3 backend and state locking. No click-ops.
- Week 10: IAM (users vs roles, least privilege), VPC (public/private subnets; use **fck-nat** on a t4g.nano instead of a ~$32/mo NAT Gateway).
- Week 11: **RDS Postgres** (t4g.micro), **ElastiCache Redis**, **Secrets Manager**.
- Week 12: Deploy the monolith on **ECS Fargate** behind an **ALB**. Add an ACM certificate and Route 53 domain.
- Week 13: **S3 + CloudFront** for product images (presigned uploads), **Lambda** for image resizing on S3 events, CloudWatch logs/alarms.

**Done when:** `terraform apply` builds the whole environment from scratch, `terraform destroy` removes it cleanly, and the app is live on HTTPS.

## Phase 4 — Microservices (Weeks 14–19)
Extract services from the monolith one at a time, in this order: **Notifications → Catalog → Inventory → Payments → Orders**. Start with the easiest and least coupled, and finish with the core.
- Each service owns its database (database-per-service), its own repo folder, its own Dockerfile and its own pipeline.
- **Communication:** synchronous REST for queries, through an API gateway (your own Express gateway with `http-proxy-middleware` first, so you learn what a gateway does). Commands and events run asynchronously over **SNS → SQS fan-out** (or EventBridge).
- **Checkout saga** (orchestrated): reserve stock → charge payment → confirm order, with compensating actions on failure.
- Reliability patterns: outbox and idempotent consumers, dead-letter queues, retries with backoff, timeouts and circuit breakers.
- **Observability:** OpenTelemetry tracing across services → AWS X-Ray or Grafana Tempo; correlation IDs in logs.
- Contract testing between services (Pact) and shared event schemas in `packages/contracts`.

**Done when:** you can kill the Payments service mid-checkout and the saga recovers or compensates correctly, and you can follow one request across every service in a single trace.

## Phase 5 — Kubernetes + GitOps (Weeks 20–25)
- Week 20: Kubernetes fundamentals locally on **kind**: Deployments, Services, Ingress, ConfigMaps/Secrets, probes, resource limits, HPA.
- Week 21: **Helm** chart per service (or one shared library chart), plus **Kustomize** overlays for `staging` and `prod`.
- Week 22: **EKS via Terraform** (control plane ~$73/mo, so use spot t4g nodes and **destroy it when you're not studying**). Add the AWS Load Balancer Controller and IRSA/Pod Identity.
- Week 23: **Argo CD** with the app-of-apps pattern and a separate `gitops/` repo (or folder) holding the desired state. CI now updates image tags in Git instead of deploying directly (or use Argo CD Image Updater).
- Week 24: **External Secrets Operator** (connected to Secrets Manager), **Prometheus + Grafana** (kube-prometheus-stack), alerts.
- Week 25: **Argo Rollouts** canary deploys with automated rollback on error rate.

**Done when:** merging a PR deploys to staging automatically, a promotion PR deploys to prod, and a bad release rolls itself back.

## Phase 6 — React Native Mobile App (Weeks 26–31)
Stack: **Expo + Expo Router + TypeScript**, TanStack Query (server state), Zustand (client state), and shared zod schemas/types from `packages/`.
- Week 26: Navigation, auth flow, tokens in `expo-secure-store`, refresh-token interceptor.
- Week 27: Catalog (FlashList, infinite scroll, image caching), search.
- Week 28: Cart (offline-first with persisted state, syncs on reconnect), checkout with the **Stripe React Native SDK**.
- Week 29: Push notifications (Expo Push, triggered by the Notifications service), deep links for order status.
- Week 30: Testing (Jest + React Native Testing Library, Maestro for E2E), performance profiling.
- Week 31: **EAS Build + EAS Update** (over-the-air updates) wired into GitHub Actions, internal TestFlight/Play testing.

**Done when:** you can install a signed build on your phone, buy something end to end, and get a push notification when the order ships.

## Phase 7 — Hardening & Portfolio (Week 32)
- Load test with **k6** and fix the top 2 bottlenecks; run a chaos experiment (kill pods or the DB failover).
- Security pass: OWASP API Top 10, dependency scanning, secrets audit.
- Cost review, then a write-up: an architecture diagram, the ADRs and a README for each phase. These become your portfolio.

---

## Target repo layout
```
ecommerce-app/
  apps/        api-gateway, monolith (shrinks over time), mobile
  services/    notifications, catalog, inventory, payments, orders
  packages/    contracts, shared-types, config-eslint, config-ts
  infra/       terraform/, helm/, k8s/
  gitops/      argocd apps + env overlays (or separate repo)
  docs/adr/
```

## Weekly rhythm (10–15 hrs)
- About 70% building, 30% reading or docs. Read a chapter only when you're about to use it.
- Suggested references: *Designing Data-Intensive Applications* (Phases 1 and 4), *Microservices Patterns* by Chris Richardson (Phase 4), AWS Well-Architected, Argo CD docs.
- End each week with a short ADR or log entry covering what you built, what broke, and what you learned.

## Cost guardrails
- Budget alerts at $60 and $90; tag all resources `project=ecommerce-learning`.
- Before EKS (Phases 1–4), the setup costs about $30–50/mo. In Phase 5, keep EKS up only during study sessions by running `terraform destroy` on the cluster stack and keeping RDS and the VPC in a separate stack.
- Use LocalStack for SQS/SNS/S3 during local development.

## Verification
Each phase's **"Done when"** checklist is the gate. Concretely:
- **Phases 1–2:** CI is green on a PR. Running `docker compose up` followed by a scripted checkout flow (an HTTP collection or Vitest E2E) passes.
- **Phases 3–5:** A clean `terraform apply` from zero, a health check over HTTPS, and Argo CD showing everything Synced and Healthy.
- **Phase 4:** A fault-injection test of the saga. One trace covers the whole checkout.
- **Phase 6:** A Maestro E2E run of the purchase flow on a real device build.

