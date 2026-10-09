# API gateway (Apollo Router)

> Scope: `services/api-gateway/` and the `supergraph` + `router` services in `compose.yaml`.
> Related: [backend-api.md](backend-api.md) for the overall federation architecture; [insomnia-collection.md](insomnia-collection.md) for testing through the router.

The API gateway is **Apollo Router v2.18**. It is the single endpoint every client talks to (`/graphql`). It doesn't hold any business logic: it combines the subgraphs in `services/` into one **supergraph**, plans each query across them, and forwards the right headers.

```
Mobile / Insomnia ──► Router :4000/graphql ──► auth :4001/graphql
                        │                   └─► catalog, cart, orders, … (later)
                        │
                        ▲ hot-reloads supergraph.graphql
                        │
                  supergraph container (rover)
                    composes supergraph.yaml + services/*/src/graphql/schema.graphql
```

Everything runs in containers, so nothing is installed on the host. The subgraphs still run on the host with `yarn dev` until Phase 2.

---

## 1. Files

| File | What |
|---|---|
| `supergraph.yaml` | Composition input: the federation version and one entry per subgraph (routing URL + schema file) |
| `router.yaml` | Router runtime config: listeners, CORS, header propagation, error passthrough, limits, timeouts, metrics |
| `rhai/main.rhai` | Script that sets one `x-request-id` per client request and sends it to every subgraph |
| `rover/Dockerfile` | Image for the `supergraph` container: rover + the composition plugin, installed at build time |
| `rover/watch-compose.sh` | Entry point of that image: composes, then recomposes whenever an input changes |
| `insomnia/collection.yaml` | Router smoke query, `/health`, `/metrics`; merged into the root collection |

---

## 2. Run it

From the repo root:

```bash
podman compose --profile apps up -d                     # dependencies + supergraph + router
podman compose --profile apps logs -f supergraph router # follow composition and router logs
podman compose --profile apps exec supergraph cat /supergraph/supergraph.graphql  # see the composed schema
```

Then start the subgraphs on the host (`yarn dev` in `services/auth`, …).

| URL | What |
|---|---|
| http://localhost:4000/graphql | GraphQL endpoint. Opened in a browser, it shows **Apollo Sandbox** |
| http://localhost:8088/health | Liveness: `{"status":"UP"}` |
| http://localhost:9080/metrics | Prometheus metrics |

All ports bind to `127.0.0.1`, so nothing is exposed to the network.

Quick check:

```bash
curl -si localhost:4000/graphql -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# → {"data":{"__typename":"Query"}}, plus an x-request-id response header
```

---

## 3. How the supergraph is built

1. The **`supergraph`** container mounts `./services` read-only at `/workspace/services`, the same layout as the repo, so the relative schema paths in `supergraph.yaml` resolve.
2. `watch-compose.sh` runs `rover supergraph compose` and writes `supergraph.graphql` into the shared `supergraph-data` volume.
3. Every 2 seconds it fingerprints `supergraph.yaml` plus every `services/*/src/graphql/schema.graphql`. When something changed, it composes again.
4. The **`router`** container reads the same volume. With `APOLLO_ROUTER_HOT_RELOAD=true`, it reloads the new supergraph (and any `router.yaml` change) without a restart.

