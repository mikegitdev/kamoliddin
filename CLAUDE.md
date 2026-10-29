# CLAUDE.md

All agent rules for this repo live in [`AGENTS.md`](./AGENTS.md) — read it first:

@AGENTS.md

Quick reference (full detail in AGENTS.md):

- Spec: `Local_Advertising_Engineering_Spec_v1_EN.md` (markers: **[C]** confirmed,
  **[R]** recommended, **[E]** external gate, **[O]** open). ADRs in
  `docs/architecture/`. Field contract for the advertiser write path:
  `docs/architecture/field-contract.md` (code wins on mismatch).
- Dev: `./dev.sh` (infra + backend + frontend, Docker fallback without GDAL).
  Demo data: `cd backend && uv run python manage.py seed --demo --reset` (destructive).
- Never hand-edit generated artifacts: `frontend/openapi.json`
  (`manage.py spectacular --file ../frontend/openapi.json`) and
  `frontend/src/shared/api/schema.d.ts` (`npm run gen:api`). CI fails on drift —
  commit both together.
- No fabricated provider behavior (CLICK / DevSMS / Eskiz / Play Mobile / 2GIS):
  unverified flows raise `NotImplementedError` (spec §19). Payments are one-time
  per order only (ADR-0007). Idempotency of orders, webhooks, activation and
  refunds is sacred.
- Checks before review: backend `ruff check .`, financial-core
  `mypy apps/billing apps/payments apps/placements`, `makemigrations --check`,
  `python -m pytest` (real PostGIS, never SQLite); frontend `npm run lint`,
  `npm run typecheck`, `npm run build`.
- Default to no new tests; add focused pytest only for risky logic
  (pricing, settlement/refunds, capacity, auth/OTP, public API contracts).
- `backend/apps/renewals` is retired — kept installed only for its migration
  chain (ADR-0007).
