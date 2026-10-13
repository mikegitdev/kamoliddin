#!/usr/bin/env bash
# Bootstrap Garage for production (spec §11, ADR-0002): import the
# least-privilege app key scoped to the media bucket — read/write on that one
# bucket, no bucket-creation right, no owner bit (verified on v2.4.1: such a
# key gets AccessDenied on CreateBucket and PutBucketWebsite). The app never
# uses the bootstrap (default) key. Idempotent — safe on every deploy.
set -euo pipefail

ENV_FILE="${ENV_FILE:-infra/docker/.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.prod.yml}"
GARAGE_TOML="${GARAGE_TOML:-infra/docker/garage.prod.toml}"
NETWORK="${NETWORK:-local-ads-prod_backend_net}"
BUCKET="${BUCKET:-localads-media}"
CURL_IMAGE="${CURL_IMAGE:-curlimages/curl:8.11.1}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (see infra/docker/.env.prod.example)" >&2; exit 1; }
[ -f "$GARAGE_TOML" ] || { echo "missing $GARAGE_TOML (generate it — docs/runbooks/deploy.md)" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${GARAGE_APP_ACCESS_KEY:?must be set in $ENV_FILE}"
: "${GARAGE_APP_SECRET_KEY:?must be set in $ENV_FILE}"

ADMIN_TOKEN="$(grep -E '^admin_token' "$GARAGE_TOML" | head -1 | cut -d'"' -f2)"
[ -n "$ADMIN_TOKEN" ] || { echo "admin_token not found in $GARAGE_TOML" >&2; exit 1; }

echo "==> ensuring garage is up and healthy"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --wait garage

api() {  # api METHOD PATH [JSON_BODY] -> response body on stdout
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    docker run --rm --network "$NETWORK" "$CURL_IMAGE" -s -m 30 \
      -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H 'Content-Type: application/json' -d "$body" "http://garage:3903$path"
  else
    docker run --rm --network "$NETWORK" "$CURL_IMAGE" -s -m 30 \
      -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" "http://garage:3903$path"
  fi
}

BID="$(api GET "/v2/GetBucketInfo?search=$BUCKET" | grep -oE '"id": *"[0-9a-f]{64}"' | head -1 | grep -oE '[0-9a-f]{64}')"
[ -n "$BID" ] || { echo "bucket $BUCKET not found — GARAGE_DEFAULT_BUCKET mismatch?" >&2; exit 1; }

if [ "$(docker run --rm --network "$NETWORK" "$CURL_IMAGE" -s -o /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      "http://garage:3903/v2/GetKeyInfo?search=$GARAGE_APP_ACCESS_KEY")" = "200" ]; then
  echo "==> app key already imported"
else
  echo "==> importing app key $GARAGE_APP_ACCESS_KEY"
  api POST /v2/ImportKey \
    "{\"accessKeyId\":\"$GARAGE_APP_ACCESS_KEY\",\"secretAccessKey\":\"$GARAGE_APP_SECRET_KEY\",\"name\":\"localads-app\"}" >/dev/null
  # Guard against silent no-ops: the key must now exist (200).
  code="$(docker run --rm --network "$NETWORK" "$CURL_IMAGE" -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "http://garage:3903/v2/GetKeyInfo?search=$GARAGE_APP_ACCESS_KEY")"
  [ "$code" = "200" ] || { echo "import failed (GetKeyInfo -> $code)" >&2; exit 1; }
fi

echo "==> granting read+write on $BUCKET (idempotent)"
api POST /v2/AllowBucketKey \
  "{\"bucketId\":\"$BID\",\"accessKeyId\":\"$GARAGE_APP_ACCESS_KEY\",\"permissions\":{\"read\":true,\"write\":true}}" >/dev/null

echo "OK: $BUCKET ready; app key scoped read/write only."
