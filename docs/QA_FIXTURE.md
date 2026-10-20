# FrameForge QA — shared fixture contract (ONE-202 / ONE-205)

## Security

- **Never** create or echo QA passwords in Linear, GitHub, or agent transcripts.
- If a credential appears in chat, treat it as **compromised**: rotate in the approved secret store, redact the source comment manually, and do not reuse until rotation is confirmed.

## Approved credentials

Load from the **ONE-202 provisioned shared synthetic tester** secret store (not this repo):

| Variable | Purpose |
| --- | --- |
| `FF_QA_EMAIL` | OneID email on `auth.oweb.one` |
| `FF_QA_PASSWORD` | Rotated password (ops-only) |
| `FF_QA_WORKSPACE_ID` | Optional explicit workspace cookie target |

Agents must **not** invent one-off QA users or post replacement passwords in issues or PRs.

## Isolated run namespace

Per cloud-agent / browser run:

- Dedicated browser context (no shared cookies with other agents).
- Fixture data prefix: `frameforge-qa/<run-id>/` on Python API host (`workspaces/<workspace_id>/` already isolates libraries per tenant).
- Do not attach QA sessions to production customer workspaces.

## Operator checklist (credential exposure)

1. Redact the Linear comment (connector redact may fail — edit manually).
2. Rotate `FF_QA_PASSWORD` in the approved store (Supabase admin or `scripts/create-frameforge-qa-user.sh` with `FF_QA_PASSWORD` set from vault).
3. Confirm sign-in only from the secret store values.
4. Resume ONE-205 browser acceptance.

## Local API testing (no OneID)

`npm run e2e:satellite-api` uses proxy headers and a temp library — no shared QA user required.
