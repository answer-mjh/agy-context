import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { isPathInside, resolveBrainDir, SIDECAR_ROOT } from './env.mjs';
import { FleetStore } from './fleet.mjs';
import { loadPrefs, savePrefs } from './prefs.mjs';
import { ProjectionStore } from './projection.mjs';
import { SessionDetailStore } from './session-detail.mjs';

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const WEB_ROOT = join(SIDECAR_ROOT, 'web');

// Allowlisted static web assets for SidecarApp exact-path registration
export const STATIC_WEB_PATHS = [
  '/styles/theme.css',
  '/styles/app.css',
  '/js/i18n.js',
  '/js/host-bridge.js',
  '/js/charts.js',
  '/js/views/insights.js',
  '/js/views/fleet.js',
  '/js/views/stats.js',
  '/js/views/timeline.js',
  '/js/views/browser.js',
  '/js/views/events.js',
  '/js/views/files.js',
  '/js/views/commands.js',
  '/js/views/settings.js',
  '/js/main.js',
];

function computeEtag(payload) {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20);
  return `"${hash}"`;
}

function normalizeQuery(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) out[k] = v[0];
    else if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

export function createRouter({ version = '0.1.0' } = {}) {
  const projectionStore = new ProjectionStore();
  const detailStore = new SessionDetailStore();
  const fleetStore = new FleetStore(projectionStore, detailStore);

  function renderHtml(viewMode) {
    const htmlPath = join(WEB_ROOT, 'index.html');
    let html = readFileSync(htmlPath, 'utf8');
    const cssParts = ['/styles/theme.css', '/styles/app.css'].map(rel =>
      readFileSync(resolve(WEB_ROOT, `.${rel}`), 'utf8')
    );
    const jsFiles = [
      '/js/i18n.js',
      '/js/host-bridge.js',
      '/js/charts.js',
      '/js/views/insights.js',
      '/js/views/fleet.js',
      '/js/views/stats.js',
      '/js/views/timeline.js',
      '/js/views/browser.js',
      '/js/views/events.js',
      '/js/views/files.js',
      '/js/views/commands.js',
      '/js/views/settings.js',
      '/js/main.js',
    ];
    const jsParts = jsFiles.map(rel =>
      `/* ${rel} */\n` + readFileSync(resolve(WEB_ROOT, `.${rel}`), 'utf8').replace(/<\/script/gi, '<\\/script')
    );
    html = html
      .replace('__INLINE_CSS__', () => cssParts.join('\n'))
      .replace('__INLINE_JS__', () => jsParts.join('\n;\n'))
      .replace(/__AGY_VIEW_MODE__/g, viewMode)
      .replace(/__AGY_VERSION__/g, version);
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
      headers: { 'Cache-Control': 'no-cache' },
    };
  }

  function serveStaticAsset(reqPath) {
    if (!STATIC_WEB_PATHS.includes(reqPath)) {
      return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'Not Found' };
    }
    const target = resolve(WEB_ROOT, `.${reqPath}`);
    if (!isPathInside(WEB_ROOT, target) || !existsSync(target)) {
      return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'Not Found' };
    }
    const ext = extname(target).toLowerCase();
    return {
      status: 200,
      contentType: MIME_BY_EXT[ext] || 'application/octet-stream',
      body: readFileSync(target, 'utf8'),
      headers: { 'Cache-Control': 'no-cache' },
    };
  }

  async function handleHealth() {
    const sessions = await projectionStore.listSessions();
    return {
      status: 200,
      body: {
        ok: true,
        name: 'agy-context',
        version,
        sessionsCount: sessions.length,
        latestSessionId: sessions[0]?.id || null,
        timestamp: Date.now(),
      },
    };
  }

  async function handleInsights(rawQuery) {
    const q = normalizeQuery(rawQuery);
    const data = await projectionStore.getInsights(q);
    const etag = computeEtag({
      generatedAtBucket: Math.floor(data.generatedAt / 5000),
      kpi: data.kpi,
      sessions: data.sessions.map(s => [s.id, s.lastMs, s.billableTokens]),
      range: data.range,
      selectedDay: data.selectedDay,
    });
    return {
      status: 200,
      body: data,
      headers: { ETag: etag, 'Cache-Control': 'no-cache' },
    };
  }

  function mapSessionOptions(sessions) {
    return (sessions || []).map(s => ({
      id: s.id,
      title: s.title,
      workspaceName: s.workspaceName,
      lastMs: s.lastMs,
      latestModelLabel: s.latestModelLabel,
      windowUsagePct: s.windowUsagePct,
      billableTokens: s.totalBillableTokens,
    }));
  }

  async function handleSession(rawQuery) {
    const q = normalizeQuery(rawQuery);
    const sessions = await projectionStore.listSessions();
    const sessionOptions = mapSessionOptions(sessions);
    const convId = (q.id || '').trim();
    if (!convId) {
      return {
        status: 200,
        body: {
          empty: true,
          reason: 'missing_conversation_id',
          sessions: sessionOptions,
          fleet: null,
          session: null,
        },
      };
    }

    const meta = sessions.find(s => s.id === convId) || null;
    const stepSeq = q.step !== undefined && q.step !== '' ? Number(q.step) : -1;
    const [overview, fleetSummary] = await Promise.all([
      detailStore.getOverview(convId, meta, Number.isFinite(stepSeq) ? stepSeq : -1),
      fleetStore.getSummary(convId).catch(() => null),
    ]);

    if (!overview) {
      return {
        status: 200,
        body: {
          empty: true,
          reason: 'no_transcript_yet',
          id: convId,
          sessions: sessionOptions,
          fleet: null,
          session: null,
        },
      };
    }

    return {
      status: 200,
      body: {
        empty: false,
        sessions: sessionOptions,
        fleet: fleetSummary,
        session: overview,
      },
    };
  }

  async function handleFleet(rawQuery) {
    const q = normalizeQuery(rawQuery);
    const sessions = await projectionStore.listSessions();
    const sessionOptions = mapSessionOptions(sessions);
    const convId = (q.id || '').trim();
    if (!convId) {
      return {
        status: 200,
        body: {
          empty: true,
          reason: 'missing_conversation_id',
          sessions: sessionOptions,
          agents: [],
          edges: [],
          tasks: [],
          timeline: [],
          summary: null,
        },
      };
    }
    const data = await fleetStore.getFleet(convId);
    if (!data) {
      return {
        status: 200,
        body: {
          empty: true,
          reason: 'no_transcript_yet',
          id: convId,
          sessions: sessionOptions,
          agents: [],
          edges: [],
          tasks: [],
          timeline: [],
          summary: null,
        },
      };
    }
    return {
      status: 200,
      body: {
        empty: false,
        sessions: sessionOptions,
        ...data,
      },
    };
  }

  async function handleStep(rawQuery) {
    const q = normalizeQuery(rawQuery);
    const convId = (q.id || '').trim();
    if (!convId) {
      return { status: 200, body: { empty: true, reason: 'missing_conversation_id', categories: [], dna: { ribbon: [], list: [], totalTokens: 0 } } };
    }
    const sessions = await projectionStore.listSessions();
    const meta = sessions.find(s => s.id === convId) || null;
    const seq = q.step !== undefined && q.step !== '' ? Number(q.step) : -1;
    const baseline = q.baseline === 'prev_step' ? 'prev_step' : 'prev_turn';
    const data = await detailStore.getStepBrowser(convId, meta, Number.isFinite(seq) ? seq : -1, baseline);
    if (!data) {
      return { status: 200, body: { empty: true, reason: 'no_transcript_yet', id: convId, categories: [], dna: { ribbon: [], list: [], totalTokens: 0 } } };
    }
    return { status: 200, body: data };
  }

  function handleAttachment(rawQuery) {
    const q = normalizeQuery(rawQuery);
    const convId = q.id || '';
    const relPath = q.path || '';
    if (!convId || !relPath || /[/\\]\.\.[/\\]/.test(relPath)) {
      return { status: 400, contentType: 'text/plain; charset=utf-8', body: 'Invalid attachment parameters' };
    }
    const brainDir = resolveBrainDir();
    const convDir = join(brainDir, convId);
    const target = resolve(convDir, relPath);
    if (!isPathInside(convDir, target) || !existsSync(target)) {
      return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'Attachment not found' };
    }
    const ext = extname(target).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    if (!mime.startsWith('image/')) {
      return { status: 403, contentType: 'text/plain; charset=utf-8', body: 'Only image previews are served' };
    }
    return {
      status: 200,
      contentType: mime,
      body: readFileSync(target),
      headers: { 'Cache-Control': 'private, max-age=300' },
    };
  }

  function handleGetPrefs() {
    return { status: 200, body: loadPrefs() };
  }

  function handleSavePrefs(payload) {
    const saved = savePrefs(payload);
    return { status: 200, body: saved };
  }

  return {
    renderHtml,
    serveStaticAsset,
    handleHealth,
    handleInsights,
    handleSession,
    handleFleet,
    handleStep,
    handleAttachment,
    handleGetPrefs,
    handleSavePrefs,
  };
}

