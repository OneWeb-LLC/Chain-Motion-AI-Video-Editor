#!/usr/bin/env bash
# Create a synthetic OneID user on shared One OS (auth.oweb.one) for FrameForge QA.
# Requires Supabase service-role access (run from ops shell or CI with secrets).
# Does NOT print service keys. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
set -euo pipefail

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (One OS project ebjzdcnphkfpxfldnatm)." >&2
  exit 1
fi

TAG="${1:-one205}"
EMAIL="frameforge.qa+${TAG}-$(date +%s)@salesflow.one"
PASS="${FF_QA_PASSWORD:-Ff-QA-${TAG}-Test!}"

curl -sS -X POST "${SUPABASE_URL%/}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"FrameForge QA ${TAG}\"}}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or d)"

echo "email=${EMAIL}"
echo "password=${PASS}"
echo "login=https://chain-motion-ai-video-editor-oweb.vercel.app/login"
