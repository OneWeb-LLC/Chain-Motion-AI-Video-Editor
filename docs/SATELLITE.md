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

## Editor API (ComfyUI backend)

The browser editor calls `/api/*` on the same origin. On Vercel, set **`FRAMEFORGE_API_URL`** to a reachable Frameforge Python service (`run.py`) so Next.js can rewrite `/api/*` to that host. Without it, the UI loads after login but generation and library APIs are unavailable.

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
