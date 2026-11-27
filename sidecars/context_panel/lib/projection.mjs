import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatLocalDateKey, resolveBrainDir, resolveDataDir, toMillis } from './env.mjs';
import { parseTranscriptFile } from './parser.mjs';
import { getModelSpec } from './pricing.mjs';
import { readConversationMetaMap } from './sqlite-meta.mjs';
import { getGeneratorMetadata } from './ls-rpc.mjs';
import {
  estimateComposition,
  normalizeOutputRatios,
  officialCompositionWithSplit,
  officialFixedTotals,
  parseOfficialContext,
} from './official-context.mjs';

const CACHE_VERSION = 9;

function getCachePath() {
  const live = Boolean(process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN);
  return join(resolveDataDir(), `projection-cache-v${CACHE_VERSION}-${live ? 'live' : 'local'}.json`);
}

/**
 * Build a lightweight projection summary for a single conversation from transcript.jsonl.
 * Keeps cache tiny (no raw message bodies) while capturing exact daily ledgers,
 * skill/tool/command counts, composition snapshot, and latest context size.
 */
async function buildConversationProjection(convId, transcriptPath, meta) {
  const parsed = parseTranscriptFile(transcriptPath, { keepFullText: false });
  if (!parsed) return null;
  const officialRaw = await getGeneratorMetadata(convId);
  const transcriptModel = [...parsed.steps].reverse()
    .find(step => step.type === 'PLANNER_RESPONSE' && step.model)?.model || '';
  const official = parseOfficialContext(officialRaw, { modelId: transcriptModel });

  const daily = {}; // dateKey -> { inputTokens, cacheReadTokens, outputTokens, billableTokens, cost, requests, turnsSet, toolCalls }
  const skills = {}; // skillName -> { count, lastUsedMs }
  const tools = {}; // toolName -> { count, lastUsedMs }
  const commands = {}; // program -> { count, failed, lastUsedMs }
  const models = new Set();

  // Running visible context estimates for latest composition snapshot
  const cum = {
    user: 0,
    injected: 0,
    skills: 0,
    thinking: 0,
    assistant: 0,
    tools: 0,
    toolCall: 0,
    toolResult: 0,
    media: 0,
    other: 0,
  };

  let firstMs = 0;
  let lastMs = 0;
  let totalInput = 0;
  let totalCacheRead = 0;
  let totalOutput = 0;
  let totalCost = 0;
  let totalRequests = 0;
  let totalToolCalls = 0;
  let totalToolDurationMs = 0;
  let totalModelDurationMs = 0;
  let totalStreamingMs = 0;
  let totalStreamingOutputTokens = 0;
  let totalTtftMs = 0;
  let ttftSamples = 0;
  let totalOverheadMs = 0;
  let turnsCount = 0;
  let firstUserTitle = '';
  let latestPromptTokens = 0;
  let latestModel = '';
  let latestWindow = 0;
  let prevStepMs = 0;
  let prevStepType = '';
  let responseThinkingEst = 0;
  let responseAnswerEst = 0;
  let responseToolEst = 0;
  let lastPlannerStepIndex = -1;
  let lastCheckpointStepIndex = -1;

  // Track cumulative billable category weights for Insights donut
  const billableBuckets = {
    systemBase: 0,
    toolDefs: 0,
    user: 0,
    injected: 0,
    skills: 0,
    thinking: 0,
    assistant: 0,
    tools: 0,
    media: 0,
    other: 0,
  };

  const ensureDay = (dk) => {
    if (!dk) return null;
    if (!daily[dk]) {
      daily[dk] = {
        date: dk,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        billableTokens: 0,
        cost: 0,
        requests: 0,
        turns: 0,
        toolCalls: 0,
      };
    }
    return daily[dk];
  };

  const seenTurnDays = new Set();

  for (let idx = 0; idx < parsed.steps.length; idx++) {
    const s = parsed.steps[idx];
    if (s.createdMs > 0) {
      if (!firstMs || s.createdMs < firstMs) firstMs = s.createdMs;
      if (s.createdMs > lastMs) lastMs = s.createdMs;
    }

    if (s.type === 'USER_INPUT') {
      turnsCount++;
      if (!firstUserTitle && s.cleanText) {
        firstUserTitle = s.cleanText.replace(/\s+/g, ' ').slice(0, 72);
      }
      cum.user += Math.max(0, (s.tokensEst || 0) - (s.mediaTokensEst || 0));
      cum.media += s.mediaTokensEst || 0;
      const dayEntry = ensureDay(s.dateKey);
      if (dayEntry) {
        const turnKey = `${s.dateKey}:${s.turnIndex}`;
        if (!seenTurnDays.has(turnKey)) {
          seenTurnDays.add(turnKey);
          dayEntry.turns++;
        }
      }
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'SYSTEM_MESSAGE' || s.type === 'ERROR_MESSAGE') {
      cum.injected += s.tokensEst || 0;
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'CHECKPOINT') {
      lastCheckpointStepIndex = Math.max(lastCheckpointStepIndex, s.stepIndex);
      totalRequests++;
      if (s.model) {
        models.add(s.model);
        latestModel = s.model;
      }
      totalInput += s.inputTokens;
      totalCacheRead += s.cacheReadTokens;
      totalOutput += s.outputTokens;
      totalCost += s.cost;

      for (const key of Object.keys(cum)) cum[key] = 0;
      const checkpointTokens = s.tokensEst || 0;
      cum.injected += checkpointTokens;
      latestPromptTokens = checkpointTokens;

      const dayEntry = ensureDay(s.dateKey);
      if (dayEntry) {
        dayEntry.inputTokens += s.inputTokens;
        dayEntry.cacheReadTokens += s.cacheReadTokens;
        dayEntry.outputTokens += s.outputTokens;
        dayEntry.billableTokens += s.totalBillableTokens;
        dayEntry.cost += s.cost;
        dayEntry.requests++;
      }

      billableBuckets.injected += s.totalPromptTokens;
      billableBuckets.assistant += s.outputTokens;
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'PLANNER_RESPONSE') {
      lastPlannerStepIndex = Math.max(lastPlannerStepIndex, s.stepIndex);
      totalRequests++;
      if (s.model) {
        models.add(s.model);
        latestModel = s.model;
        latestWindow = s.contextWindow || latestWindow;
      }

      totalInput += s.inputTokens;
      totalCacheRead += s.cacheReadTokens;
      totalOutput += s.outputTokens;
      totalCost += s.cost;
      if (s.totalPromptTokens > 0) {
        latestPromptTokens = s.totalPromptTokens;
      }

      // Prefer official streamingDuration + timeToFirstToken from language server.
      // When unavailable, estimate from next runtime step ONLY (never human idle before USER_INPUT).
      let modelDurMs = 0;
      let stepStreamingMs = 0;
      let stepTtftMs = 0;
      const officialTiming = official?.timing?.byStep?.get(s.stepIndex) || null;
      if (officialTiming && officialTiming.totalMs > 0) {
        modelDurMs = officialTiming.totalMs;
        stepStreamingMs = officialTiming.streamingMs;
        stepTtftMs = officialTiming.ttftMs;
      } else {
        const nextStep = parsed.steps[idx + 1];
        if (
          nextStep &&
          nextStep.type !== 'USER_INPUT' &&
          nextStep.createdMs > s.createdMs &&
          nextStep.createdMs - s.createdMs < 180_000
        ) {
          modelDurMs = nextStep.createdMs - s.createdMs;
        } else if (
          prevStepMs > 0 &&
          (prevStepType === 'USER_INPUT' || prevStepType === 'GENERIC') &&
          s.createdMs > prevStepMs &&
          s.createdMs - prevStepMs < 60_000
        ) {
          modelDurMs = s.createdMs - prevStepMs;
        }
      }
      totalModelDurationMs += modelDurMs;
      if (stepStreamingMs > 0 && s.outputTokens > 0) {
        totalStreamingMs += stepStreamingMs;
        totalStreamingOutputTokens += s.outputTokens;
      }
      if (stepTtftMs > 0) {
        totalTtftMs += stepTtftMs;
        ttftSamples++;
      }
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;

      responseThinkingEst += s.thinkingTokensEst || 0;
      responseAnswerEst += s.answerTokensEst || 0;
      responseToolEst += s.toolCallTokensEst || 0;

      // Prompt composition is measured from the official fixed sections when
      // available; response output is split by transcript estimates.
      const billingComposition = estimateComposition(cum, s.totalPromptTokens, official).composition;
      for (const key of Object.keys(billableBuckets)) {
        billableBuckets[key] += billingComposition[key] || 0;
      }
      const outputSplit = normalizeOutputRatios({
        thinking: s.thinkingTokensEst,
        answer: s.answerTokensEst,
        tool: s.toolCallTokensEst,
      });
      billableBuckets.thinking += Math.round(s.outputTokens * outputSplit.thinking);
      billableBuckets.assistant += Math.round(s.outputTokens * outputSplit.answer);
      billableBuckets.tools += Math.round(s.outputTokens * outputSplit.tool);

      // Update cumulative visible history with this response
      cum.thinking += s.thinkingTokensEst || 0;
      cum.assistant += s.answerTokensEst || 0;
      cum.tools += s.toolCallTokensEst || 0;
      cum.toolCall += s.toolCallTokensEst || 0;

      const dayEntry = ensureDay(s.dateKey);
      if (dayEntry) {
        dayEntry.inputTokens += s.inputTokens;
        dayEntry.cacheReadTokens += s.cacheReadTokens;
        dayEntry.outputTokens += s.outputTokens;
        dayEntry.billableTokens += s.totalBillableTokens;
        dayEntry.cost += s.cost;
        dayEntry.requests++;
      }

      for (const tc of s.toolCalls || []) {
        totalToolCalls++;
        if (!tools[tc.name]) tools[tc.name] = { count: 0, lastUsedMs: 0, daily: {} };
        tools[tc.name].count++;
        tools[tc.name].daily[s.dateKey] = (tools[tc.name].daily[s.dateKey] || 0) + 1;
        if (s.createdMs > tools[tc.name].lastUsedMs) tools[tc.name].lastUsedMs = s.createdMs;
        if (dayEntry) dayEntry.toolCalls++;

        if (tc.skill) {
          const sk = tc.skill.skillName;
          if (!skills[sk]) skills[sk] = { count: 0, lastUsedMs: 0, daily: {} };
          skills[sk].count++;
          skills[sk].daily[s.dateKey] = (skills[sk].daily[s.dateKey] || 0) + 1;
          if (s.createdMs > skills[sk].lastUsedMs) skills[sk].lastUsedMs = s.createdMs;
        }
      }
      continue;
    }

    if (s.type === 'GENERIC') {
      if (s.isSkillLoad) {
        cum.skills += s.tokensEst || 0;
      } else {
        cum.tools += s.tokensEst || 0;
        cum.toolResult += s.tokensEst || 0;
      }
      if (Array.isArray(s.media) && s.media.length > 0) {
        cum.media += s.mediaTokensEst || 0;
      }
      if (s.durationMs > 0) {
        totalToolDurationMs += s.durationMs;
      }
      if (prevStepMs > 0 && s.createdMs > prevStepMs) {
        const gap = s.createdMs - prevStepMs;
        if (gap < 30_000) {
          totalOverheadMs += Math.max(0, gap - (s.durationMs || 0));
        }
      }
      if (s.commandInfo) {
        const prog = s.commandInfo.program || 'shell';
        if (!commands[prog]) commands[prog] = { count: 0, failed: 0, lastUsedMs: 0, daily: {} };
        commands[prog].count++;
        const cmdDay = commands[prog].daily[s.dateKey] || { count: 0, failed: 0 };
        cmdDay.count++;
        if (s.commandInfo.isError) {
          commands[prog].failed++;
          cmdDay.failed++;
        }
        commands[prog].daily[s.dateKey] = cmdDay;
        if (s.createdMs > commands[prog].lastUsedMs) commands[prog].lastUsedMs = s.createdMs;
      }
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
    }
  }

  // Final composition snapshot. The official breakdown is exact for the
  // latest request; otherwise the transcript estimate is used.
  const compactedAfterLatestPlanner = lastCheckpointStepIndex > lastPlannerStepIndex;
  const officialFixed = official ? officialFixedTotals(official) : null;
  const officialFixedTotal = officialFixed
    ? Object.values(officialFixed).reduce((acc, v) => acc + v, 0)
    : 0;
  const visSum = cum.user + cum.injected + cum.skills + cum.thinking + cum.assistant + cum.tools + cum.media + cum.other;
  const barCum = {
    ...cum,
    assistant: cum.assistant + cum.thinking + cum.toolCall,
    thinking: 0,
    tools: cum.toolResult,
  };
  let effectivePrompt;
  let latestComposition;
  if (compactedAfterLatestPlanner) {
    effectivePrompt = officialFixedTotal + visSum;
    latestComposition = estimateComposition(barCum, effectivePrompt, official).composition;
  } else {
    const latestOfficialComposition = official?.hasBreakdown
      ? officialCompositionWithSplit(official, {
          thinking: responseThinkingEst,
          answer: responseAnswerEst,
          tool: responseToolEst,
        })
      : null;
    effectivePrompt = official?.usedTokens || latestPromptTokens || visSum;
    latestComposition = latestOfficialComposition
      || estimateComposition(barCum, effectivePrompt, official).composition;
  }

  const totalPromptAll = totalInput + totalCacheRead;
  const cacheHitRate = totalPromptAll > 0 ? totalCacheRead / totalPromptAll : 0;
  const activeDurationMs =
    totalModelDurationMs + totalToolDurationMs + totalOverheadMs > 0
      ? totalModelDurationMs + totalToolDurationMs + totalOverheadMs
      : firstMs > 0 && lastMs >= firstMs
        ? Math.min(lastMs - firstMs, 60_000)
        : 0;

  const metaUpdatedMs = meta?.lastModifiedTime ? toMillis(meta.lastModifiedTime) : 0;
  const updatedMs = Math.max(lastMs, metaUpdatedMs, parsed.mtimeMs);
  const spec = getModelSpec(latestModel);
  const effectiveWindow = official?.maxContextTokens || latestWindow || spec.contextWindow;
  const nativeWindow = Math.max(official?.nativeContextWindow || 0, spec.contextWindow, effectiveWindow);

  const officialTotals = official?.timing?.totals || null;
  const effectiveStreamMs = totalStreamingMs > 0 ? totalStreamingMs : (officialTotals?.streamingMs || 0);
  const effectiveStreamOut = totalStreamingMs > 0 ? totalStreamingOutputTokens : (officialTotals?.streamingOutputTokens || 0);
  const effectiveTtftMs = ttftSamples > 0 ? totalTtftMs : (officialTotals?.ttftMs || 0);
  const effectiveTtftSamples = ttftSamples > 0 ? ttftSamples : (officialTotals?.ttftSamples || 0);

  return {
    id: convId,
    mtimeMs: parsed.mtimeMs,
    size: parsed.size,
    title: meta?.title || firstUserTitle || convId.slice(0, 8),
    workspaceName: meta?.workspaceName || 'Workspace',
    workspacePath: meta?.workspacePath || '',
    status: meta?.status || '',
    firstMs,
    lastMs: updatedMs,
    stepCount: parsed.steps.length,
    turnsCount: Math.max(turnsCount, totalRequests > 0 ? 1 : 0),
    requestsCount: totalRequests,
    toolCallsCount: totalToolCalls,
    models: [...models],
    latestModel: latestModel || 'unknown',
    latestModelLabel: spec.label,
    contextWindow: effectiveWindow,
    nativeContextWindow: nativeWindow,
    contextSource: official?.hasBreakdown ? 'official' : (official ? 'official-usage' : 'transcript'),
    latestPromptTokens: effectivePrompt,
    windowUsagePct: effectiveWindow > 0 ? Math.min(100, (effectivePrompt / effectiveWindow) * 100) : 0,
    nativeWindowUsagePct: nativeWindow > 0 ? Math.min(100, (effectivePrompt / nativeWindow) * 100) : 0,
    totalInputTokens: totalInput,
    totalCacheReadTokens: totalCacheRead,
    totalOutputTokens: totalOutput,
    totalBillableTokens: totalInput + totalCacheRead + totalOutput,
    cacheHitRate,
    totalCost,
    activeDurationMs,
    modelDurationMs: totalModelDurationMs,
    toolDurationMs: totalToolDurationMs,
    overheadDurationMs: totalOverheadMs,
    streamingDurationMs: effectiveStreamMs,
    streamingOutputTokens: effectiveStreamOut,
    ttftDurationMs: effectiveTtftMs,
    ttftSamples: effectiveTtftSamples,
    daily,
    skills,
    tools,
    commands,
    latestComposition,
    billableBuckets,
  };
}