Details:
- **A failed composition keeps the last good supergraph.** The error appears in `logs supergraph`, and the router keeps serving.
- Output is copied **in place** (not moved), so the router's file watcher sees a change to the same file.
- The script **polls** instead of using inotify, because file events from the macOS host don't reliably reach the Podman VM.
- The router only starts once the supergraph exists (`depends_on: service_healthy`, which checks that the file isn't empty).
- Schemas come from **files**, not introspection, so composition works even when a subgraph is down.

---

## 4. Router configuration (`router.yaml`)

| Setting | Value | Why |
|---|---|---|
| `supergraph.listen` | `0.0.0.0:4000`, path `/graphql` | Inside a container, `127.0.0.1` isn't reachable from the host. Compose publishes the port on `127.0.0.1` only. |
| `supergraph.introspection`, `sandbox` | on | Dev only, for autocomplete and Sandbox. Turned off in production. |
| `health_check` | `:8088/health` | For compose, ECS and Kubernetes probes |
| `cors` | `http://localhost:8081` (Expo web), `https://studio.apollographql.com` | The only browser origins allowed |
| `headers` | propagate `authorization`, `user-agent`, `x-forwarded-for` | Auth reads the Bearer token, and records the device (`User-Agent`) and client IP (`X-Forwarded-For`, with `TRUST_PROXY=1`) on sessions |
| `include_subgraph_errors.all` | `true` | The router **redacts subgraph errors by default**, which would hide auth's `UNAUTHENTICATED` + `extensions.reason`. Subgraphs mask their own internal errors. |
| `limits.router.http_max_request_bytes` | `102400` (100 KB) | Same limit as auth's `express.json` |
| `traffic_shaping.all.timeout` | `10s` | Per-subgraph request timeout |
| `telemetry … prometheus` | `:9080/metrics` | Not the default 9090, which the Prometheus server will use later |

Not set yet: **operation limits** (`max_depth`, `max_aliases`, …) are a GraphOS Enterprise feature, and without a license the router refuses to start. Depth and complexity limits come in week 31, on the subgraph side or through persisted queries.

---

## 5. Correlation ID (`rhai/main.rhai`)

One id follows a request through every service:

1. A client request arrives. The script reuses its `x-request-id` header, or generates a UUID.
2. The id is sent as `x-request-id` on **every subgraph call** for that request.
3. The router returns it to the client in the `x-request-id` response header.

Subgraphs use it as their log request id (auth: `src/lib/request-context.ts`). To trace one query across services, send your own `x-request-id` and search the logs for it.

---

## 6. Add a subgraph

1. Build the service with its schema at `services/<name>/src/graphql/schema.graphql`.
2. Add it to `supergraph.yaml`:
   ```yaml
   subgraphs:
     catalog:
       routing_url: http://host.containers.internal:4002/graphql
       schema:
         file: ../catalog/src/graphql/schema.graphql
   ```
   Use `host.containers.internal`, not `localhost`: the router runs in a container while the service runs on the host. Podman defines this name; compose's `extra_hosts` adds it for Docker.
3. Save. Within about 2 seconds `logs supergraph` shows `[supergraph] composed at …` (or the composition error), and the router reloads.
4. If the subgraph uses a newer federation `@link` version than `federation_version`, bump the version first (see § 7).
5. Add `services/<name>/insomnia/collection.yaml` and run `yarn build` in `insomnia/` so the root collection includes it.

---

## 7. Version bumps

| What | Where | Then |
|---|---|---|
| Federation / composition | `federation_version` in `supergraph.yaml` **and** `SUPERGRAPH_VERSION` in `rover/Dockerfile` (keep them equal; must be ≥ the highest `@link` version any subgraph uses) | `podman compose --profile apps up -d --build supergraph` |
| Rover | `ROVER_VERSION` in `rover/Dockerfile` | Same rebuild |
| Router | `image:` tag of `router` in `compose.yaml` | `podman compose --profile apps up -d router` |

After a router bump, check the config still validates, since config keys move between versions:

```bash
podman compose --profile apps run --rm --no-deps router config validate /config/router.yaml
# → Configuration at path "/config/router.yaml" is valid!
```

`watch-compose.sh` is copied into the image, so editing it also needs the `--build supergraph` rebuild.

---

## 8. Gotchas

- **Router 2.18 config format:** header rules are nested under `headers.all.request.operations: [...]`, and the request size limit moved to `limits.router.http_max_request_bytes`. Older examples online use the previous shapes.
- **Subgraphs must not answer with HTTP 401/403.** The router then adds an extra `SUBREQUEST_HTTP_ERROR` next to the real `UNAUTHENTICATED` error. Return HTTP 200 with a GraphQL error.
- **Federation fields aren't public.** `_service` and `_entities` are only answered by subgraphs directly, not by the router.
- **Docker vs Podman:** `host.containers.internal` is built into Podman. The `extra_hosts: host-gateway` line makes Docker behave the same.

---

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| Router container keeps restarting | `logs router`. It's usually an invalid `router.yaml`; run `config validate` (§ 7). |
| Router never starts | The `supergraph` container isn't healthy, so the first composition failed. Look at `logs supergraph`. |
| Schema change doesn't show up | `logs supergraph`: is there a composition error? The router keeps the last good supergraph until composition succeeds. |
| `Connection refused` from a subgraph | The service isn't running on the host, or `routing_url` has the wrong port or uses `localhost`. |
| Client gets a generic error, not the subgraph's | `include_subgraph_errors` was removed or narrowed. |
| Composition fails after adding a subgraph | Its federation `@link` version is newer than `federation_version` (§ 7), or two subgraphs define the same type or field without federation directives. |

---

## 10. Later phases

| Phase | Change |
|---|---|
| 2 | Subgraphs move into compose; `routing_url` becomes `http://<service>:<port>/graphql` |
| 3 | Router deployed on ECS behind an ALB; a `staging` environment points at it |
| 4 | CI publishes `supergraph.graphql` into `gitops/` as a ConfigMap, and Argo CD rolls out the router |
| 6 (week 31) | Query depth and complexity limits |
