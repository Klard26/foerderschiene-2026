#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift
fi

production_url="${1:-${PRODUCTION_URL:-}}"

if [[ -z "$production_url" ]]; then
  echo "Usage: $0 https://<production-host>" >&2
  echo "   or: PRODUCTION_URL=https://<production-host> $0" >&2
  exit 2
fi

if [[ "$production_url" != https://* ]]; then
  echo "Production URL must use https://" >&2
  exit 2
fi

webhook_url="${production_url%/}/api/billing/webhook"
expected_response="Missing stripe-signature"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

curl_exit=0
status="$(
  curl \
    --silent \
    --show-error \
    --output "$response_file" \
    --write-out '%{http_code}' \
    --connect-timeout 10 \
    --max-time 30 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary '{"probe":"post-deploy"}' \
    "$webhook_url"
)" || curl_exit=$?
response_body="$(<"$response_file")"

if [[ "$curl_exit" -ne 0 ]]; then
  printf 'Production webhook probe failed: URL=%s; curl exited %s; received HTTP %s; response=%s\n' \
    "$webhook_url" \
    "$curl_exit" \
    "${status:-000}" \
    "${response_body:-<empty>}" >&2
  exit 1
fi

if [[ "$status" != "400" || "$response_body" != "$expected_response" ]]; then
  printf 'Production webhook probe failed: expected HTTP 400 with the Stripe signature guard response; URL=%s; received HTTP %s; response=%s\n' \
    "$webhook_url" \
    "$status" \
    "${response_body:-<empty>}" >&2
  exit 1
fi

echo "Production webhook is reachable: $webhook_url returned HTTP 400 with the Stripe signature guard response"