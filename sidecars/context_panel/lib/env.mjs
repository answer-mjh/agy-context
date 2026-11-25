import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SIDECAR_ROOT = resolve(__dirname, '..');
export const PLUGIN_ROOT = resolve(SIDECAR_ROOT, '..', '..');

export function resolveAntigravityDir() {
  if (process.env.AGY_CONTEXT_ANTIGRAVITY_DIR) {
    return resolve(process.env.AGY_CONTEXT_ANTIGRAVITY_DIR);
  }
  return join(homedir(), '.gemini', 'antigravity');
}

export function resolveBrainDir() {
  if (process.env.AGY_CONTEXT_BRAIN_DIR) {
    return resolve(process.env.AGY_CONTEXT_BRAIN_DIR);
  }
  return join(resolveAntigravityDir(), 'brain');
}

export function resolveSummariesDbPath() {
  return join(resolveAntigravityDir(), 'conversation_summaries.db');
}

export function resolveDataDir() {
  const dir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
    ? resolve(process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR)
    : join(resolveAntigravityDir(), 'sidecar_data', 'agy-context_context_panel', 'data');
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Fallback handled by callers if read-only
  }
  return dir;
}

export function isPathInside(baseDir, targetPath) {
  const base = normalize(resolve(baseDir));
  const target = normalize(resolve(targetPath));
  const rel = relative(base, target);
  return rel !== '' && !rel.startsWith('..') && !rel.includes(':' + '\\') && resolve(base, rel) === target;
}

export function formatLocalDateKey(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toMillis(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}
