# AGENTS.md — repo rules for AI agents

Project: Local Advertising Map Platform (Tashkent) — see
`Local_Advertising_Engineering_Spec_v1_EN.md` for the authoritative engineering spec.
Spec status markers: **[C]** confirmed decision (never change silently),
**[R]** recommended default, **[E]** external dependency gate, **[O]** open detail.

## Ground rules

1. **English only** in code, commits, PRs, and docs.
2. **Read the relevant ADR** in `docs/architecture/` before editing domain schema,
   API versioning, or payment state machines.
3. **One task / one branch / one worktree.** Do not touch another module's
   migration chain or financial invariants in the same change.
4. **No fabricated provider behavior.** CLICK / Eskiz / Play Mobile / 2GIS adapters
   may only contain behavior verified against provider docs or sandbox tests.
   Unverified flows must raise `NotImplementedError` with a reference to the spec
   gate (§19). Never simulate a production payment success outside the fake adapter.
5. Every PR that changes models **includes migrations**; API changes include the
   regenerated OpenAPI schema; behavior changes include tests (per repo testing policy).
6. **Never write raw card data** (PAN/CVV) anywhere. Payments are one-time per
   order — no stored tokens or recurring charges (ADR-0007).
7. Never bypass permission checks or disable throttling to "make it work".
8. **Preserve idempotency**: order creation, webhook processing, placement
   activation, and refunds must stay idempotent under retries and
   duplicate callbacks.
9. Security-sensitive and paid-entitlement changes require maintainer review —
   flag them explicitly in the PR description.
10. Run **lint + typecheck + tests** before requesting review. No failing CI.
11. Include rollback implications (forward-only migrations, data backfills) in the PR.
12. No unexplained package upgrades. Lockfiles change only deliberately.
13. **Log open assumptions** in the PR description or `docs/architecture/open-questions.md`.

## Repo layout

```text
frontend/   React + Vite + TypeScript (map-first UI, RU/UZ)
backend/    Django 5.2 modular monolith (DRF, PostGIS, Celery, Garage)
infra/      nginx, docker, deploy scripts, backups
docs/       product, architecture/ADR, runbooks, acceptance
```

## Module ownership (parallel-agent model, spec §16)

- **Architect/maintainer owns:** domain schema (`backend/apps/*/models.py` migration
  chain), API versioning (`/api/v1`), payments/refunds state machines.
- Feature agents own everything behind those contracts.
- Do not parallel-edit: migration chains, financial invariants, `docker-compose` files.
