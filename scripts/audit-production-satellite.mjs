/**
 * Read-only production readiness audit for the Frameforge OWeb satellite.
 * Never prints secret values; only reports presence/absence and public config.
 */
const DEFAULT_URL =
  process.env.FRAMEFORGE_SATELLITE_URL ||
  'https://chain-motion-ai-video-editor-oweb.vercel.app';

const FLY_HOST = process.env.FRAMEFORGE_FLY_HOST || 'frameforge-api-oweb.fly.dev';

async function probe(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal, redirect: 'manual' });
    return { ok: true, status: res.status, headers: res.headers };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err?.cause?.code || err?.message) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const base = DEFAULT_URL.replace(/\/$/, '');
  const report = {
    checked_at: new Date().toISOString(),
    satellite_url: base,
    deployment: {},
    editor_api: {},
    blockers: [],
  };

  const cfgRes = await fetch(`${base}/api/satellite/config`);
  report.deployment.config_http = cfgRes.status;
  if (!cfgRes.ok) {
    report.blockers.push(`satellite_config_http_${cfgRes.status}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const cfg = await cfgRes.json();
  report.deployment = {
    app_id: cfg.app_id,
    mode: cfg.mode,
    auth_required: cfg.auth_required,
    api_configured: cfg.api_configured,
    app_url: cfg.app_url,
  };

  if (!cfg.api_configured) {
    report.blockers.push('vercel_missing_FRAMEFORGE_API_URL');
  }

  const fly = await probe(`https://${FLY_HOST}/api/state`, {
    method: 'GET',
    headers: { 'X-FF-Proxy-Secret': 'audit-probe-not-a-real-secret' },
  });
  report.editor_api.fly_host = FLY_HOST;
  if (!fly.ok) {
    report.editor_api.fly_reachable = false;
    report.editor_api.fly_error = fly.error;
    report.blockers.push('fly_app_dns_or_network_unreachable');
  } else {
    report.editor_api.fly_reachable = true;
    report.editor_api.fly_http = fly.status;
    if (fly.status === 401) {
      report.editor_api.fly_satellite_mode = 'responding_requires_proxy_secret';
    } else if (fly.status === 503 || fly.status === 404) {
      report.blockers.push(`fly_unexpected_http_${fly.status}`);
    }
  }

  const proxy = await probe(`${base}/api/backend/state`);
  report.editor_api.satellite_proxy_http = proxy.ok ? proxy.status : null;
  if (proxy.ok && proxy.status === 503) {
    report.blockers.push('satellite_proxy_api_unavailable');
  }
  if (proxy.ok && (proxy.status === 307 || proxy.status === 302)) {
    report.editor_api.satellite_proxy_redirects_to_login = true;
  }

  const unique = [...new Set(report.blockers)];
  report.blockers = unique;
  report.ready_for_editor_journey = unique.length === 0;

  console.log(JSON.stringify(report, null, 2));
  process.exit(unique.length ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
