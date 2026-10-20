# Frameforge — OWeb satellite

`app_id`: **frameforge**  
Activation scope: **workspace**  
Auth host: **https://auth.oweb.one**  
Control plane: **https://oweb.one**

This Vercel deployment is an OWeb constellation satellite. Identity, workspaces, and billing stay on One OS — Frameforge does not operate a second auth or Supabase project.

## Auth flows

| Path | Entry | Notes |
|------|--------|--------|
| Native | `/login` | Email/password against shared Supabase Auth (`ao-supabase-auth` session key) |
| OWeb return | `https://oweb.one/login?launch=frameforge` | App Store mints token → `/sso?launch_token=…` |
| SSO redeem | `/sso` | `POST /api/sso/redeem` → OWeb `POST /api/v1/ecosystem/redeem-launch-token`, then `setSession` |

Post-auth (native or SSO): server resolves workspace context, calls OWeb activation APIs (with RPC fallback), upserts `ff_profiles`, then opens the editor at `/static/index.html` via `/studio`.

## Architecture (generation vs editing)

| Layer | Owner | Role |
| --- | --- | --- |
| **Media generation** | OWeb ONE-190 (Runpod serverless ComfyUI) | Produces playable video/audio assets upstream |
| **Frameforge satellite (this repo, Vercel)** | ONE-205 | OneID shell, workspace activation, static editor UI |
| **Frameforge editing API** | `run.py --satellite` (Fly or other host) | Import, timeline trim, save, export — **not** a GPU ComfyUI runtime |

Runpod/ComfyUI is optional inside the Python host for **generation** features only. The OWeb acceptance path for ONE-205 uses a **synthetic clip** (no paid generation): import → edit → save → export → `ff_workspace_exports` / oDrive handoff (ONE-188).

## Editor API (`run.py --satellite`)

The browser editor calls `/api/*` on the same origin. Next.js proxies those requests through **`/api/backend/*`** (authenticated) to **`FRAMEFORGE_API_URL`** (`run.py --satellite`), attaching workspace context headers. Set matching **`FRAMEFORGE_PROXY_SECRET`** on Vercel and the Python host. Without `FRAMEFORGE_API_URL`, the UI loads after login but library/save/export APIs return `503 api_unavailable`.

Production audit (read-only): `node scripts/audit-production-satellite.mjs`

### Python API on Fly.io (reference)

```sh
fly secrets set FRAMEFORGE_PROXY_SECRET=<same-as-vercel>
fly deploy
```

Point Vercel `FRAMEFORGE_API_URL` at the Fly app URL (`https://frameforge-api-oweb.fly.dev`).

Local development:

```sh
# Terminal 1 — Python API + library
python run.py --port 8787

# Terminal 2 — satellite shell
FRAMEFORGE_API_URL=http://127.0.0.1:8787 npm run dev
```

## Environment

See `.env.example`. Never commit service role keys.

## Schema

Apply `supabase/migrations/20261018130000_ff_profiles_isolation.sql` on the shared One OS project.

## Control-plane registration (separate PR)

Register `frameforge` in OWeb `ecosystem-apps.ts` with `activationScope: "workspace"` and production `launchUrl` before marking the app live in the App Store.

Canonical contracts: OneWeb-LLC/oweb `docs/SATELLITE_ONBOARDING_KIT.md`, `docs/SATELLITE_AUTH_RETURN.md`.
