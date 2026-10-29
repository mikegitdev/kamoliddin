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
4. **No fabricated provider behavior.** CLICK / DevSMS / Eskiz / Play Mobile /
   2GIS adapters may only contain behavior verified against provider docs or
   sandbox tests.
   Unverified flows must raise `NotImplementedError` with a reference to the spec
   gate (§19). Never simulate a production payment success outside the fake adapter.
5. Every PR that changes models **includes migrations**; API changes include the
   regenerated OpenAPI schema + TS client; behavior changes include tests
   (see "Testing policy" below).
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
            src layers: app/ pages/ features/ entities/ shared/ + map-adapters/
backend/    Django 5.2 modular monolith (DRF, PostGIS, Celery, Garage)
            apps/: core, accounts, businesses, locations, campaigns,
            placements, billing, payments, discovery, moderation
            (+ renewals — RETIRED, kept installed only so its migration
            chain can drop the old renewal tables; no new code there, ADR-0007)
infra/      nginx, docker, deploy scripts, backups
docs/       product, architecture/ADR, runbooks, acceptance
```

Before touching the advertiser write path (Business / Branch / Campaign /
quote / checkout) read `docs/architecture/field-contract.md` — it maps every
field across DB, API and UI layers; when code and it disagree, **code wins** and
the contract must be regenerated.

## Dev commands (verified)

```bash
./dev.sh                                  # infra + backend + frontend (handles the no-GDAL Docker fallback)
cd backend && uv run python manage.py seed --demo --reset   # demo dataset (destructive reset)
cd backend && uv run celery -A config worker -l info        # background jobs (placement states, reconciliation)
cd backend && uv run celery -A config beat -l info          # scheduled tasks
```

## Generated artifacts — never hand-edit

- `frontend/openapi.json` — regenerate with
  `cd backend && uv run python manage.py spectacular --file ../frontend/openapi.json`
- `frontend/src/shared/api/schema.d.ts` — regenerate with
  `cd frontend && npm run gen:api`
- CI fails on drift between committed artifacts and regeneration — always
  commit both together after API changes.
- Django migrations: edit models, then `uv run python manage.py makemigrations`
  and commit the migration (forward-only; CI runs `makemigrations --check`).

## Checks to run before requesting review (mirror CI `.github/workflows/ci.yml`)

```bash
# backend (pytest needs the compose PostGIS running — never SQLite)
cd backend && uv run ruff check .
cd backend && uv run mypy apps/billing apps/payments apps/placements   # financial-core gate; whole-repo mypy is tracked debt
cd backend && uv run python manage.py makemigrations --check --dry-run
cd backend && uv run python -m pytest

# frontend
cd frontend && npm run lint && npm run typecheck && npm run build
```

Without local GDAL, run backend checks inside the dev container
(`docker exec localads-backend-dev ...`).

## Testing policy

- Default to **no new tests** for ordinary changes (UI tweaks, wiring, renames).
- Add/extend a focused pytest module only for genuinely risky logic: pricing,
  settlement/refund state machines, capacity/cap limits, auth/OTP, public
  API contracts. Existing suites live in `backend/apps/*/tests/` and run
  against real PostGIS (`config.settings.test`).
- Fixing a test your change broke is always required.
- Playwright e2e (`frontend/e2e/`, `npm run e2e`) is a manual smoke tool,
  not CI — do not extend it unless explicitly asked.

## Module ownership (parallel-agent model, spec §16)

- **Architect/maintainer owns:** domain schema (`backend/apps/*/models.py` migration
  chain), API versioning (`/api/v1`), payments/refunds state machines.
- Feature agents own everything behind those contracts.
- Do not parallel-edit: migration chains, financial invariants, `docker-compose` files.
