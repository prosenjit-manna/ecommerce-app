# packages/

Shared libraries. Each folder is a **standalone Yarn project published to public npm** under your scope (e.g. `@<your-scope>/config-ts`). Services install them by version like any other dependency. Nothing is linked through workspaces.

| Folder | What | Phase |
|---|---|---|
| `config-ts/` | Shared `tsconfig` base (strict) | 0 |
| `config-eslint/` | Shared ESLint config | 0 |
| `service-kit/` | Server boilerplate: env, logging, Express + Apollo subgraph setup, JWT/JWKS verification, rate limiting, errors, metrics. **Built so far:** `@ecommerce/service-kit/metrics` (Prometheus: HTTP, GraphQL outcomes, Node.js runtime) | 1 |
| `contracts/` | Event schemas (SNS/SQS) shared between services | 1 |
| `shared-types/` | Shared zod schemas and TypeScript types (API + mobile) | 1 |

**Releasing:** bump `version` (semver), then tag `<package>@<version>` (e.g. `config-ts@0.1.0`). CI publishes with npm provenance. Breaking changes need a major version.

**Local development:** to try an unreleased change in a service, run `yarn link ../../packages/<name>` there, and revert it before committing.
