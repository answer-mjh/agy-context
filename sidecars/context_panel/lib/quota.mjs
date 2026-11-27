/**
 * Weekly quota parsing and window resolution for Antigravity's
 * `RetrieveUserQuotaSummary` language server RPC.
 */

export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const DISTINCT_RESET_TOLERANCE_MS = 5 * 60 * 1000;

const STRICT_ISO_RESET_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

/**
 * Parse a strict ISO-8601 / RFC 3339 reset timestamp with explicit timezone
 * and real calendar-date round-trip validation.
 * Returns epoch ms (including `0` for epoch-0 untouched markers), or `null`
 * when missing or malformed.
 */
export function parseStrictResetTimestamp(raw) {
  const reset = typeof raw === 'string' ? raw.trim() : '';
  if (!reset || !STRICT_ISO_RESET_TIMESTAMP_RE.test(reset)) {
    return null;
  }
  const day = reset.slice(0, 10);
  const calendarDate = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) {
    return null;
  }
  const parsed = Date.parse(reset);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map a model ID or label into a canonical quota pool key.
 */
export function inferModelQuotaPool(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) return 'other';
  if (/(?:claude|anthropic|gpt|openai|\bo[134]\b|codex|opus|sonnet|haiku)/i.test(id)) {
    return 'premium';
  }
  if (/(?:gemini|gemma|neon|hydrogen|carbon|argon)/i.test(id)) {
    return 'gemini';
  }
  return 'other';
}

function parseWindowResetTimestamp(raw) {
  if (typeof raw !== 'string') {
    return { resetTime: null, resetAt: null, parsedMs: null };
  }
  const reset = raw.trim();
  const parsedMs = parseStrictResetTimestamp(reset);
  if (parsedMs === null || parsedMs <= 0) {
    return { resetTime: null, resetAt: null, parsedMs };
  }
  return { resetTime: reset, resetAt: parsedMs, parsedMs };
}

function parseQuotaWindowRemaining(bucket, parsedResetMs) {
  if (bucket.remainingFraction != null) {
    const raw =
      typeof bucket.remainingFraction === 'string' && bucket.remainingFraction.trim() !== ''
        ? Number(bucket.remainingFraction)
        : bucket.remainingFraction;
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
  }
  // Proto3 omits float 0.0: untouched quota has no/epoch resetTime -> 1.0,
  // exhausted quota has a valid future/non-epoch resetTime -> 0.0.
  if (bucket.resetTime == null) return 1;
  if (typeof bucket.resetTime !== 'string') return null;
  if (!bucket.resetTime.trim()) return 1;
  if (parsedResetMs === null || parsedResetMs < 0) return null;
  return parsedResetMs === 0 ? 1 : 0;
}

function inferQuotaSummaryPool(displayName, buckets) {
  const ids = buckets.map(b => b.bucketId.toLowerCase());
  if (ids.some(id => id.startsWith('gemini')) || /\bgemini\b/i.test(displayName)) {
    return 'gemini';
  }
  if (
    ids.some(id => id.startsWith('3p') || id.startsWith('claude') || id.startsWith('gpt')) ||
    /\b(?:claude|gpt)\b/i.test(displayName)
  ) {
    return 'premium';
  }
  return 'other';
}

/**
 * Parse `RetrieveUserQuotaSummary` response into normalized dual-window pool summaries.
 */
export function parseUserQuotaSummary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const payload =
    raw.response && typeof raw.response === 'object' && !Array.isArray(raw.response)
      ? raw.response
      : raw;
  const rawGroups = Array.isArray(payload.groups) ? payload.groups : [];
  const groups = [];

  for (const item of rawGroups) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : '';
    const description =
      typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : undefined;
    const rawBuckets = Array.isArray(item.buckets) ? item.buckets : [];
    const buckets = [];

    for (const b of rawBuckets) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      const bucketId = typeof b.bucketId === 'string' ? b.bucketId.trim() : '';
      const rawWindow = typeof b.window === 'string' ? b.window.trim().toLowerCase() : '';
      const window =
        rawWindow ||
        (bucketId.toLowerCase().endsWith('-weekly')
          ? 'weekly'
          : bucketId.toLowerCase().endsWith('-5h')
            ? '5h'
            : '');
      if (!bucketId && !window) continue;

      const { resetTime, resetAt, parsedMs } = parseWindowResetTimestamp(b.resetTime);
      const remainingFraction = parseQuotaWindowRemaining(b, parsedMs);
      const bucketDisplayName = typeof b.displayName === 'string' ? b.displayName.trim() : '';
      const bucketDescription =
        typeof b.description === 'string' && b.description.trim() ? b.description.trim() : undefined;

      const entry = {
        bucketId,
        window,
        displayName: bucketDisplayName || window || bucketId,
        ...(bucketDescription ? { description: bucketDescription } : {}),
        remainingFraction,
        resetTime,
        resetAt,
      };
      if (window === 'weekly' && resetAt > 0) {
        entry.cycleStartMs = resetAt - WEEKLY_WINDOW_MS;
        entry.cycleEndMs = resetAt;
      }
      buckets.push(entry);
    }

    if (!displayName && buckets.length === 0) continue;
    const pool = inferQuotaSummaryPool(displayName, buckets);
    const fiveHour = buckets.find(b => b.window === '5h');
    const weekly = buckets.find(b => b.window === 'weekly');

    groups.push({
      pool,
      displayName:
        displayName ||
        (pool === 'gemini'
          ? 'Gemini Models'
          : pool === 'premium'
            ? 'Claude and GPT models'
            : 'Models'),
      ...(description ? { description } : {}),
      ...(fiveHour ? { fiveHour } : {}),
      ...(weekly ? { weekly } : {}),
      buckets,
    });
  }

  if (groups.length === 0) return null;
  const description =
    typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : undefined;
  return { groups, ...(description ? { description } : {}) };
}

