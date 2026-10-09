# Root Insomnia collection

> Scope: `insomnia/` (the generator and the generated root collection) and the per-service collections in `services/*/insomnia/collection.yaml` that feed it.
> Related: [backend-api.md § 4](backend-api.md#4-api-testing-with-insomnia) covers the overall Insomnia conventions (folders, environments, automation).

`insomnia/collection.yaml` holds **every API in one Insomnia collection**. Nobody writes it by hand: `insomnia/build.mjs` merges every service collection into it.

```
services/api-gateway/insomnia/collection.yaml ─┐
services/auth/insomnia/collection.yaml ────────┼──► yarn build ──► insomnia/collection.yaml
services/<next>/insomnia/collection.yaml ──────┘    (build.mjs)     (generated: don't edit)
```

---

## 1. Quick start

1. Start the router: `podman compose --profile apps up -d` (from the repo root).
2. Start each service you want to call: `yarn dev` in `services/<name>`.
3. In Insomnia: **Import** → **File** → `insomnia/collection.yaml`.
4. Pick the **local** environment.
5. Run *API gateway → Router → Smoke query* to confirm the router is up, then follow a service's numbered folders (for auth: *1. Sign up* → *signUp* → *verifyEmail*).

Re-importing after a rebuild updates the same collection, because the ids are stable (see [§ 3](#3-how-the-build-works)).

---

## 2. Everyday workflow

| You want to… | Do this |
|---|---|
| Add or change a request | Edit the **service** collection (in Insomnia, then export it over `services/<name>/insomnia/collection.yaml` as Insomnia v5 YAML). Then run `yarn build` in `insomnia/`. |
| Add a new service | Create `services/<name>/insomnia/collection.yaml`. The next `yarn build` picks it up as a new top folder; no config needed. |
| Change the root collection directly | Don't. The next build overwrites it. |
| Rebuild | `cd insomnia && yarn build` (run `yarn install` once first). |

Commit the regenerated `insomnia/collection.yaml` together with the service collection change that caused it.

---

## 3. How the build works

### Layout
- One top folder per service, named after the service collection's `name`. **API gateway comes first**, then the other services alphabetically.
- Each service's folders (*1. Sign up*, *Federation*, *REST*, …) sit unchanged inside its top folder.
- The service collection's description becomes the top folder's description.

### Routing: which address each request uses
The root collection tests the system **the way clients use it**, so GraphQL goes through Apollo Router:

| Request | Goes to | Why |
|---|---|---|
| GraphQL operation (`{{ _.baseUrl }}{{ _.graphqlPath }}`) | Router: `apiGatewayUrl` (`:4000`) | Same path as the mobile app: header propagation, `x-request-id` and error passthrough all get exercised |
| Federation query (body contains `_service` or `_entities`) | The service: e.g. `authUrl` (`:4001`) | The router doesn't expose these fields to clients |
| Anything else (`/health`, `/ready`, JWKS, …) | The service: e.g. `authUrl` | Plain HTTP endpoints live on each service, not on the router |

The rewrite covers URLs, descriptions and scripts. For example, the refresh-token-reuse script's `insomnia.environment.get('baseUrl')` becomes `get('apiGatewayUrl')`.

### Variables
- Each service's `baseUrl` becomes **`<service>Url`** in camelCase: `auth` → `authUrl`, `api-gateway` → `apiGatewayUrl`, `catalog` → `catalogUrl`.
- All other base-environment variables (`email`, `password`, `accessToken`, `mailpitUrl`, …) are merged into one base environment. Because the collection shares one set of tokens, signing in through auth gives every other service's requests a token.
- If two services set the same variable to **different** values, the first one wins (gateway first, then alphabetical) and the build prints a warning:
  ```
  ! catalog: email="x@example.com" ignored, keeping "test.user@example.com"
  ```
  Fix it by using the same value in both services, or by giving the variable a service-specific name.
- `userAgent` is always `Insomnia (root collection)`.

### Environments
- Sub-environments with the same name in different services (`local`, `staging`) are merged into one, with the same `baseUrl` → `<service>Url` renaming.
- Each service's **`gateway`** sub-environment is dropped: the root collection always sends GraphQL through the router, so it isn't needed.

### Ids
Every id (workspace, folders, requests, environments, cookie jar) is derived from the source id with an MD5 hash. As a result:
- Importing the root collection **next to** a service collection doesn't move requests from one to the other.
- Rebuilding gives the same ids, so re-importing updates the collection instead of duplicating it.

---

## 4. Rules for service collections

The build relies on these conventions in every `services/*/insomnia/collection.yaml`:

- **`type: collection.insomnia.rest/5.0` must be the first line.** Insomnia only tries its v5 importer when the file starts with `type: `; a comment above it makes the import fail with *"No importers found for file"*. Comments go below the `type:` line.
- GraphQL requests use `{{ _.baseUrl }}{{ _.graphqlPath }}` as the URL.
- Plain HTTP requests use `{{ _.baseUrl }}/<path>`.
- The base environment defines `baseUrl` (the service's own address) and `graphqlPath: /graphql`.
- `services/api-gateway/insomnia/collection.yaml` must exist; the build stops without it, because it defines the router address.

---

## 5. Files

| File | What |
|---|---|
| `insomnia/build.mjs` | The generator (Node, one dependency: `yaml`) |
| `insomnia/collection.yaml` | Generated root collection: import this one |
| `insomnia/package.json` | Standalone Yarn 4 project, `yarn build` script |
| `services/api-gateway/insomnia/collection.yaml` | Router smoke query (checks the `x-request-id` echo), `GET /health` (`:8088`), `GET /metrics` (`:9080`); cross-service flows go here as services are built |
| `services/<name>/insomnia/collection.yaml` | Each service's own collection; also usable on its own against the service directly |

---

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Import says *"No importers found for file"* | The file doesn't start with `type: `. Move any leading comments below the `type:` line. |
| GraphQL requests fail with connection refused on `:4000` | The router isn't running: `podman compose --profile apps up -d`. |
| Router answers, but an operation errors with a subgraph fetch failure | That service isn't running (`yarn dev` in `services/<name>`), or the supergraph doesn't include it yet (`services/api-gateway/supergraph.yaml`). |
| `_service` / `_entities` / `/health` fail | They go to the service directly, so it must be running on its own port. |
| A variable has an unexpected value | Check the build output for `!` conflict warnings (see [§ 3](#variables)). |
| A request change doesn't show up | You edited the root collection or forgot to rebuild. Edit the service collection, run `yarn build`, re-import. |
| `services/api-gateway/insomnia/collection.yaml is missing` | The build needs the gateway collection for the router address. Restore it. |
