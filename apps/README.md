# apps/

Deployable applications that aren't backend services.

| Folder | What | Phase |
|---|---|---|
| `api-gateway/` | **Apollo Router**: composes the supergraph from every subgraph in `services/` and serves the single client `/graphql` endpoint on port 4000 | 0–1 |
| `mobile/` | Expo + React Native app (Apollo Client) | 5 |

The backend services live in [`services/`](../services/README.md).
