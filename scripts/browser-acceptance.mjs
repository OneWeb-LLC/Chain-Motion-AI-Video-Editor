/**
 * ONE-205 browser acceptance (reads credentials from FF_QA_CREDS_FILE only).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const base =
  process.env.FRAMEFORGE_SATELLITE_URL ||
  'https://chain-motion-ai-video-editor-oweb.vercel.app';
const credPath = process.env.FF_QA_CREDS_FILE || '/tmp/ff-qa.local.json';
const { email, password } = JSON.parse(readFileSync(credPath, 'utf8'));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const results = { steps: [] };

try {
  await page.goto(`${base}/login?next=/studio`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await page.waitForURL(/\/static\/index\.html/, { timeout: 90000 });
  await page.waitForLoadState('networkidle');
  results.steps.push({ login: 'ok', url: page.url() });

  const cfg = await page.evaluate(async () => {
    const r = await fetch('/api/satellite/config');
    return r.json();
  });
  results.api_configured = cfg.api_configured;

  const stateRes = await page.evaluate(async () => {
    const r = await fetch('/api/state');
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  results.state_http = stateRes.status;
  results.has_projects = Boolean(stateRes.body?.projects);

  const fixture = '/tmp/test-clip.mp4';
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(fixture);
    results.import = 'file_set';
  } else {
    results.import = 'no_file_input';
  }

  await page.waitForTimeout(2000);
  const toastText = await page.locator('.toast, [role="alert"]').allTextContents();
  results.toasts = toastText;
  results.pass =
    cfg.api_configured === true &&
    stateRes.status === 200 &&
    !toastText.some((t) => /not connected|api_unavailable|FRAMEFORGE_API_URL/i.test(t));

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.pass ? 0 : 1);
} catch (e) {
  console.error(JSON.stringify({ error: String(e), results }, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
