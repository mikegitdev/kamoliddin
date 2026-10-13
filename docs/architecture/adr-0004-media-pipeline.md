# ADR-0004: Media pipeline — re-encode, dimension policy, serve tradeoff

**Status:** Accepted · **Date:** 2026-10-13

## Context

Spec §11 recommends type/size/magic-byte validation and optional re-encoding /
metadata stripping. The prior implementation validated magic bytes but stored
the original bytes verbatim: a phone photo's GPS EXIF went public with every
banner, and dimension policy did not exist.

## Decisions

1. **Every upload is re-encoded through Pillow** (`Image.open →
   exif_transpose → save`): EXIF (incl. GPS), ICC, XMP and trailing payloads
   are discarded — the stored object is a fresh encode of the pixel data.
   EXIF orientation is applied before stripping. JPEG/WEBP save at quality 88,
   optimized; JPEG is converted to RGB as needed.
2. **Dimension policy:** banners ≥ 600×300 (long edge capped at 2048),
   logos ≥ 128×128 (long edge capped at 512). Minimums are enforced before
   save; undersized uploads are rejected with the actual dimensions in the
   message. Exact aspect is deliberately NOT locked ([O] product may tighten).
3. **Serve tradeoff (explicit):** `MediaServeView` serves any object under
   `banners/` / `logos/` whose unguessable UUID key is known, regardless of
   campaign approval state. Spec §11's "public reference only for approved
   campaigns" is approximated by unguessability + 24h cache, because
   per-approval gating of media URLs would break the advertiser cabinet
   preview flow and add an entitlement join to every image request. Rejected
   risk accepted and recorded here.
4. **Orphan cleanup** is a management command (`prune_orphan_media`,
   7-day grace, `--dry-run`), run weekly via cron — unreferenced keys from
   abandoned drafts do not accumulate forever.

## Consequences

- Uploaded bytes and stored bytes differ (stored is smaller and clean);
  object keys are minted after re-encode from the detected format.
- Tests assert a marker embedded in EXIF never survives to storage or serve.
