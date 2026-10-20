# Environment audit — Frameforge OWeb satellite

This satellite intentionally **does not** ship `SUPABASE_SERVICE_ROLE_KEY`. SSO redeem and launch tokens are consumed by OWeb (`POST /api/v1/ecosystem/redeem-launch-token`).

## Required (Vercel / production)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Shared One OS auth (`https://auth.oweb.one`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | Browser + server Supabase client |
| `NEXT_PUBLIC_OWEB_APP_URL` | Control plane (`https://oweb.one`) |
| `NEXT_PUBLIC_OWEB_PLATFORM_API_URL` | Activation + redeem API base |
| `NEXT_PUBLIC_APP_URL` / `APP_URL` | This satellite’s public URL (SSO return) |
| `NEXT_PUBLIC_FF_REQUIRE_AUTH` / `FF_REQUIRE_AUTH` | Enforce OneID on studio + editor shell |
| `FRAMEFORGE_API_URL` | Reachable `run.py` service (library, export, jobs) |
| `FRAMEFORGE_PROXY_SECRET` | Shared secret between Next.js proxy and Python API |

## Python API (`run.py --satellite`)

| Variable | Purpose |
| --- | --- |
| `FRAMEFORGE_SATELLITE=1` | Enable workspace-scoped libraries + proxy trust |
| `FRAMEFORGE_PROXY_SECRET` | Must match the Vercel value |
| `FRAMEFORGE_DATA_ROOT` | Root directory containing `workspaces/<workspace_id>/` libraries |

## Optional

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_OWEB_APP_ID` | Display / telemetry (`frameforge`) |
| `SUPABASE_PROJECT_ID` | Documentation pin (`ebjzdcnphkfpxfldnatm`) |

## Forbidden in committed env files

- `SUPABASE_SERVICE_ROLE_KEY` (centralized on OWeb only)
- Comfy Cloud / LLM API keys in Vercel env (stay on the Python library host)

## Production audit (2026-10-20)

Vercel project `chain-motion-ai-video-editor-oweb` (`prj_F7iBkORwslWKM1TXkTUexfUGsvXw`), deployment `241cca0`:

| Check | Result |
| --- | --- |
| `/api/satellite/config` | `api_configured: false` — **`FRAMEFORGE_API_URL` and `FRAMEFORGE_PROXY_SECRET` not set on Vercel** |
| Supabase `ff_workspace_exports` + `ff-workspace-library` bucket | Present (migration applied) |
| Fly app `frameforge-api-oweb.fly.dev` | **DNS does not resolve** — API host not deployed or not registered |
| Authenticated proxy | `/api/backend/*` returns **503** when `FRAMEFORGE_API_URL` unset; otherwise redirects unauthenticated callers to login |

**Blocker for ONE-205 browser acceptance:** deploy `run.py --satellite` (see `fly.toml` / `Dockerfile`), set matching secrets on Fly + Vercel, redeploy satellite. No mock UI path.

## QA / OneID synthetic tester

Use the **ONE-202 shared fixture contract** only — see [docs/QA_FIXTURE.md](docs/QA_FIXTURE.md). Never post `FF_QA_*` credentials in Linear, GitHub, or agent threads.
