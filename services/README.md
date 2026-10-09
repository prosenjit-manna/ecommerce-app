# services/

Backend microservices. Each one is an Apollo Federation subgraph with its own database, Dockerfile and CI pipeline. Services never call each other directly: they share data through the router (federation) and SNS → SQS events.

`api-gateway/` is the exception: it's the **Apollo Router**, not a subgraph. It composes the supergraph from every subgraph schema in this folder and serves the single client `/graphql` endpoint.

| Service | Port | Status | Database |
|---|---|---|---|
| `api-gateway/` | 4000 | ✅ Built (Apollo Router) | — |
| `auth/` | 4001 | ✅ Built | Postgres `auth` |
| `catalog/` | 4002 | Planned (Phase 1, week 4) | Postgres `catalog` |
| `notifications/` | 4007 | Planned (Phase 1, week 5) | Postgres `notifications` |
| `inventory/` | 4003 | Planned (Phase 1, week 6) | Postgres `inventory` |
| `cart/` | 4004 | Planned (Phase 1, week 7) | Redis |
| `orders/` | 4005 | Planned (Phase 1, weeks 8–9) | Postgres `orders` |
| `payments/` | 4006 | Planned (Phase 1, week 8) | Postgres `payments` |

Rows are in build order. See the service map in [ROADMAP.md](../ROADMAP.md#service-map) for what each service owns, publishes and consumes, and [docs/backend-api.md](../docs/backend-api.md) for the shared layout and conventions.
