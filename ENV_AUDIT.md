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
