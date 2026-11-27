#!/usr/bin/env node
/**
 * Antigravity App native Sidecar entrypoint for `agy-context`.
 *
 * Zero external npm dependencies — runs directly on Antigravity App's bundled
 * Node.js runtime (`"command": "node"`, Node v24+).
 *
 * Supports:
 *   1. Antigravity App Sidecar mode (`ANTIGRAVITY_SIDECAR_WEB_PORT` set)
 *   2. Standalone loopback HTTP mode (`--standalone-port <port>`) for local debugging & testing
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_ROOT } from './lib/env.mjs';
import { createRouter, startStandaloneServer, STATIC_WEB_PATHS } from './lib/router.mjs';

// Suppress noisy experimental warnings (e.g. node:sqlite) cleanly.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const type = typeof args[0] === 'string'
    ? args[0]
    : (args[0] && typeof args[0] === 'object' ? args[0].type : undefined);
  const name = warning && typeof warning === 'object' ? warning.name : undefined;
  if (type === 'ExperimentalWarning' || name === 'ExperimentalWarning') {
    return;
  }
  return originalEmitWarning(warning, ...args);
};

function readPluginVersion() {
  const manifestPath = resolve(PLUGIN_ROOT, 'plugin.json');
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (typeof raw.version === 'string' && raw.version.trim()) {
        return raw.version.trim();
      }
    } catch {
      // ignore
    }
  }
  return '0.1.2';
}

function parseCliArgs(argv) {
  let standalonePort = null;
  let printUrl = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--standalone-port' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isInteger(n) && n >= 0 && n <= 65535) standalonePort = n;
    } else if (arg.startsWith('--standalone-port=')) {
      const n = Number(arg.slice('--standalone-port='.length));
      if (Number.isInteger(n) && n >= 0 && n <= 65535) standalonePort = n;
    } else if (arg === '--print-url') {
      printUrl = true;
    }
  }
  return { standalonePort, printUrl };
}

async function startSidecarMode(router) {
  const { SidecarApp, Response } = await import('sidecar_sdk');
  const app = new SidecarApp();

  app.page('/', async () => {
    const out = router.renderHtml('aux');
    return new Response(out.body, {
      contentType: out.contentType,
      status: out.status,
      headers: out.headers,
    });
  });

  app.page('/full', async () => {
    const out = router.renderHtml('sidebar');
    return new Response(out.body, {
      contentType: out.contentType,
      status: out.status,
      headers: out.headers,
    });
  });

  for (const assetPath of STATIC_WEB_PATHS) {
    app.page(assetPath, async () => {
      const out = router.serveStaticAsset(assetPath);
      return new Response(out.body, {
        contentType: out.contentType,
        status: out.status,
        headers: out.headers,
      });
    });
  }

  const jsonResp = (out) =>
    new Response(JSON.stringify(out.body), {
      contentType: 'application/json; charset=utf-8',
      status: out.status,
      headers: out.headers,
    });

  app.api('/api/health', async () => jsonResp(await router.handleHealth()), 'GET');
  app.api('/api/insights', async (data) => jsonResp(await router.handleInsights(data)), 'GET');
  app.api('/api/session', async (data) => jsonResp(await router.handleSession(data)), 'GET');
  app.api('/api/fleet', async (data) => jsonResp(await router.handleFleet(data)), 'GET');
  app.api('/api/step', async (data) => jsonResp(await router.handleStep(data)), 'GET');
  app.api('/api/prefs', async () => jsonResp(router.handleGetPrefs()), 'GET');
  app.api('/api/prefs', async (data) => jsonResp(router.handleSavePrefs(data)), 'POST');
  app.api('/api/attachment', async (data) => {
    const out = router.handleAttachment(data);
    return new Response(out.body, {
      contentType: out.contentType,
      status: out.status,
      headers: out.headers,
    });
  }, 'GET');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await app.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  await app.run();
}

async function main() {
  const version = readPluginVersion();
  const router = createRouter({ version });
  const { standalonePort, printUrl } = parseCliArgs(process.argv.slice(2));

  const hasSidecarEnv = Boolean(
    process.env.ANTIGRAVITY_SIDECAR_WEB_PORT &&
    process.env.ANTIGRAVITY_LS_ADDRESS &&
    process.env.ANTIGRAVITY_CSRF_TOKEN
  );

  if (standalonePort === null && hasSidecarEnv) {
    await startSidecarMode(router);
  } else {
    const port = standalonePort !== null ? standalonePort : 17846;
    const handle = await startStandaloneServer(router, { port, host: '127.0.0.1' });
    if (printUrl) {
      process.stdout.write(`${handle.url}\n`);
    } else {
      console.log(`[agy-context] standalone listening on ${handle.url}`);
    }
    const shutdown = async () => {
      try { await handle.close(); } catch { /* ignore */ }
      process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
  }
}

main().catch((err) => {
  console.error(`[agy-context] fatal startup error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