export class ProjectionStore {
  constructor() {
    this.cache = { version: CACHE_VERSION, conversations: {} };
    this.loaded = false;
    this.lastScanMs = 0;
  }

  loadDiskCache() {
    if (this.loaded) return;
    this.loaded = true;
    const p = getCachePath();
    if (!existsSync(p)) return;
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      if (parsed && parsed.version === CACHE_VERSION && parsed.conversations) {
        this.cache = parsed;
      }
    } catch {
      this.cache = { version: CACHE_VERSION, conversations: {} };
    }
  }

  saveDiskCache() {
    const p = getCachePath();
    const tmp = `${p}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.cache), 'utf8');
      renameSync(tmp, p);
    } catch {
      try {
        writeFileSync(p, JSON.stringify(this.cache), 'utf8');
      } catch {
        // ignore write errors
      }
    }
  }

  async refresh(force = false) {
    this.loadDiskCache();
    const now = Date.now();
    // Throttle filesystem scans to at most once every 1.2s unless forced
    if (!force && now - this.lastScanMs < 1200) {
      return this.cache.conversations;
    }
    this.lastScanMs = now;

    const brainDir = resolveBrainDir();
    if (!existsSync(brainDir)) {
      return this.cache.conversations;
    }

    const metaMap = await readConversationMetaMap();
    const seenIds = new Set();
    let dirty = false;

    let entries = [];
    try {
      entries = readdirSync(brainDir, { withFileTypes: true });
    } catch {
      return this.cache.conversations;
    }

    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const convId = dirent.name;
      const transcriptPath = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
      if (!existsSync(transcriptPath)) continue;

      seenIds.add(convId);
      let stat;
      try {
        stat = statSync(transcriptPath);
      } catch {
        continue;
      }

      const meta = metaMap.get(convId);
      const cached = this.cache.conversations[convId];

      const metaChanged =
        cached &&
        meta &&
        (cached.title !== (meta.title || cached.title) ||
          cached.workspaceName !== (meta.workspaceName || cached.workspaceName) ||
          cached.status !== (meta.status || ''));

      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && !metaChanged) {
        continue;
      }

      const proj = await buildConversationProjection(convId, transcriptPath, meta);
      if (proj) {
        this.cache.conversations[convId] = proj;
        dirty = true;
      }
    }

    // Prune deleted conversations
    for (const existingId of Object.keys(this.cache.conversations)) {
      if (!seenIds.has(existingId)) {
        delete this.cache.conversations[existingId];
        dirty = true;
      }
    }

    if (dirty) {
      this.saveDiskCache();
    }

    return this.cache.conversations;
  }

  async listSessions() {
    const convs = await this.refresh();
    return Object.values(convs).sort((a, b) => (b.lastMs || 0) - (a.lastMs || 0));
  }

  async getInsights(query = {}) {
    const convsMap = await this.refresh(Boolean(query.force));
    const allConvs = Object.values(convsMap);

    const range = ['today', '7d', '30d', 'all'].includes(query.range) ? query.range : '30d';
    const selectedDay = typeof query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.day) ? query.day : '';
    const workspaceFilter = typeof query.workspace === 'string' ? query.workspace.trim() : '';
    const searchQ = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
    const skillFilter = typeof query.skill === 'string' ? query.skill.trim() : '';
    const toolFilter = typeof query.tool === 'string' ? query.tool.trim() : '';
    const cmdFilter = typeof query.cmd === 'string' ? query.cmd.trim() : '';
    const sortBy = ['recent', 'tokens', 'context', 'cost'].includes(query.sort) ? query.sort : 'recent';

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const todayKey = formatLocalDateKey(todayDate);

    // Compute cutoff date keys for range
    const dateKeyDaysAgo = (n) => {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - n);
      return formatLocalDateKey(d);
    };

    const rangeStartKey =
      range === 'today' ? todayKey :
      range === '7d' ? dateKeyDaysAgo(6) :
      range === '30d' ? dateKeyDaysAgo(29) :
      '';

    // Always compute 7-day chart & 8-week (56-day) heatmap across all conversations (filtered by workspace/search if set)
    const chart7Days = [];
    const chart7Map = new Map();
    for (let i = 6; i >= 0; i--) {
      const dk = dateKeyDaysAgo(i);
      const item = { date: dk, tokens: 0, cost: 0, requests: 0 };
      chart7Days.push(item);
      chart7Map.set(dk, item);
    }

    const heatmap56 = [];
    const heatmapMap = new Map();
    for (let i = 55; i >= 0; i--) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const dk = formatLocalDateKey(d);
      const item = { date: dk, dow: d.getDay(), tokens: 0, cost: 0, requests: 0, sessions: 0 };
      heatmap56.push(item);
      heatmapMap.set(dk, item);
    }

    // Collect workspaces list
    const workspaceSet = new Set();
    for (const c of allConvs) {
      if (c.workspaceName) workspaceSet.add(c.workspaceName);
    }

    // Helper: does dateKey fall in active time window?
    const inActiveWindow = (dk) => {
      if (!dk) return false;
      if (selectedDay) return dk === selectedDay;
      if (!rangeStartKey) return true;
      return dk >= rangeStartKey;
    };

    const windowCount = (entry) => {
      if (!entry) return 0;
      if (range === 'all' && !selectedDay) return entry.count || 0;
      if (!entry.daily || typeof entry.daily !== 'object') return 0;
      let total = 0;
      for (const [dk, value] of Object.entries(entry.daily)) {
        if (!inActiveWindow(dk)) continue;
        total += typeof value === 'number' ? value : (value?.count || 0);
      }
      return total;
    };

    const windowFailed = (entry) => {
      if (!entry) return 0;
      if (range === 'all' && !selectedDay) return entry.failed || 0;
      if (!entry.daily || typeof entry.daily !== 'object') return 0;
      let total = 0;
      for (const [dk, value] of Object.entries(entry.daily)) {
        if (inActiveWindow(dk) && value && typeof value === 'object') {
          total += value.failed || 0;
        }
      }
      return total;
    };

    // Aggregate KPI, rankings, composition, charts, and filtered session cards
    const kpi = {
      billableTokens: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      cost: 0,
      cacheHitRate: 0,
      sessionsCount: 0,
      turnsCount: 0,
      requestsCount: 0,
      toolCallsCount: 0,
      toolDurationMs: 0,
      activeDurationMs: 0,
    };

    const timingAgg = {
      modelMs: 0,
      toolMs: 0,
      overheadMs: 0,
      totalActiveMs: 0,
      streamingMs: 0,
      streamingOutputTokens: 0,
      ttftMs: 0,
      ttftSamples: 0,
    };

    const skillAgg = new Map();
    const toolAgg = new Map();
    const cmdAgg = new Map();
    const compAgg = {
      systemBase: 0,
      toolDefs: 0,
      user: 0,
      injected: 0,
      skills: 0,
      thinking: 0,
      assistant: 0,
      tools: 0,
      media: 0,
      other: 0,
    };

    const matchingSessions = [];

    for (const c of allConvs) {
      if (workspaceFilter && c.workspaceName !== workspaceFilter) continue;

      // Contribute to 7-day chart & 56-day heatmap regardless of selectedDay
      for (const [dk, dObj] of Object.entries(c.daily || {})) {
        const c7 = chart7Map.get(dk);
        if (c7) {
          c7.tokens += dObj.billableTokens || 0;
          c7.cost += dObj.cost || 0;
          c7.requests += dObj.requests || 0;
        }
        const hm = heatmapMap.get(dk);
        if (hm) {
          hm.tokens += dObj.billableTokens || 0;
          hm.cost += dObj.cost || 0;
          hm.requests += dObj.requests || 0;
          if ((dObj.billableTokens || 0) > 0 || (dObj.requests || 0) > 0) {
            hm.sessions++;
          }
        }
      }

      // Check whether this conversation had activity in the selected range/day
      let rangeBillable = 0;
      let rangeInput = 0;
      let rangeCache = 0;
      let rangeOutput = 0;
      let rangeCost = 0;
      let rangeRequests = 0;
      let rangeTurns = 0;
      let rangeToolCalls = 0;
      let hasActivityInWindow = false;

      if (range === 'all' && !selectedDay) {
        hasActivityInWindow = true;
        rangeBillable = c.totalBillableTokens;
        rangeInput = c.totalInputTokens;
        rangeCache = c.totalCacheReadTokens;
        rangeOutput = c.totalOutputTokens;
        rangeCost = c.totalCost;
        rangeRequests = c.requestsCount;
        rangeTurns = c.turnsCount;
        rangeToolCalls = c.toolCallsCount;
      } else {
        for (const [dk, dObj] of Object.entries(c.daily || {})) {
          if (inActiveWindow(dk)) {
            hasActivityInWindow = true;
            rangeBillable += dObj.billableTokens || 0;
            rangeInput += dObj.inputTokens || 0;
            rangeCache += dObj.cacheReadTokens || 0;
            rangeOutput += dObj.outputTokens || 0;
            rangeCost += dObj.cost || 0;
            rangeRequests += dObj.requests || 0;
            rangeTurns += dObj.turns || 0;
            rangeToolCalls += dObj.toolCalls || 0;
          }
        }
      }

      if (!hasActivityInWindow) continue;

      // Aggregate rankings (before skill/tool/cmd click filters so the ranking cards stay interactive)
      for (const [name, info] of Object.entries(c.skills || {})) {
        const count = windowCount(info);
        if (count <= 0) continue;
        const prev = skillAgg.get(name) || { name, count: 0, sessions: 0, lastUsedMs: 0 };
        prev.count += count;
        prev.sessions++;
        prev.lastUsedMs = Math.max(prev.lastUsedMs, info.lastUsedMs || c.lastMs);
        skillAgg.set(name, prev);
      }
      for (const [name, info] of Object.entries(c.tools || {})) {
        const count = windowCount(info);
        if (count <= 0) continue;
        const prev = toolAgg.get(name) || { name, count: 0, sessions: 0, lastUsedMs: 0 };
        prev.count += count;
        prev.sessions++;
        prev.lastUsedMs = Math.max(prev.lastUsedMs, info.lastUsedMs || c.lastMs);
        toolAgg.set(name, prev);
      }
      for (const [name, info] of Object.entries(c.commands || {})) {
        const count = windowCount(info);
        if (count <= 0) continue;
        const prev = cmdAgg.get(name) || { name, count: 0, failed: 0, sessions: 0, lastUsedMs: 0 };
        prev.count += count;
        prev.failed += windowFailed(info);
        prev.sessions++;
        prev.lastUsedMs = Math.max(prev.lastUsedMs, info.lastUsedMs || c.lastMs);
        cmdAgg.set(name, prev);
      }

      // Apply card-level interactive filters (skill, tool, cmd, search)
      if (skillFilter && windowCount(c.skills?.[skillFilter]) <= 0) continue;
      if (toolFilter && windowCount(c.tools?.[toolFilter]) <= 0) continue;
      if (cmdFilter && windowCount(c.commands?.[cmdFilter]) <= 0) continue;
      if (searchQ) {
        const hay = `${c.title} ${c.id} ${c.workspaceName} ${c.workspacePath} ${c.latestModel}`.toLowerCase();
        if (!hay.includes(searchQ)) continue;
      }

      // Accumulate KPIs
      kpi.billableTokens += rangeBillable;
      kpi.inputTokens += rangeInput;
      kpi.cacheReadTokens += rangeCache;
      kpi.outputTokens += rangeOutput;
      kpi.cost += rangeCost;
      kpi.sessionsCount++;
      kpi.turnsCount += rangeTurns;
      kpi.requestsCount += rangeRequests;
      kpi.toolCallsCount += rangeToolCalls;

      // Scale billable composition & timing buckets to range ratio
      const ratio = c.totalBillableTokens > 0 ? rangeBillable / c.totalBillableTokens : 1;
      kpi.activeDurationMs += Math.round((c.activeDurationMs || 0) * ratio);
      kpi.toolDurationMs += Math.round((c.toolDurationMs || 0) * ratio);
      timingAgg.modelMs += Math.round((c.modelDurationMs || 0) * ratio);
      timingAgg.toolMs += Math.round((c.toolDurationMs || 0) * ratio);
      timingAgg.overheadMs += Math.round((c.overheadDurationMs || 0) * ratio);
      timingAgg.totalActiveMs += Math.round((c.activeDurationMs || 0) * ratio);
      timingAgg.streamingMs += Math.round((c.streamingDurationMs || 0) * ratio);
      timingAgg.streamingOutputTokens += Math.round((c.streamingOutputTokens || 0) * ratio);
      timingAgg.ttftMs += Math.round((c.ttftDurationMs || 0) * ratio);
      timingAgg.ttftSamples += Math.round((c.ttftSamples || 0) * ratio);
      for (const k of Object.keys(compAgg)) {
        compAgg[k] += Math.round((c.billableBuckets?.[k] || 0) * ratio);
      }

      matchingSessions.push({
        id: c.id,
        title: c.title,
        workspaceName: c.workspaceName,
        workspacePath: c.workspacePath,
        status: c.status,
        lastMs: c.lastMs,
        latestModel: c.latestModel,
        latestModelLabel: c.latestModelLabel,
        contextWindow: c.contextWindow,
        latestPromptTokens: c.latestPromptTokens,
        windowUsagePct: c.windowUsagePct,
        turnsCount: range === 'all' && !selectedDay ? c.turnsCount : rangeTurns,
        requestsCount: range === 'all' && !selectedDay ? c.requestsCount : rangeRequests,
        toolCallsCount: rangeToolCalls,
        billableTokens: rangeBillable,
        cacheHitRate: rangeInput + rangeCache > 0 ? rangeCache / (rangeInput + rangeCache) : c.cacheHitRate,
        cost: rangeCost,
        activeDurationMs: Math.round((c.activeDurationMs || 0) * ratio),
        latestComposition: c.latestComposition,
      });
    }

    const totalPromptKpi = kpi.inputTokens + kpi.cacheReadTokens;
    kpi.cacheHitRate = totalPromptKpi > 0 ? kpi.cacheReadTokens / totalPromptKpi : 0;

    matchingSessions.sort((a, b) => {
      if (sortBy === 'tokens') return b.billableTokens - a.billableTokens;
      if (sortBy === 'context') return b.latestPromptTokens - a.latestPromptTokens;
      if (sortBy === 'cost') return b.cost - a.cost;
      return (b.lastMs || 0) - (a.lastMs || 0);
    });

    const sortRank = (m) =>
      [...m.values()].sort((a, b) => b.count - a.count || b.lastUsedMs - a.lastUsedMs).slice(0, 20);

    const endToEndTokensPerSec = timingAgg.modelMs > 0 ? Math.round(kpi.outputTokens / (timingAgg.modelMs / 1000)) : 0;
    const outputTokensPerSec = timingAgg.streamingMs > 0 && timingAgg.streamingOutputTokens > 0
      ? Math.round(timingAgg.streamingOutputTokens / (timingAgg.streamingMs / 1000))
      : endToEndTokensPerSec;
    const avgTtftMs = timingAgg.ttftSamples > 0 ? Math.round(timingAgg.ttftMs / timingAgg.ttftSamples) : 0;
    const speedSource = timingAgg.streamingMs > 0 && timingAgg.streamingOutputTokens > 0 ? 'streaming' : 'estimated';

    return {
      generatedAt: Date.now(),
      range,
      selectedDay,
      workspaces: [...workspaceSet].sort(),
      kpi,
      timing: {
        ...timingAgg,
        avgTtftMs,
        outputTokensPerSec,
        endToEndTokensPerSec,
        speedSource,
      },
      chart7Days,
      heatmap56,
      rankings: {
        skills: sortRank(skillAgg),
        tools: sortRank(toolAgg),
        commands: sortRank(cmdAgg),
      },
      composition: compAgg,
      sessions: matchingSessions,
      totalSessionsAll: allConvs.length,
    };
  }
}