/**
 * Compute local calendar week [Monday 00:00:00.000, +7 days) as fallback window.
 */
export function getCalendarWeekWindow(nowMs = Date.now()) {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  const dayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOffset);
  const cycleStartMs = d.getTime();
  return {
    cycleStartMs,
    cycleEndMs: cycleStartMs + WEEKLY_WINDOW_MS,
  };
}

function poolDisplayLabel(pool, fallbackName) {
  if (pool === 'gemini') return 'Gemini';
  if (pool === 'premium') return 'Claude / GPT';
  return fallbackName || 'Models';
}

/**
 * Resolve weekly quota pool states and active cycle boundaries from `parseUserQuotaSummary` output.
 */
export function resolveWeeklyQuotaWindow(quotaSummary, requestedPool = 'all', nowMs = Date.now()) {
  const selectedPool = requestedPool === 'gemini' || requestedPool === 'premium' ? requestedPool : 'all';
  const poolMap = new Map();

  for (const group of quotaSummary?.groups || []) {
    const pool = group.pool || 'other';
    const weekly = group.weekly || null;
    const fiveHour = group.fiveHour || null;
    const prev = poolMap.get(pool);

    const remainingFraction = weekly?.remainingFraction ?? prev?.remainingFraction ?? null;
    const resetAt = weekly?.resetAt ?? prev?.resetAt ?? null;
    const resetTime = weekly?.resetTime ?? prev?.resetTime ?? null;
    const cycleStartMs =
      weekly?.cycleStartMs ?? (resetAt > 0 ? resetAt - WEEKLY_WINDOW_MS : prev?.cycleStartMs ?? null);
    const cycleEndMs = weekly?.cycleEndMs ?? (resetAt > 0 ? resetAt : prev?.cycleEndMs ?? null);
    const fiveHourRemainingFraction =
      fiveHour?.remainingFraction ?? (prev?.fiveHourRemainingPct != null ? prev.fiveHourRemainingPct / 100 : null);
    const fiveHourResetAt = fiveHour?.resetAt ?? prev?.fiveHourResetAt ?? null;

    poolMap.set(pool, {
      pool,
      label: prev?.label || poolDisplayLabel(pool, group.displayName),
      remainingFraction,
      remainingPct: remainingFraction != null ? Math.round(remainingFraction * 100) : null,
      resetAt,
      resetTime,
      cycleStartMs,
      cycleEndMs,
      fiveHourRemainingPct: fiveHourRemainingFraction != null ? Math.round(fiveHourRemainingFraction * 100) : null,
      fiveHourResetAt,
    });
  }

  const pools = [...poolMap.values()];
  const futurePools = pools.filter(p => p.resetAt && p.resetAt > nowMs);
  const recentPools = pools.filter(p => p.resetAt && p.resetAt > nowMs - WEEKLY_WINDOW_MS);
  const activePools = futurePools.length > 0 ? futurePools : recentPools;

  let hasDistinctResets = false;
  if (activePools.length >= 2) {
    const resets = activePools.map(p => p.resetAt);
    hasDistinctResets = Math.max(...resets) - Math.min(...resets) > DISTINCT_RESET_TOLERANCE_MS;
  }

  const poolWindows = {};
  for (const p of activePools) {
    if (p.cycleStartMs && p.cycleEndMs) {
      poolWindows[p.pool] = {
        cycleStartMs: p.cycleStartMs,
        cycleEndMs: p.cycleEndMs,
      };
    }
  }

  let source = 'fallback_calendar_week';
  let cycleStartMs;
  let cycleEndMs;
  let resetAt = null;
  let resetTime = null;
  let untouched = false;

  if (selectedPool !== 'all') {
    const matchingPool = poolMap.get(selectedPool) || null;
    if (matchingPool && matchingPool.cycleStartMs && matchingPool.cycleEndMs) {
      source = 'official';
      cycleStartMs = matchingPool.cycleStartMs;
      cycleEndMs = matchingPool.cycleEndMs;
      resetAt = matchingPool.resetAt;
      resetTime = matchingPool.resetTime;
    } else {
      const cal = getCalendarWeekWindow(nowMs);
      source = matchingPool ? 'official' : 'fallback_calendar_week';
      cycleStartMs = cal.cycleStartMs;
      cycleEndMs = cal.cycleEndMs;
      untouched = Boolean(matchingPool && matchingPool.remainingFraction === 1 && !matchingPool.resetAt);
    }
  } else if (activePools.length > 0) {
    source = 'official';
    cycleStartMs = Math.min(...activePools.map(p => p.cycleStartMs));
    cycleEndMs = Math.max(...activePools.map(p => p.cycleEndMs));
    resetAt = hasDistinctResets ? null : activePools[0].resetAt;
    resetTime = hasDistinctResets ? null : activePools[0].resetTime;
  } else {
    const cal = getCalendarWeekWindow(nowMs);
    source = 'fallback_calendar_week';
    cycleStartMs = cal.cycleStartMs;
    cycleEndMs = cal.cycleEndMs;
  }

  return {
    source,
    selectedPool,
    cycleStartMs,
    cycleEndMs,
    resetAt,
    resetTime,
    hasDistinctResets,
    untouched,
    pools,
    poolWindows,
  };
}
