/**
 * Minimal Connect-RPC client for Antigravity's language server.
 *
 * The Antigravity App injects ANTIGRAVITY_LS_ADDRESS and
 * ANTIGRAVITY_CSRF_TOKEN into every sidecar process. These are the same
 * loopback endpoints used by the built-in UI and by Antigravity Context
 * Monitor, so no extra ports, patching or discovery files are required.
 */

import http from 'node:http';
import https from 'node:https';
import { parseUserQuotaSummary } from './quota.mjs';

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 2_000;
const QUOTA_CACHE_TTL_MS = 30_000;
const SERVICE_PATH = '/exa.language_server_pb.LanguageServerService';

const responseCache = new Map();
const inFlightMetadata = new Map();
let quotaCache = null;

function positiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function parseLoopbackAddress(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = (url.hostname || '').replace(/^\[|\]$/g, '') || '127.0.0.1';
    const port = url.port
      ? positiveInt(url.port)
      : (url.protocol === 'https:' ? 443 : 80);
    if (!port) return null;
    return {
      hostname,
      port,
      useTls: url.protocol === 'https:',
    };
  } catch {
    return null;
  }
}

export function getLsConnection() {
  const endpoint = parseLoopbackAddress(process.env.ANTIGRAVITY_LS_ADDRESS);
  const csrfToken = typeof process.env.ANTIGRAVITY_CSRF_TOKEN === 'string'
    ? process.env.ANTIGRAVITY_CSRF_TOKEN.trim()
    : '';
  if (!endpoint || !csrfToken) return null;
  return {
    ...endpoint,
    csrfToken,
  };
}

export function getLsStatus() {
  const ls = getLsConnection();
  if (!ls) {
    return { ok: false, reason: 'ANTIGRAVITY_LS_ADDRESS / ANTIGRAVITY_CSRF_TOKEN not available' };
  }
  return {
    ok: true,
    hostname: ls.hostname,
    port: ls.port,
    useTls: ls.useTls,
  };
}

export function clearLsCache() {
  responseCache.clear();
  inFlightMetadata.clear();
  quotaCache = null;
}

/**
 * Call a Connect-RPC endpoint on the local Antigravity language server.
 * The server expects plain JSON for unary calls.
 */
export function rpcCall(endpoint, body = {}, options = {}) {
  const ls = getLsConnection();
  if (!ls) {
    return Promise.reject(new Error('Antigravity language server is not available'));
  }

  const timeoutMs = positiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const signal = options.signal;
  const payload = JSON.stringify(body ?? {});
  const transport = ls.useTls ? https : http;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('RPC aborted'));
      return;
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      fn(value);
    };

    const request = transport.request({
      hostname: ls.hostname,
      port: ls.port,
      path: `${SERVICE_PATH}/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': ls.csrfToken,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      let size = 0;

      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy();
          finish(reject, new Error('RPC response exceeded the size limit'));
          return;
        }
        chunks.push(chunk);
      });

      response.on('error', (error) => finish(reject, error));

      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
          finish(reject, new Error(`RPC HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
          return;
        }
        if (!text.trim()) {
          finish(resolve, {});
          return;
        }
        try {
          finish(resolve, JSON.parse(text));
        } catch {
          finish(reject, new Error(`Failed to parse RPC response: ${text.slice(0, 200)}`));
        }
      });
    });

    request.on('error', (error) => finish(reject, error));
    request.on('timeout', () => {
      request.destroy();
      finish(reject, new Error('RPC timeout'));
    });

    let onAbort = null;
    if (signal) {
      onAbort = () => {
        request.destroy();
        finish(reject, new Error('RPC aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    request.end(payload);
  });
}

/**
 * Fetch GetCascadeTrajectoryGeneratorMetadata with a short in-memory cache.
 * Returns an empty array when the language server is unavailable, so callers
 * can always fall back to transcript-based estimates.
 */
export async function getGeneratorMetadata(cascadeId, options = {}) {
  const id = typeof cascadeId === 'string' ? cascadeId.trim() : '';
  if (!id || !getLsConnection()) return [];

  const ttlMs = positiveInt(options.ttlMs, DEFAULT_CACHE_TTL_MS);
  const now = Date.now();
  const cached = responseCache.get(id);
  if (!options.force && cached && now - cached.at <= ttlMs) {
    return cached.value;
  }
  if (!options.force && inFlightMetadata.has(id)) {
    return inFlightMetadata.get(id);
  }

  const promise = (async () => {
    try {
      const response = await rpcCall('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: id,
        metadata: {
          ideName: 'antigravity',
          extensionName: 'antigravity',
        },
      }, {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
      });
      const value = Array.isArray(response?.generatorMetadata)
        ? response.generatorMetadata.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        : [];
      responseCache.set(id, { at: Date.now(), value });
      return value;
    } catch {
      if (cached) return cached.value;
      return [];
    } finally {
      if (inFlightMetadata.get(id) === promise) {
        inFlightMetadata.delete(id);
      }
    }
  })();

  inFlightMetadata.set(id, promise);
  return promise;
}

/**
 * Fetch dual-window (5h + weekly) quota summary from RetrieveUserQuotaSummary.
 * Caches result for 30s and degrades gracefully to null when unavailable.
 */
export async function getUserQuotaSummary(options = {}) {
  if (!getLsConnection()) return null;

  const ttlMs = positiveInt(options.ttlMs, QUOTA_CACHE_TTL_MS);
  const now = Date.now();
  if (!options.force && quotaCache && now - quotaCache.at <= ttlMs) {
    return quotaCache.value;
  }

  try {
    const response = await rpcCall('RetrieveUserQuotaSummary', {
      metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
      },
    }, {
      timeoutMs: options.timeoutMs ?? 8_000,
      signal: options.signal,
    });
    const parsed = parseUserQuotaSummary(response);
    if (parsed) {
      quotaCache = { at: now, value: parsed };
    }
    return parsed;
  } catch {
    if (quotaCache) return quotaCache.value;
    return null;
  }
}
