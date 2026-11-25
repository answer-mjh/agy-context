/**
 * Lightweight zero-dependency CJK-aware token estimator and arg unwrapper.
 */

const CJK_RE = /[\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g;

export function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  if (!str) return 0;
  const len = str.length;
  const cjkMatches = str.match(CJK_RE);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = Math.max(0, len - cjkCount);
  // CJK averages ~1.5 chars/token; Latin/code averages ~4 chars/token
  return Math.max(1, Math.round(cjkCount / 1.5 + otherCount / 4));
}

export function estimateMediaTokens(mediaList) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) return 0;
  let total = 0;
  for (const m of mediaList) {
    const mime = String(m?.mime_type || '').toLowerCase();
    if (mime.startsWith('image/')) total += 258; // Gemini standard tile estimate
    else if (mime.startsWith('video/')) total += 1500;
    else if (mime.startsWith('audio/')) total += 600;
    else total += 512;
  }
  return total;
}

/**
 * Antigravity transcripts serialize tool_calls[].args values as JSON strings
 * (e.g. `"\"Get-ChildItem\""` or `"5000"`). Unwrap safely.
 */
export function unwrapArgValue(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function unwrapToolArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    out[k] = unwrapArgValue(v);
  }
  return out;
}

export function countLines(text) {
  if (!text || typeof text !== 'string') return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

/**
 * Extract clean user request from Antigravity's XML-wrapped USER_INPUT content.
 */
export function parseUserInputContent(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const reqMatch = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  const settingsMatch = text.match(/<USER_SETTINGS_CHANGE>\s*([\s\S]*?)\s*<\/USER_SETTINGS_CHANGE>/);
  const cleanText = reqMatch ? reqMatch[1].trim() : text.trim();
  const settingsChange = settingsMatch ? settingsMatch[1].trim() : '';
  return {
    cleanText,
    settingsChange,
    rawText: text,
  };
}
