#!/usr/bin/env bash
# End-to-end check of run.py --satellite (library, trim, export). No ComfyUI / GPU.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${TMPDIR:-/tmp}/frameforge-e2e-$$"
PORT="${FRAMEFORGE_E2E_PORT:-18787}"
SECRET="${FRAMEFORGE_PROXY_SECRET:-e2e-local-proxy-secret}"
WS="e2e000000000000000000000000000001"
USER="e2e000000000000000000000000000002"

mkdir -p "$DATA"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$DATA"' EXIT

ffmpeg -y -f lavfi -i testsrc2=size=320x180:rate=24 -t 2 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 \
  -c:v libx264 -c:a aac "$DATA/fixture.mp4" >/dev/null 2>&1

export FRAMEFORGE_SATELLITE=1 FRAMEFORGE_PROXY_SECRET="$SECRET" FRAMEFORGE_DATA_ROOT="$DATA"
python3 "$ROOT/run.py" --satellite --port "$PORT" --local-only &
sleep 2

BASE="http://127.0.0.1:$PORT"
HDR=( -H "X-FF-Proxy-Secret: $SECRET" -H "X-FF-Workspace-Id: $WS" -H "X-FF-User-Id: $USER" )

code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/state")"
if [[ "$code" != "401" ]]; then
  echo "expected 401 without proxy headers, got $code" >&2
  exit 1
fi

curl -sS "${HDR[@]}" -F "file=@$DATA/fixture.mp4" "$BASE/api/assets" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('id')"

PID="$(curl -sS "${HDR[@]}" -X POST "$BASE/api/projects" -H 'Content-Type: application/json' -d '{"name":"E2E satellite"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")"

STATE="$(curl -sS "${HDR[@]}" "$BASE/api/state")"
AID="$(python3 -c "import json,sys; s=json.loads(sys.argv[1]); print(next(iter(s['assets'])))" "$STATE")"

python3 - "$PID" "$AID" "$BASE" "$SECRET" "$WS" "$USER" <<'PY'
import json, sys, time, urllib.request
pid, aid, base, secret, ws, user = sys.argv[1:7]
def api(path, body=None, method=None):
    data = None
    headers = {
        'X-FF-Proxy-Secret': secret,
        'X-FF-Workspace-Id': ws,
        'X-FF-User-Id': user,
    }
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
        if method is None:
            method = 'POST'
    if method is None:
        method = 'GET'
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

state = api('/api/state')
proj = state['projects'][pid]
seg = proj['scenes'][0]['segments'][0]
seg.update(name='Clip', prompt='e2e', duration=1.0, main=aid, trim_in=0.25)
api('/api/projects/' + pid, proj, 'PUT')
job = api('/api/export', {'project_id': pid, 'mode': 'video'})
for _ in range(120):
    jobs = api('/api/state')['jobs']
    cur = next(j for j in jobs if j['id'] == job['id'])
    if cur['status'] in ('completed', 'failed'):
        break
    time.sleep(0.25)
assert cur['status'] == 'completed', cur
print('PASS satellite e2e: import, save, export', cur.get('download'))
PY

echo "OK: scripts/e2e-satellite-api.sh"
