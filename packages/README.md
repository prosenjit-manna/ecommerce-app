# packages/

Shared internal packages, consumed via pnpm workspaces.

| Folder | What | Phase |
|---|---|---|
| `config-ts/` | Shared `tsconfig` base (strict) | 0 |
| `config-eslint/` | Shared ESLint config | 0 |
| `shared-types/` | Shared zod schemas and TypeScript types (API + mobile) | 1 |
| `contracts/` | Event schemas shared between services | 4 |
