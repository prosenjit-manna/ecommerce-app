# Changelog

This file tracks what has been implemented, phase by phase. See [ROADMAP.md](ROADMAP.md) for the full plan.

Format: loosely based on [Keep a Changelog](https://keepachangelog.com/). Newest entries go at the top of the log.
Entry types: **Added**, **Changed**, **Removed**, **Fixed**, **Learned** (key takeaways, gotchas, links to ADRs).

---

## Progress

| Phase | Name | Weeks | Status |
|---|---|---|---|
| 0 | Foundations | 1 | 🟡 In progress |
| 1 | Backend Deep Dive: Modular Monolith | 2–7 | ⚪ Not started |
| 2 | Containers & CI | 8–9 | ⚪ Not started |
| 3 | AWS Core + Terraform | 10–13 | ⚪ Not started |
| 4 | Microservices | 14–19 | ⚪ Not started |
| 5 | Kubernetes + GitOps | 20–25 | ⚪ Not started |
| 6 | React Native Mobile App | 26–31 | ⚪ Not started |
| 7 | Hardening & Portfolio | 32 | ⚪ Not started |

Legend: ⚪ Not started · 🟡 In progress · ✅ Done (the "Done when" checklist passed)

### Phase 0 checklist
- [x] Directory structure (`apps/`, `services/`, `packages/`, `infra/`, `gitops/`, `docs/adr/`)
- [x] Changelog
- [ ] Monorepo: pnpm workspaces + Turborepo
- [ ] TypeScript strict (shared `packages/config-ts`)
- [ ] ESLint + Prettier (shared `packages/config-eslint`)
- [ ] Husky + commitlint (conventional commits)
- [ ] `docker-compose.yml`: Postgres, Redis, Mailpit
- [ ] Empty Express app in `apps/api`
- [ ] First ADR in `docs/adr/`
- [ ] **Done when:** `pnpm dev` starts the Express app and Docker deps with one command

---

## Log

### 2026-10-05 · Phase 0
**Added**
- Project directory structure, with a README in each top-level folder describing its purpose and phase.
- `CHANGELOG.md` to track implementation progress.

**Changed**
- Backend framework: Express 5 + TypeScript (Fastify removed from the roadmap).

### 2026-10-01 · Planning
**Added**
- `ROADMAP.md`: 32-week learning plan (backend → containers/CI → AWS → microservices → Kubernetes/GitOps → React Native).
