/**
 * Normalize Antigravity's official context data.
 *
 * Source: GetCascadeTrajectoryGeneratorMetadata
 *   chatModel.chatStartMetadata.contextWindowMetadata
 *     - estimatedTokensUsed
 *     - maxContextTokens
 *     - tokenBreakdown.groups[] (System Prompt / Tools / Skills / MCP /
 *       Subagents / Plugins / Chat Messages)
 *   chatModel.usage (actual input / cache read / output)
 *   chatModel.promptSections (full system prompt and injected section text)
 *   chatModel.tools (full tool descriptions and JSON schemas)
 */

import { getModelSpec } from './pricing.mjs';
import { estimateTokens } from './tokenizer.mjs';

const NUMERIC_KEYS = new Set(['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'thinkingOutputTokens', 'responseOutputTokens']);

export const MIN_STREAM_MS = 50;
export const MIN_OUTPUT_TOKENS_FOR_SPEED = 2;
export const COLD_START_THRESHOLD_PCT = 10;
export const WARM_START_THRESHOLD_PCT = 70;
export const SHORT_SAMPLE_MIN_STREAM_MS = 300;
export const SHORT_SAMPLE_MIN_OUTPUT_TOKENS = 16;

/**
 * Classify prompt cache start efficiency from cacheHitRate (0..1) and totalPromptTokens.
 */
export function classifyCacheStart(cacheHitRate, totalPromptTokens) {
  if (!Number.isFinite(totalPromptTokens) || totalPromptTokens <= 0) return 'unknown';
  if (typeof cacheHitRate !== 'number' || !Number.isFinite(cacheHitRate) || cacheHitRate < 0) return 'unknown';
  const pct = cacheHitRate * 100;
  if (pct < COLD_START_THRESHOLD_PCT) return 'cold';
  if (pct < WARM_START_THRESHOLD_PCT) return 'partial';
  return 'warm';
}

/**
 * Evaluate per-call decode throughput with sparse-sample micro-burst gating.
 */
export function evaluateCallSpeed(outputTokens, streamingMsExact) {
  const out = Math.max(0, Number(outputTokens) || 0);
  const streamMs = Number.isFinite(streamingMsExact) && streamingMsExact > 0 ? streamingMsExact : 0;
  if (out <= 0 || streamMs <= 0) {
    return { displaySpeed: null, rawSpeed: null, isShortSample: false };
  }
  const rawSpeed = Math.round((out / (streamMs / 1000)) * 10) / 10;
  if (out < SHORT_SAMPLE_MIN_OUTPUT_TOKENS || streamMs < SHORT_SAMPLE_MIN_STREAM_MS) {
    return { displaySpeed: null, rawSpeed, isShortSample: true };
  }
  return { displaySpeed: rawSpeed, rawSpeed, isShortSample: false };
}

function toInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
  return 0;
}

function sumChildren(group) {
  if (!Array.isArray(group?.children)) return 0;
  return group.children.reduce((acc, child) => acc + toInt(child?.numTokens), 0);
}

function groupTokens(group) {
  return toInt(group?.numTokens) || sumChildren(group);
}

function normalizeType(value) {
  return String(value || '').trim().toUpperCase();
}

function isChatGroup(type) {
  return type === 'TOKEN_TYPE_CHAT_MESSAGES' || type === 'TOKEN_TYPE_CHAT_MESSAGE';
}

function isToolDefinitionGroup(type) {
  return type === 'TOKEN_TYPE_TOOLS'
    || type === 'TOKEN_TYPE_TOOL_DEFINITIONS'
    || type === 'TOKEN_TYPE_MCP_TOOLS';
}

function isSkillsGroup(type) {
  return type === 'TOKEN_TYPE_SKILLS' || type === 'TOKEN_TYPE_SKILL';
}

function isInjectedGroup(type) {
  return type === 'TOKEN_TYPE_PLUGINS'
    || type === 'TOKEN_TYPE_SUBAGENTS'
    || type === 'TOKEN_TYPE_RULES'
    || type === 'TOKEN_TYPE_USER_RULES'
    || type === 'TOKEN_TYPE_CUSTOM_INSTRUCTIONS'
    || type === 'TOKEN_TYPE_AGENTS_MD';
}

function isSystemGroup(type) {
  return type === 'TOKEN_TYPE_SYSTEM_PROMPT'
    || type === 'TOKEN_TYPE_SYSTEM'
    || type === 'TOKEN_TYPE_SYSTEM_INSTRUCTIONS'
    || type === 'TOKEN_TYPE_IDENTITY'
    || type === 'TOKEN_TYPE_USER_INFO'
    || type === 'TOKEN_TYPE_ENVIRONMENT'
    || type === 'TOKEN_TYPE_ARTIFACTS'
    || type === 'TOKEN_TYPE_CHECKPOINT'
    || type === 'TOKEN_TYPE_KNOWLEDGE'
    || type === 'TOKEN_TYPE_MEMORIES'
    || type === 'TOKEN_TYPE_EPHEMERAL';
}

function isMediaGroup(type) {
  return type === 'TOKEN_TYPE_MEDIA'
    || type === 'TOKEN_TYPE_FILES'
    || type === 'TOKEN_TYPE_IMAGES'
    || type === 'TOKEN_TYPE_ATTACHMENTS';
}

function classifyGroup(type, name) {
  const normalized = normalizeType(type);
  if (isChatGroup(normalized)) return 'chat';
  if (isToolDefinitionGroup(normalized)) return 'tools';
  if (isSkillsGroup(normalized)) return 'skills';
  if (isInjectedGroup(normalized)) return 'injected';
  if (isSystemGroup(normalized)) return 'systemBase';
  if (isMediaGroup(normalized)) return 'media';

  const title = String(name || '').toLowerCase();
  if (title.includes('chat message')) return 'chat';
  if (title.includes('mcp') || title.includes('tool')) return 'tools';
  if (title.includes('skill')) return 'skills';
  if (title.includes('plugin') || title.includes('subagent') || title.includes('rule')) return 'injected';
  if (title.includes('system prompt')) return 'systemBase';
  return 'other';
}

function parseChatChild(child) {
  const rawName = String(child?.name || '');
  const match = rawName.match(/^(\d+)\s*:\s*(.+)$/);
  return {
    stepIndex: match ? Number(match[1]) : -1,
    type: match ? normalizeType(match[2]) : normalizeType(rawName),
    tokens: toInt(child?.numTokens),
  };
}

function collectSectionTokenMap(groups) {
  const map = new Map();
  for (const group of groups) {
    if (!Array.isArray(group?.children)) continue;
    for (const child of group.children) {
      const name = String(child?.name || '').trim();
      if (name) map.set(name, toInt(child?.numTokens));
    }
  }
  return map;
}

function buildPromptSections(chatModel, sectionTokenMap) {
  const sections = Array.isArray(chatModel?.promptSections) ? chatModel.promptSections : [];
  return sections
    .filter((section) => section && typeof section === 'object')
    .map((section) => {
      const title = String(section.title || 'section');
      const content = typeof section.content === 'string' ? section.content : '';
      const tokens = sectionTokenMap.has(title)
        ? sectionTokenMap.get(title)
        : estimateTokens(content);
      return {
        title,
        tokenType: String(section.tokenType || ''),
        tokenSource: String(section.tokenSource || ''),
        sourceType: String(section.metadata?.sourceType || ''),
        content,
        tokens,
        estimated: !sectionTokenMap.has(title),
      };
    })
    .filter((section) => section.tokens > 0 || section.content);
}

function buildToolDefinitions(chatModel, toolTokenMap) {
  const tools = Array.isArray(chatModel?.tools) ? chatModel.tools : [];
  return tools
    .filter((tool) => tool && typeof tool === 'object')
    .map((tool) => {
      const name = String(tool.name || 'tool');
      return {
        name,
        description: String(tool.description || ''),
        jsonSchemaString: String(tool.jsonSchemaString || ''),
        tokens: toolTokenMap.get(name) || 0,
        estimated: !toolTokenMap.has(name),
      };
    })
    .filter((tool) => tool.tokens > 0 || tool.description || tool.jsonSchemaString);
}

function usageOf(chatModel) {
  const usage = chatModel?.usage && typeof chatModel.usage === 'object' ? chatModel.usage : {};
  const inputTokens = toInt(usage.inputTokens);
  const cacheReadTokens = toInt(usage.cacheReadTokens);
  const cacheCreationTokens = toInt(usage.cacheCreationTokens);
  const outputTokens = toInt(usage.outputTokens);
  const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
  return {
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    outputTokens,
    thinkingOutputTokens: toInt(usage.thinkingOutputTokens),
    responseOutputTokens: toInt(usage.responseOutputTokens),
    totalPromptTokens,
    totalBillableTokens: totalPromptTokens + outputTokens,
  };
}

/**
 * Parse a protobuf Duration field (e.g. "7.574362700s" or { seconds, nanos }) into milliseconds.
 */
export function parseDurationMs(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)s$/i);
    if (match) {
      const sec = Number(match[1]);
      return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
    }
    return 0;
  }
  if (value && typeof value === 'object') {
    const sec = Number(value.seconds || 0);
    const nanos = Number(value.nanos || 0);
    const ms = sec * 1000 + nanos / 1_000_000;
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

/**
 * Extract additive prompt cache telemetry across all generatorMetadata calls.
 * Mirrors Context Monitor's `cacheRead / (input + cacheRead + cacheCreation)` metric.
 */
function extractCacheTelemetry(entries) {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let totalCalls = 0;
  let cachedCalls = 0;

  for (const entry of entries) {
    const chatModel = entry?.chatModel;
    if (!chatModel || typeof chatModel !== 'object') continue;
    const usage = usageOf(chatModel);
    totalCalls++;
    inputTokens += usage.inputTokens;
    cacheReadTokens += usage.cacheReadTokens;
    cacheCreationTokens += usage.cacheCreationTokens;
    if (usage.cacheReadTokens > 0) cachedCalls++;
  }

  const totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
  const cacheHitRate = totalPromptTokens > 0 ? cacheReadTokens / totalPromptTokens : 0;

  return {
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalPromptTokens,
    cacheHitRate,
    cachedCalls,
    totalCalls,
  };
}

/**
 * Extract per-step and session-total streaming & TTFT timing from generatorMetadata.
 */
function extractTimingTelemetry(entries) {
  const byStep = new Map();
  let streamingMs = 0;
  let ttftMs = 0;
  let totalMs = 0;
  let outputTokens = 0;
  let streamingOutputTokens = 0;
  let samples = 0;
  let ttftSamples = 0;
  let latestOutputTokensPerSec = 0;

  for (const entry of entries) {
    const chatModel = entry?.chatModel;
    if (!chatModel || typeof chatModel !== 'object') continue;
    const stream = parseDurationMs(chatModel.streamingDuration);
    const ttft = parseDurationMs(chatModel.timeToFirstToken);
    const total = stream + ttft;
    if (total <= 0) continue;

    const usage = usageOf(chatModel);
    const out = usage.outputTokens;
    const speedValid = stream >= MIN_STREAM_MS && out >= MIN_OUTPUT_TOKENS_FOR_SPEED;
    const stepIndices = Array.isArray(entry.stepIndices)
      ? entry.stepIndices.map(toInt).filter(idx => idx >= 0)
      : [];

    const record = {
      streamingMs: Math.round(stream),
      streamingMsExact: stream,
      speedValid,
      ttftMs: Math.round(ttft),
      totalMs: Math.round(total),
      outputTokens: out,
    };
    for (const idx of stepIndices) {
      byStep.set(idx, record);
    }

    totalMs += total;
    outputTokens += out;
    if (ttft > 0) {
      ttftMs += ttft;
      ttftSamples++;
    }
    if (speedValid) {
      streamingMs += stream;
      streamingOutputTokens += out;
      samples++;
      latestOutputTokensPerSec = Math.round((out / (stream / 1000)) * 10) / 10;
    }
  }

  return {
    byStep,
    totals: {
      streamingMs: Math.round(streamingMs),
      streamingMsExact: streamingMs,
      ttftMs: Math.round(ttftMs),
      totalMs: Math.round(totalMs),
      outputTokens,
      streamingOutputTokens,
      samples,
      ttftSamples,
      latestOutputTokensPerSec,
    },
  };
}

/**
 * Extract per-step full call telemetry (model, thinking/cache breakdown, TTFT, retries, errors).
 */
function extractCallTelemetry(entries) {
  const byStep = new Map();

  for (const entry of entries) {
    const chatModel = entry?.chatModel;
    if (!chatModel || typeof chatModel !== 'object') continue;
    const usage = usageOf(chatModel);
    const thinkingOutputTokens = usage.thinkingOutputTokens > 0
      ? Math.min(usage.thinkingOutputTokens, usage.outputTokens > 0 ? usage.outputTokens : usage.thinkingOutputTokens)
      : (usage.responseOutputTokens > 0 && usage.outputTokens > usage.responseOutputTokens
          ? usage.outputTokens - usage.responseOutputTokens
          : 0);

    const streamingMsExact = parseDurationMs(chatModel.streamingDuration);
    const ttftMsExact = parseDurationMs(chatModel.timeToFirstToken);
    const ttftMs = ttftMsExact >= 1 ? Math.round(ttftMsExact) : 0;
    const totalMs = Math.round(streamingMsExact + ttftMsExact);

    const errorMessage = typeof entry.error === 'string' ? entry.error.trim() : '';
    const hasError = Boolean(errorMessage);
    const retryInfos = Array.isArray(chatModel.retryInfos) ? chatModel.retryInfos : [];
    const retryErrCount = retryInfos.filter(
      ri => ri && typeof ri === 'object' && typeof ri.error === 'string' && ri.error.trim()
    ).length;
    const cmRetries = toInt(chatModel.retries);
    const retries = retryErrCount > 0
      ? retryErrCount
      : (retryInfos.length === 0 && cmRetries > 1 ? cmRetries - 1 : 0);

    const record = {
      model: String(chatModel.model || '').trim(),
      responseModel: String(chatModel.responseModel || '').trim(),
      modelDisplayName: String(chatModel.modelDisplayName || '').trim(),
      executionModel: String(entry?.plannerConfig?.planExecuteConfig?.executionModel || '').trim(),
      inputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      outputTokens: usage.outputTokens,
      thinkingOutputTokens,
      responseOutputTokens: usage.responseOutputTokens,
      totalPromptTokens: usage.totalPromptTokens,
      ttftMs,
      streamingMs: Math.round(streamingMsExact),
      streamingMsExact,
      totalMs,
      hasError,
      errorMessage,
      retries,
    };

    const stepIndices = Array.isArray(entry.stepIndices)
      ? entry.stepIndices.map(toInt).filter(idx => idx >= 0)
      : [];
    for (const idx of stepIndices) {
      byStep.set(idx, record);
    }
  }

  return byStep;
}

function checkpointIndexOf(chatModel) {
  const value = chatModel?.chatStartMetadata?.checkpointIndex;
  return toInt(value);
}

function detectCheckpoints(entries) {
  const points = [];
  let previousIndex = -1;
  let previousPrompt = 0;

  for (const entry of entries) {
    const chatModel = entry?.chatModel;
    if (!chatModel || typeof chatModel !== 'object') continue;
    const index = checkpointIndexOf(chatModel);
    const usage = usageOf(chatModel);
    const stepIndices = Array.isArray(entry.stepIndices) ? entry.stepIndices : [];
    const stepIndex = stepIndices.length > 0 ? Math.min(...stepIndices) : -1;

    if (previousIndex >= 0 && index > previousIndex) {
      points.push({
        stepIndex,
        checkpointIndex: index,
        beforeTokens: previousPrompt,
        afterTokens: usage.totalPromptTokens,
        source: 'checkpoint-index',
      });
    } else if (previousPrompt > 0 && usage.totalPromptTokens > 0) {
      const drop = previousPrompt - usage.totalPromptTokens;
      if (drop >= 8_000 && drop / previousPrompt >= 0.25) {
        points.push({
          stepIndex,
          checkpointIndex: index,
          beforeTokens: previousPrompt,
          afterTokens: usage.totalPromptTokens,
          source: 'prompt-drop',
        });
      }
    }

    previousIndex = index;
    if (usage.totalPromptTokens > 0) previousPrompt = usage.totalPromptTokens;
  }

  const seen = new Set();
  return points.filter((point) => {
    const key = `${point.stepIndex}:${point.checkpointIndex}:${point.afterTokens}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyBuckets() {
  return {
    systemBase: 0,
    toolDefs: 0,
    tools: 0,
    user: 0,
    injected: 0,
    skills: 0,
    assistant: 0,
    thinking: 0,
    media: 0,
    other: 0,
  };
}

function normalizeComposition(buckets, total) {
  const composition = {
    systemBase: Math.max(0, Math.round(buckets.systemBase)),
    toolDefs: Math.max(0, Math.round(buckets.toolDefs)),
    tools: Math.max(0, Math.round(buckets.tools)),
    user: Math.max(0, Math.round(buckets.user)),
    injected: Math.max(0, Math.round(buckets.injected)),
    skills: Math.max(0, Math.round(buckets.skills)),
    assistant: Math.max(0, Math.round(buckets.assistant)),
    thinking: Math.max(0, Math.round(buckets.thinking)),
    media: Math.max(0, Math.round(buckets.media)),
    other: Math.max(0, Math.round(buckets.other)),
    total: Math.max(0, Math.round(total)),
  };
  const sum = composition.systemBase + composition.toolDefs + composition.tools + composition.user
    + composition.injected + composition.skills + composition.assistant
    + composition.thinking + composition.media + composition.other;
  if (composition.total > 0 && sum !== composition.total) {
    composition.injected += composition.total - sum;
    if (composition.injected < 0) {
      composition.assistant += composition.injected;
      composition.injected = 0;
    }
  }
  return composition;
}

export function normalizeThinkingRatios(ratios) {
  const thinking = Math.max(0, Number(ratios?.thinking) || 0);
  const answer = Math.max(0, Number(ratios?.answer) || 0);
  const tool = Math.max(0, Number(ratios?.tool) || 0);
  const total = thinking + answer + tool;
  if (total <= 0) return { thinking: 0, answer: 1, tool: 0 };
  return {
    thinking: thinking / total,
    answer: answer / total,
    tool: tool / total,
  };
}

export function normalizeOutputRatios(ratios) {
  return normalizeThinkingRatios(ratios);
}

function emptyComposition() {
  return {
    systemBase: 0,
    toolDefs: 0,
    user: 0,
    injected: 0,
    skills: 0,
    assistant: 0,
    thinking: 0,
    tools: 0,
    media: 0,
    other: 0,
    total: 0,
  };
}

/**
 * Official fixed (non-chat) context sections. They are present in every
 * request and reported directly by the language server.
 */
export function officialFixedTotals(official) {
  const fixed = official?.fixed || {};
  return {
    systemBase: toInt(fixed.systemPrompt),
    toolDefs: toInt(fixed.tools) + toInt(fixed.mcpTools),
    tools: 0,
    injected: toInt(fixed.plugins) + toInt(fixed.subagents) + toInt(fixed.rules),
    skills: toInt(fixed.skills),
    media: toInt(fixed.media),
    other: toInt(fixed.other),
  };
}

function reconcileComposition(composition, total) {
  const keys = ['systemBase', 'toolDefs', 'user', 'injected', 'skills', 'assistant', 'thinking', 'tools', 'media', 'other'];
  let sum = keys.reduce((acc, key) => acc + composition[key], 0);
  let diff = Math.round(total) - sum;
  if (diff !== 0) {
    composition.other = Math.max(0, composition.other + diff);
    sum = keys.reduce((acc, key) => acc + composition[key], 0);
    diff = Math.round(total) - sum;
    if (diff !== 0) {
      composition.systemBase = Math.max(0, composition.systemBase + diff);
    }
  }
  composition.total = Math.max(0, Math.round(total));
  return composition;
}

/**
 * Estimate the context composition of one request.
 *
 * When the language server reported fixed sections, they are authoritative and
 * the remaining prompt is distributed across visible chat history. Without
 * official data the previous "prompt - visible history" heuristic is kept.
 */
export function estimateComposition(cum, promptTokens, official) {
  const prompt = Math.max(0, Math.round(Number(promptTokens) || 0));
  const visible = {
    user: Math.max(0, Number(cum?.user) || 0),
    injected: Math.max(0, Number(cum?.injected) || 0),
    skills: Math.max(0, Number(cum?.skills) || 0),
    thinking: Math.max(0, Number(cum?.thinking) || 0),
    assistant: Math.max(0, Number(cum?.assistant) || 0),
    tools: Math.max(0, Number(cum?.tools) || 0),
    media: Math.max(0, Number(cum?.media) || 0),
    other: Math.max(0, Number(cum?.other) || 0),
  };
  const visibleSum = Object.values(visible).reduce((acc, value) => acc + value, 0);
  const fixed = officialFixedTotals(official);
  const fixedSum = Object.values(fixed).reduce((acc, value) => acc + value, 0);
  const composition = emptyComposition();

  if (fixedSum > 0) {
    if (prompt <= fixedSum) {
      const scale = fixedSum > 0 ? prompt / fixedSum : 0;
      for (const key of Object.keys(fixed)) {
        composition[key] = Math.round(fixed[key] * scale);
      }
      return { composition: reconcileComposition(composition, prompt), fixedApplied: prompt };
    }

    for (const key of Object.keys(fixed)) composition[key] = fixed[key];
    const remaining = prompt - fixedSum;
    if (visibleSum <= 0) {
      composition.other = remaining;
    } else {
      const scale = remaining / visibleSum;
      for (const key of Object.keys(visible)) {
        composition[key] = Math.round(visible[key] * scale);
      }
    }
    return { composition: reconcileComposition(composition, prompt), fixedApplied: fixedSum };
  }

  const scale = prompt > 0 && visibleSum > prompt ? prompt / visibleSum : 1;
  for (const key of Object.keys(visible)) {
    composition[key] = Math.round(visible[key] * scale);
  }
  const attributed = Object.keys(visible).reduce((acc, key) => acc + composition[key], 0);
  composition.systemBase = Math.max(0, prompt - attributed);
  return { composition: reconcileComposition(composition, prompt), fixedApplied: 0 };
}

/**
 * Parse the generator metadata array into a single official snapshot.
 * Returns null when no usable metadata is available.
 */
export function parseOfficialContext(generatorMetadata, options = {}) {
  const entries = Array.isArray(generatorMetadata)
    ? generatorMetadata.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
  if (entries.length === 0) return null;

  const latestWithBreakdown = [...entries].reverse().find((entry) => {
    const groups = entry?.chatModel?.chatStartMetadata?.contextWindowMetadata?.tokenBreakdown?.groups;
    return Array.isArray(groups) && groups.length > 0;
  }) || null;
  const latestWithUsage = [...entries].reverse().find((entry) => {
    const usage = entry?.chatModel?.usage;
    return usage && (toInt(usage.inputTokens) + toInt(usage.cacheReadTokens) + toInt(usage.outputTokens) > 0);
  }) || entries[entries.length - 1];
  const reference = latestWithBreakdown || latestWithUsage;
  const usageSource = latestWithUsage || reference;
  const chatModel = reference?.chatModel && typeof reference.chatModel === 'object'
    ? reference.chatModel
    : {};
  const contextWindowMetadata = chatModel?.chatStartMetadata?.contextWindowMetadata || null;
  const groups = Array.isArray(contextWindowMetadata?.tokenBreakdown?.groups)
    ? contextWindowMetadata.tokenBreakdown.groups.filter((group) => group && typeof group === 'object')
    : [];
  const usage = usageOf(usageSource?.chatModel);
  const latestStepIndices = Array.isArray(reference?.stepIndices) ? reference.stepIndices : [];

  const buckets = emptyBuckets();
  const fixed = {
    systemPrompt: 0,
    tools: 0,
    mcpTools: 0,
    skills: 0,
    plugins: 0,
    subagents: 0,
    rules: 0,
    media: 0,
    other: 0,
  };
  const chat = {
    user: 0,
    assistant: 0,
    toolResults: 0,
    injected: 0,
    media: 0,
    other: 0,
    total: 0,
  };
  const chatSteps = [];
  const sectionTokenMap = collectSectionTokenMap(groups);
  const toolTokenMap = new Map();

  for (const group of groups) {
    const type = normalizeType(group.type);
    const tokens = groupTokens(group);
    if (tokens <= 0 && !isChatGroup(type)) continue;

    if (isChatGroup(type)) {
      chat.total += tokens;
      for (const child of Array.isArray(group.children) ? group.children : []) {
        const parsed = parseChatChild(child);
        if (parsed.tokens <= 0) continue;
        chatSteps.push(parsed);
        if (parsed.type === 'USER_INPUT') chat.user += parsed.tokens;
        else if (parsed.type === 'PLANNER_RESPONSE') chat.assistant += parsed.tokens;
        else if (parsed.type === 'GENERIC' || parsed.type === 'TOOL_RESULT') chat.toolResults += parsed.tokens;
        else if (parsed.type === 'SYSTEM_MESSAGE' || parsed.type === 'ERROR_MESSAGE' || parsed.type === 'CHECKPOINT') chat.injected += parsed.tokens;
        else if (isMediaGroup(parsed.type)) chat.media += parsed.tokens;
        else chat.other += parsed.tokens;
      }
      continue;
    }

    if (isToolDefinitionGroup(type)) {
      if (type === 'TOKEN_TYPE_MCP_TOOLS') {
        fixed.mcpTools += tokens;
        buckets.toolDefs += tokens;
      } else {
        fixed.tools += tokens;
        buckets.toolDefs += tokens;
      }
      for (const child of Array.isArray(group.children) ? group.children : []) {
        const name = String(child?.name || '').trim();
        if (name) toolTokenMap.set(name, toInt(child?.numTokens));
      }
      continue;
    }

    if (isSkillsGroup(type)) {
      fixed.skills += tokens;
      buckets.skills += tokens;
      continue;
    }

    if (isInjectedGroup(type)) {
      fixed.rules += tokens;
      buckets.injected += tokens;
      continue;
    }

    if (isMediaGroup(type)) {
      fixed.media += tokens;
      buckets.media += tokens;
      continue;
    }

    if (isSystemGroup(type)) {
      fixed.systemPrompt += tokens;
      buckets.systemBase += tokens;
      continue;
    }

    fixed.other += tokens;
    buckets.other += tokens;
  }

  buckets.user += chat.user;
  buckets.assistant += chat.assistant;
  buckets.tools += chat.toolResults;
  buckets.injected += chat.injected;
  buckets.media += chat.media;
  buckets.other += chat.other;

  const breakdownSum = buckets.systemBase + buckets.toolDefs + buckets.tools + buckets.user
    + buckets.injected + buckets.skills + buckets.assistant
    + buckets.media + buckets.other;
  const usedTokens = toInt(contextWindowMetadata?.estimatedTokensUsed)
    || breakdownSum
    || usage.totalPromptTokens;
  const maxContextTokens = toInt(contextWindowMetadata?.maxContextTokens);
  const spec = getModelSpec(options.modelId || chatModel.model || '');
  const nativeContextWindow = Math.max(
    toInt(spec.contextWindow),
    maxContextTokens,
    usedTokens,
  );

  return {
    source: groups.length > 0 ? 'official' : 'usage-only',
    hasBreakdown: groups.length > 0,
    model: String(chatModel.model || ''),
    modelDisplayName: String(chatModel.modelDisplayName || ''),
    usedTokens,
    breakdownUsedTokens: breakdownSum,
    maxContextTokens,
    nativeContextWindow,
    usage,
    requestCount: entries.length,
    latestStepIndices,
    checkpointIndex: checkpointIndexOf(chatModel),
    checkpoints: detectCheckpoints(entries),
    timing: extractTimingTelemetry(entries),
    callsByStep: extractCallTelemetry(entries),
    cache: extractCacheTelemetry(entries),
    buckets,
    fixed,
    chat,
    chatSteps,
    sections: buildPromptSections(chatModel, sectionTokenMap),
    tools: buildToolDefinitions(chatModel, toolTokenMap),
    composition: normalizeComposition(buckets, usedTokens),
    updatedAt: Date.now(),
  };
}

/**
 * Refine the official bucket snapshot for the Current Context card.
 *
 * The language server's own grouping is kept verbatim (assistant replies stay
 * whole, tool definitions are reported separately), so the composition bar
 * stays aligned with the Context Browser categories. The only adjustment is
 * media returned by tools, which Antigravity folds into the generic chat
 * bucket but the transcript can measure separately.
 */
export function officialCompositionWithSplit(official, ratios) {
  if (!official?.composition) return null;
  const buckets = { ...official.buckets };

  // Antigravity folds media returned by tools into the generic chat bucket.
  // Split the transcript-measured media tokens back out so the browser and
  // the Current Context chart describe the same context.
  const measuredMedia = Math.max(0, toInt(ratios?.media));
  const mediaDelta = Math.max(0, measuredMedia - toInt(buckets.media));
  if (mediaDelta > 0) {
    const moved = Math.min(mediaDelta, Math.max(0, buckets.tools));
    buckets.tools -= moved;
    buckets.media += moved;
  }
  return normalizeComposition(buckets, official.usedTokens);
}

/**
 * Rebuild the session-cumulative category buckets from the official fixed
 * sections plus each request's measured prompt size.
 */
export function officialCumulativeBuckets(plannerSteps, official, ratios) {
  const buckets = emptyBuckets();
  if (!official) return buckets;

  const fixedTotal = official.fixed.systemPrompt
    + official.fixed.tools
    + official.fixed.mcpTools
    + official.fixed.skills
    + official.fixed.plugins
    + official.fixed.subagents
    + official.fixed.rules
    + official.fixed.media
    + official.fixed.other;
  const chatTotal = official.chat.total || (
    official.chat.user
    + official.chat.assistant
    + official.chat.toolResults
    + official.chat.injected
    + official.chat.media
    + official.chat.other
  );
  const chatRatios = chatTotal > 0
    ? {
        user: official.chat.user / chatTotal,
        assistant: official.chat.assistant / chatTotal,
        toolResults: official.chat.toolResults / chatTotal,
        injected: official.chat.injected / chatTotal,
        media: official.chat.media / chatTotal,
        other: official.chat.other / chatTotal,
      }
    : { user: 0, assistant: 0, toolResults: 1, injected: 0, media: 0, other: 0 };

  const steps = Array.isArray(plannerSteps) ? plannerSteps : [];
  if (steps.length === 0) {
    return { ...official.buckets };
  }

  for (const step of steps) {
    const prompt = Math.max(0, Number(step?.totalPromptTokens) || 0);
    const fixedPart = Math.min(fixedTotal, prompt);
    const fixedScale = fixedTotal > 0 ? fixedPart / fixedTotal : 0;
    buckets.systemBase += official.fixed.systemPrompt * fixedScale;
    buckets.toolDefs += (official.fixed.tools + official.fixed.mcpTools) * fixedScale;
    buckets.skills += official.fixed.skills * fixedScale;
    buckets.injected += (official.fixed.plugins + official.fixed.subagents + official.fixed.rules) * fixedScale;
    buckets.media += official.fixed.media * fixedScale;
    buckets.other += official.fixed.other * fixedScale;

    const chatPart = Math.max(0, prompt - fixedPart);
    if (chatPart > 0) {
      buckets.user += chatPart * chatRatios.user;
      buckets.tools += chatPart * chatRatios.toolResults;
      buckets.injected += chatPart * chatRatios.injected;
      buckets.media += chatPart * chatRatios.media;
      buckets.other += chatPart * chatRatios.other;
      buckets.assistant += chatPart * chatRatios.assistant;
    }
  }

  return buckets;
}
