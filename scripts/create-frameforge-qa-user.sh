#!/usr/bin/env bash
# Ops-only: create a synthetic OneID user on shared One OS (auth.oweb.one).
# Requires service role. Never run from agent transcripts or commit output to tickets.
set -euo pipefail

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (One OS project ebjzdcnphkfpxfldnatm)." >&2
  exit 1
fi

if [[ -z "${FF_QA_PASSWORD:-}" ]]; then
  echo "Set FF_QA_PASSWORD from the approved secret store (do not use predictable defaults)." >&2
  exit 1
fi

TAG="${1:-one205}"
EMAIL="${FF_QA_EMAIL:-frameforge.qa+${TAG}-$(date +%s)@salesflow.one}"
PASS="${FF_QA_PASSWORD}"

USER_JSON=$(curl -sS -X POST "${SUPABASE_URL%/}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"FrameForge QA ${TAG}\"}}")

USER_ID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('id',''))" "$USER_JSON")
if [[ -z "$USER_ID" ]]; then
  echo "$USER_JSON" >&2
  exit 1
fi

echo "user_id=${USER_ID}"
echo "email=${EMAIL}"
echo "password=*** (from FF_QA_PASSWORD — not printed)"
echo "login=https://chain-motion-ai-video-editor-oweb.vercel.app/login"
echo "Store email + password in the approved ONE-202 secret store only."
