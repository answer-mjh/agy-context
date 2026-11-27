import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from './env.mjs';

export const DEFAULT_PREFS = Object.freeze({
  lang: 'zh',
  insightsRange: '30d',
  insightsSort: 'recent',
  timelineGranularity: 'step',
  timelineMode: 'total',
  browserBaseline: 'prev_turn',
  fleetTab: 'show',
  filesSort: 'ops',
  toolsSort: 'count',
});

const ALLOWED_ENUMS = {
  lang: new Set(['zh', 'en']),
  insightsRange: new Set(['today', 'weekly_quota', '7d', '30d', 'all']),
  insightsSort: new Set(['recent', 'tokens', 'context', 'cost']),
  timelineGranularity: new Set(['step', 'turn']),
  timelineMode: new Set(['total', 'delta', 'overview']),
  browserBaseline: new Set(['prev_turn', 'prev_step']),
  fleetTab: new Set(['show', 'hide']),
  filesSort: new Set(['ops', 'changes', 'name']),
  toolsSort: new Set(['count', 'tokens', 'name']),
};

function getPrefsPath() {
  return join(resolveDataDir(), 'prefs.json');
}

export function sanitizePrefs(raw) {
  const next = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return next;
  for (const [key, allowed] of Object.entries(ALLOWED_ENUMS)) {
    if (typeof raw[key] === 'string' && allowed.has(raw[key])) {
      next[key] = raw[key];
    }
  }
  return next;
}

export function loadPrefs() {
  const filePath = getPrefsPath();
  if (!existsSync(filePath)) {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return sanitizePrefs(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(patch) {
  const current = loadPrefs();
  const merged = sanitizePrefs({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
  const filePath = getPrefsPath();
  const tmpPath = `${filePath}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf8');
    renameSync(tmpPath, filePath);
  } catch {
    try {
      writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
    } catch {
      // ignore if data dir is read-only
    }
  }
  return merged;
}