/**
 * Standalone loopback HTTP server for local browser preview and automated tests.
 */
export async function startStandaloneServer(router, { port = 17846, host = '127.0.0.1' } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${host}:${port}`);
      const pathname = urlObj.pathname;
      const query = Object.fromEntries(urlObj.searchParams.entries());

      if (pathname === '/' || pathname === '/aux') {
        const out = router.renderHtml('aux');
        res.writeHead(out.status, { 'Content-Type': out.contentType, ...(out.headers || {}) });
        res.end(out.body);
        return;
      }

      if (pathname === '/preload.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end('/* standalone noop preload */');
        return;
      }

      if (pathname === '/full') {
        const out = router.renderHtml('sidebar');
        res.writeHead(out.status, { 'Content-Type': out.contentType, ...(out.headers || {}) });
        res.end(out.body);
        return;
      }

      if (STATIC_WEB_PATHS.includes(pathname)) {
        const out = router.serveStaticAsset(pathname);
        res.writeHead(out.status, { 'Content-Type': out.contentType, ...(out.headers || {}) });
        res.end(out.body);
        return;
      }

      if (pathname === '/api/health') {
        const out = await router.handleHealth();
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out.body));
        return;
      }

      if (pathname === '/api/insights') {
        const out = await router.handleInsights(query);
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', ...(out.headers || {}) });
        res.end(JSON.stringify(out.body));
        return;
      }

      if (pathname === '/api/session') {
        const out = await router.handleSession(query);
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out.body));
        return;
      }

      if (pathname === '/api/fleet') {
        const out = await router.handleFleet(query);
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out.body));
        return;
      }

      if (pathname === '/api/step') {
        const out = await router.handleStep(query);
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out.body));
        return;
      }

      if (pathname === '/api/attachment') {
        const out = router.handleAttachment(query);
        res.writeHead(out.status, { 'Content-Type': out.contentType, ...(out.headers || {}) });
        res.end(out.body);
        return;
      }

      if (pathname === '/api/prefs' && req.method === 'GET') {
        const out = router.handleGetPrefs();
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out.body));
        return;
      }

      if (pathname === '/api/prefs' && req.method === 'POST') {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 64 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Payload too large' }));
            return;
          }
          chunks.push(chunk);
        }
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          body = {};
        }
        const out = router.handleSavePrefs(body);
        res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out.body));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => resolveListen());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () => new Promise(res => server.close(() => res())),
  };
}
