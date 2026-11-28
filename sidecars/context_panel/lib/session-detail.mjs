import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { isPathInside, resolveBrainDir } from './env.mjs';
import { parseTranscriptFile, localPathFromUri } from './parser.mjs';
import { getModelSpec, resolveModelMeta, estimateStepCost } from './pricing.mjs';
import { getGeneratorMetadata } from './ls-rpc.mjs';
import {
  MIN_OUTPUT_TOKENS_FOR_SPEED,
  MIN_STREAM_MS,
  classifyCacheStart,
  estimateComposition,
  evaluateCallSpeed,
  normalizeOutputRatios,
  officialCompositionWithSplit,
  officialFixedTotals,
  parseOfficialContext,
} from './official-context.mjs';

const MAX_LRU_SESSIONS = 4;
const LEGACY_ORCHESTRATOR_PLANNER_IDS = new Set([
  'MODEL_PLACEHOLDER_M537',
  'MODEL_PLACEHOLDER_M667',
  'MODEL_PLACEHOLDER_M681',
]);
const LEGACY_ORCHESTRATOR_EXECUTOR_IDS = new Set([
  'MODEL_PLACEHOLDER_M669',
]);

function isUnspecifiedModel(value) {
  const clean = String(value || '').trim().toUpperCase();
  return !clean || clean === 'MODEL_UNSPECIFIED' || clean === 'MODEL_PLACEHOLDER_UNSPECIFIED';
}

function readLocalOrchestratorConfigFallback() {
  try {
    const cfgPath = join(homedir(), '.gemini', 'config', 'config.json');
    if (!existsSync(cfgPath)) return null;
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const us = parsed?.userSettings || parsed?.userConfig?.userSettings;
    if (!us || typeof us !== 'object' || Array.isArray(us)) return null;
    const planModel = String(us.orchestratorModel || '').trim();
    const executionModel = String(us.orchestratorExecutorModel || '').trim();
    if (isUnspecifiedModel(planModel) && isUnspecifiedModel(executionModel)) return null;
    return {
      planModel: isUnspecifiedModel(planModel) ? '' : planModel,
      executionModel: isUnspecifiedModel(executionModel) ? '' : executionModel,
    };
  } catch {
    return null;
  }
}

function truncate(str, maxLen = 120) {
  if (!str || typeof str !== 'string') return '';
  const single = str.replace(/\s+/g, ' ').trim();
  return single.length > maxLen ? `${single.slice(0, maxLen - 1)}…` : single;
}

function officialSectionCategory(section) {
  const type = String(section?.tokenType || '').toUpperCase();
  if (type === 'TOKEN_TYPE_MCP_TOOLS') return 'tool_defs';
  if (type === 'TOKEN_TYPE_SKILLS' || type === 'TOKEN_TYPE_SKILL') return 'skills';
  if (
    type === 'TOKEN_TYPE_PLUGINS'
    || type === 'TOKEN_TYPE_SUBAGENTS'
    || type === 'TOKEN_TYPE_RULES'
    || type === 'TOKEN_TYPE_USER_RULES'
    || type === 'TOKEN_TYPE_CUSTOM_INSTRUCTIONS'
    || type === 'TOKEN_TYPE_AGENTS_MD'
  ) {
    return 'injected';
  }
  return 'system_base';
}

function officialSectionSource(section) {
  const source = String(section?.sourceType || section?.tokenSource || '').toUpperCase();
  if (source.includes('TEMPLATE')) return 'template';
  if (source.includes('RAW')) return 'raw';
  return 'official';
}

function prettyJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function officialToolSource(name) {
  const toolName = String(name || '');
  if (toolName.startsWith('mcp_') || toolName === 'call_mcp_tool') return 'MCP';
  if (
    toolName === 'swarm'
    || toolName === 'invoke_subagent'
    || toolName === 'define_subagent'
    || toolName === 'manage_subagents'
    || toolName === 'send_message'
    || toolName === 'ask_question'
    || toolName === 'manage_task'
    || toolName === 'schedule'
    || toolName === 'list_plugin_accounts'
  ) {
    return 'Antigravity';
  }
  return 'native';
}

function toolDefinitionBody(tool) {
  const description = String(tool?.description || '').trim();
  const schema = prettyJson(tool?.jsonSchemaString);
  if (description && schema) return `${description}\n\nJSON Schema:\n${schema}`;
  return description || schema || '';
}

function getTranscriptPaths(convId) {
  const brainDir = resolveBrainDir();
  const convDir = join(brainDir, convId);
  const fullPath = join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl');
  const compactPath = join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
  if (existsSync(fullPath)) return { path: fullPath, isFull: true, convDir };
  if (existsSync(compactPath)) return { path: compactPath, isFull: false, convDir };
  return { path: null, isFull: false, convDir };
}

/**
 * Build full L3 session analytics from parsed transcript steps.
 */
export function analyzeSession(convId, parsed, meta, official = null) {
  const steps = parsed.steps || [];
  const plannerSnapshots = [];
  const checkpointRecords = [];
  const events = [];
  const allFileOps = [];
  const allCommands = [];

  const plannerSteps = steps.filter(step => step.type === 'PLANNER_RESPONSE');
  const lastPlannerStepIndex = plannerSteps.length > 0
    ? plannerSteps[plannerSteps.length - 1].stepIndex
    : -1;
  const responseRatios = {
    thinking: plannerSteps.reduce((acc, step) => acc + (step.thinkingTokensEst || 0), 0),
    answer: plannerSteps.reduce((acc, step) => acc + (step.answerTokensEst || 0), 0),
    tool: plannerSteps.reduce((acc, step) => acc + (step.toolCallTokensEst || 0), 0),
  };
  const officialFixed = official ? officialFixedTotals(official) : null;
  const officialFixedTotal = officialFixed
    ? Object.values(officialFixed).reduce((acc, value) => acc + value, 0)
    : 0;
  const officialStepTokens = new Map(
    (official?.chatSteps || [])
      .filter(item => Number.isInteger(item?.stepIndex) && item.stepIndex >= 0)
      .map(item => [item.stepIndex, item.tokens])
  );

  // Running cumulative visible items up to each planner call
  const historyItems = [];
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

  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;
  let plannerInputTokens = 0;
  let plannerCacheReadTokens = 0;
  let latestStepSpeed = 0;
  let totalCost = 0;
  let totalToolCalls = 0;
  let userInputsCount = 0;
  let totalToolDurationMs = 0;
  let totalModelDurationMs = 0;
  let totalStreamingMs = 0;
  let totalStreamingOutputTokens = 0;
  let totalTtftMs = 0;
  let ttftSamples = 0;
  let totalOverheadMs = 0;
  let checkpointCount = 0;
  let lastCheckpointStepIndex = -1;
  let firstMs = 0;
  let lastMs = 0;
  let prevStepMs = 0;
  let prevStepType = '';
  let latestModel = '';
  let prevPromptTokens = 0;
  let prevCallPromptTokens = null;
  let prevComp = null;

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

  let pendingInItems = [];
  let currentUserText = '';
  let lastPlannerSeq = -1;
  let historyEpoch = 0;
  const historyEpochRanges = [{ start: 0, epoch: 0 }];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.createdMs > 0) {
      if (!firstMs || s.createdMs < firstMs) firstMs = s.createdMs;
      if (s.createdMs > lastMs) lastMs = s.createdMs;
    }

    if (s.type === 'USER_INPUT') {
      userInputsCount++;
      currentUserText = s.cleanText || '';
      const userTok = Math.max(0, (s.tokensEst || 0) - (s.mediaTokensEst || 0));
      cum.user += userTok;
      cum.media += s.mediaTokensEst || 0;

      historyItems.push({
        kind: 'user',
        stepIndex: s.stepIndex,
        turnIndex: s.turnIndex,
        createdAt: s.createdAt,
        tokens: userTok,
        title: truncate(s.cleanText, 90) || 'User message',
        body: s.cleanText,
        rawBody: s.rawText,
      });

      if (Array.isArray(s.media) && s.media.length > 0) {
        for (const m of s.media) {
          const uri = localPathFromUri(m?.uri);
          let fileSize = 0;
          try {
            if (uri && existsSync(uri)) fileSize = statSync(uri).size;
          } catch {
            // ignore
          }
          const mime = String(m?.mime_type || 'application/octet-stream');
          const fname = basename(uri.replace(/\\/g, '/')) || 'attachment';
          const ext = extname(fname).toLowerCase();
          const mTok = mime.startsWith('image/') ? 258 : 512;
          historyItems.push({
            kind: 'media',
            stepIndex: s.stepIndex,
            turnIndex: s.turnIndex,
            createdAt: s.createdAt,
            tokens: mTok,
            title: fname,
            mimeType: mime,
            ext,
            uri,
            fileSize,
          });
        }
      }

      if (s.settingsChange) {
        events.push({
          type: 'injection',
          label: 'Settings Change',
          source: 'USER_SETTINGS_CHANGE',
          detail: truncate(s.settingsChange, 140),
          tokenDelta: 0,
          turnIndex: s.turnIndex,
          stepIndex: s.stepIndex,
          plannerSeq: Math.max(0, lastPlannerSeq + 1),
          createdAt: s.createdAt,
        });
      }

      pendingInItems.push({ kind: 'user', label: truncate(s.cleanText, 80) });
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'SYSTEM_MESSAGE' || s.type === 'ERROR_MESSAGE') {
      cum.injected += s.tokensEst || 0;
      const isErr = s.type === 'ERROR_MESSAGE';
      historyItems.push({
        kind: 'injected',
        stepIndex: s.stepIndex,
        turnIndex: s.turnIndex,
        createdAt: s.createdAt,
        tokens: s.tokensEst || 0,
        title: isErr ? `Error: ${truncate(s.error || s.content, 80)}` : truncate(s.content, 80),
        body: s.content || s.error || '',
        rawBody: s.content || s.error || '',
        isError: isErr,
      });

      events.push({
        type: isErr ? 'error' : 'injection',
        label: isErr ? 'Runtime Error' : 'System Message',
        source: s.source || 'SYSTEM',
        detail: truncate(s.error || s.content, 160),
        tokenDelta: s.tokensEst || 0,
        turnIndex: s.turnIndex,
        stepIndex: s.stepIndex,
        plannerSeq: Math.max(0, lastPlannerSeq + 1),
        createdAt: s.createdAt,
      });

      pendingInItems.push({
        kind: isErr ? 'error' : 'system',
        label: truncate(s.error || s.content, 72),
      });
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'CHECKPOINT') {
      checkpointCount++;
      lastCheckpointStepIndex = Math.max(lastCheckpointStepIndex, s.stepIndex);
      if (s.model) latestModel = s.model;
      const cpOfficial = official?.callsByStep?.get(s.stepIndex) || null;
      const cpInput = cpOfficial ? cpOfficial.inputTokens : s.inputTokens;
      const cpCacheRead = cpOfficial ? cpOfficial.cacheReadTokens : s.cacheReadTokens;
      const cpCacheCreation = cpOfficial ? cpOfficial.cacheCreationTokens : 0;
      const cpOutput = cpOfficial ? cpOfficial.outputTokens : s.outputTokens;
      const cpModelRaw = cpOfficial?.model || cpOfficial?.responseModel || s.model || latestModel || '';
      const cpMeta = resolveModelMeta(cpModelRaw, { at: s.createdAt });
      const cpCost = estimateStepCost(cpModelRaw, cpInput, cpCacheRead, cpOutput, { at: s.createdAt }).cost;

      totalInputTokens += s.inputTokens;
      totalCacheReadTokens += s.cacheReadTokens;
      totalOutputTokens += s.outputTokens;
      totalCost += cpCost;

      checkpointRecords.push({
        model: cpModelRaw || 'checkpoint',
        canonicalModelKey: cpMeta.canonicalKey,
        labelEn: cpMeta.labelEn,
        labelZh: cpMeta.labelZh,
        inputTokens: cpInput,
        cacheReadTokens: cpCacheRead,
        cacheCreationTokens: cpCacheCreation,
        outputTokens: cpOutput,
        cost: cpCost,
      });

      const beforePrompt = prevPromptTokens;
      const checkpointTokens = Math.max(0, officialStepTokens.get(s.stepIndex) || s.tokensEst || 0);

      // After compaction the model only receives the checkpoint summary plus
      // whatever arrived later, so all previous cumulative history is dropped.
      for (const key of Object.keys(cum)) cum[key] = 0;
      pendingInItems = [];
      prevComp = null;
      prevPromptTokens = 0;
      cum.injected += checkpointTokens;

      historyEpoch++;
      historyEpochRanges.push({ start: historyItems.length, epoch: historyEpoch });

      historyItems.push({
        kind: 'injected',
        stepIndex: s.stepIndex,
        turnIndex: s.turnIndex,
        createdAt: s.createdAt,
        tokens: checkpointTokens,
        title: 'Context Compaction Summary',
        body: s.content,
        rawBody: s.content,
        isCheckpoint: true,
      });

      // Checkpoint calls are billed but are not part of the planner timeline.
      billableBuckets.injected += s.totalPromptTokens;
      billableBuckets.assistant += s.outputTokens;

      events.push({
        type: 'compaction',
        label: 'Context Compaction',
        source: 'checkpoint',
        detail: beforePrompt > 0
          ? `Compacted from ${beforePrompt.toLocaleString()} to ${checkpointTokens.toLocaleString()} tokens`
          : `Compacted to ${checkpointTokens.toLocaleString()} tokens`,
        tokenDelta: checkpointTokens - beforePrompt,
        turnIndex: s.turnIndex,
        stepIndex: s.stepIndex,
        plannerSeq: Math.max(0, lastPlannerSeq),
        createdAt: s.createdAt,
      });

      pendingInItems.push({ kind: 'system', label: 'Context compaction' });
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'PLANNER_RESPONSE') {
      const plannerSeq = plannerSnapshots.length;
      lastPlannerSeq = plannerSeq;
      if (s.model) latestModel = s.model;

      totalInputTokens += s.inputTokens;
      totalCacheReadTokens += s.cacheReadTokens;
      totalOutputTokens += s.outputTokens;
      plannerInputTokens += s.inputTokens;
      plannerCacheReadTokens += s.cacheReadTokens;
      totalToolCalls += (s.toolCalls || []).length;

      // Prefer official streamingDuration + timeToFirstToken from language server.
      // When unavailable (e.g. standalone), estimate from next runtime step ONLY
      // — never include human reading/typing time before the next USER_INPUT.
      let modelDurMs = 0;
      let stepStreamingMs = 0;
      let stepStreamingExact = 0;
      let stepSpeedValid = false;
      let stepTtftMs = 0;
      const officialTiming = official?.timing?.byStep?.get(s.stepIndex) || null;
      if (officialTiming && officialTiming.totalMs > 0) {
        modelDurMs = officialTiming.totalMs;
        stepStreamingMs = officialTiming.streamingMs;
        stepStreamingExact = officialTiming.streamingMsExact ?? officialTiming.streamingMs ?? 0;
        stepSpeedValid = officialTiming.speedValid ?? (stepStreamingExact >= MIN_STREAM_MS && s.outputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED);
        stepTtftMs = officialTiming.ttftMs;
      } else {
        const nextStep = steps[i + 1];
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
      let stepTps = 0;
      if (stepSpeedValid) {
        totalStreamingMs += stepStreamingExact;
        totalStreamingOutputTokens += s.outputTokens;
        stepTps = Math.round((s.outputTokens / (stepStreamingExact / 1000)) * 10) / 10;
        latestStepSpeed = stepTps;
      } else if (modelDurMs >= MIN_STREAM_MS && s.outputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
        stepTps = Math.round((s.outputTokens / (modelDurMs / 1000)) * 10) / 10;
      }
      if (stepTtftMs > 0) {
        totalTtftMs += stepTtftMs;
        ttftSamples++;
      }

      // Detect compaction (significant prompt token drop)
      const flags = [];
      if (prevPromptTokens > 12_000 && s.totalPromptTokens > 0) {
        const drop = prevPromptTokens - s.totalPromptTokens;
        if (drop > 8_000 && drop / prevPromptTokens >= 0.25) {
          flags.push('compaction');
          events.push({
            type: 'compaction',
            label: 'Context Compaction',
            source: 'runtime',
            detail: `Prompt reduced from ${prevPromptTokens.toLocaleString()} to ${s.totalPromptTokens.toLocaleString()} tokens`,
            tokenDelta: -drop,
            turnIndex: s.turnIndex,
            stepIndex: s.stepIndex,
            plannerSeq,
            createdAt: s.createdAt,
          });
        }
      }

      if (s.modelSwitched) {
        flags.push('model_switch');
        events.push({
          type: 'model_switch',
          label: 'Model Switch',
          source: s.model,
          detail: `Switched to ${s.model}`,
          tokenDelta: 0,
          turnIndex: s.turnIndex,
          stepIndex: s.stepIndex,
          plannerSeq,
          createdAt: s.createdAt,
        });
      }

      // Compute aligned composition for THIS request (what was sent into the model)
      const visSum = cum.user + cum.injected + cum.skills + cum.thinking + cum.assistant + cum.tools + cum.media + cum.other;
      const effectivePrompt = s.totalPromptTokens > 0 ? s.totalPromptTokens : visSum;
      // The Current Context card and the Context Browser group the same way:
      // an assistant reply is one block (thinking + prose + tool-call
      // arguments), and only tool *results* count as tool context.
      const barCum = {
        ...cum,
        assistant: cum.assistant + cum.thinking + cum.toolCall,
        thinking: 0,
        tools: cum.toolResult,
      };
      const estimated = estimateComposition(barCum, effectivePrompt, official);
      let composition = estimated.composition;
      let estimatedBaseTokens = estimated.fixedApplied || composition.systemBase;

      // The language server only exposes a full breakdown for the latest
      // request, so use it verbatim for the newest snapshot.
      if (s.stepIndex === lastPlannerStepIndex && official?.hasBreakdown) {
        composition = officialCompositionWithSplit(official, {
          ...responseRatios,
          media: cum.media,
        });
        estimatedBaseTokens = officialFixedTotal;
      }

      const delta = prevComp
        ? {
            systemBase: composition.systemBase - prevComp.systemBase,
            toolDefs: composition.toolDefs - (prevComp.toolDefs || 0),
            user: composition.user - prevComp.user,
            injected: composition.injected - prevComp.injected,
            skills: composition.skills - prevComp.skills,
            assistant: composition.assistant - prevComp.assistant,
            thinking: composition.thinking - (prevComp.thinking || 0),
            tools: composition.tools - prevComp.tools,
            media: composition.media - (prevComp.media || 0),
            other: composition.other - (prevComp.other || 0),
            total: composition.total - prevComp.total,
          }
        : { ...composition };

      // Accumulate session billable category breakdown. The prompt part is
      // scaled back to the actual billed prompt, and the response part is
      // split by the transcript's thinking / answer / tool-call estimates.
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

      // Snapshot history index cutoff BEFORE this planner's own output
      const historyCountBefore = historyItems.length;

      // Record assistant turn into history for subsequent requests
      const assistantTokens = s.thinkingTokensEst + s.answerTokensEst + s.toolCallTokensEst;
      historyItems.push({
        kind: 'assistant',
        stepIndex: s.stepIndex,
        turnIndex: s.turnIndex,
        createdAt: s.createdAt,
        tokens: assistantTokens,
        thinkingTokens: s.thinkingTokensEst,
        answerTokens: s.answerTokensEst,
        toolCallTokens: s.toolCallTokensEst,
        hasThinking: s.hasThinking,
        hasAnswer: s.hasAnswer,
        hasTools: s.hasTools,
        thinking: s.thinking,
        answer: s.content,
        toolCalls: s.toolCalls.map(tc => ({ name: tc.name, args: tc.args, tokens: tc.argsTokensEst })),
        title: s.hasAnswer
          ? truncate(s.content, 90)
          : s.hasTools
            ? `Called ${s.toolCalls.map(t => t.name).join(', ')}`
            : truncate(s.thinking, 90) || 'Assistant response',
      });

      cum.thinking += s.thinkingTokensEst;
      cum.assistant += s.answerTokensEst;
      cum.tools += s.toolCallTokensEst;
      cum.toolCall += s.toolCallTokensEst;

      // Check skill flag on tool calls
      for (const tc of s.toolCalls || []) {
        if (tc.skill) {
          if (!flags.includes('skill')) flags.push('skill');
        }
      }

      const officialCall = official?.callsByStep?.get(s.stepIndex) || null;
      const callInput = officialCall ? officialCall.inputTokens : s.inputTokens;
      const callCacheRead = officialCall ? officialCall.cacheReadTokens : s.cacheReadTokens;
      const callCacheCreation = officialCall ? officialCall.cacheCreationTokens : 0;
      const callOutput = officialCall ? officialCall.outputTokens : s.outputTokens;
      const callTotalPrompt = callInput + callCacheRead + callCacheCreation;
      const reqCacheRate = callTotalPrompt > 0 ? callCacheRead / callTotalPrompt : 0;
      const callCacheStart = classifyCacheStart(reqCacheRate, callTotalPrompt);
      const callThinkingTokens = officialCall
        ? officialCall.thinkingOutputTokens
        : Math.min(s.outputTokens, s.thinkingTokensEst || 0);
      const callThinkingPct = callOutput > 0 && callThinkingTokens > 0
        ? Math.min(100, Math.round((callThinkingTokens / callOutput) * 100))
        : 0;
      const stepModelRaw = s.model || officialCall?.model || officialCall?.responseModel || '';
      const stepMeta = resolveModelMeta(stepModelRaw, { at: s.createdAt });
      const callCost = estimateStepCost(
        stepModelRaw || officialCall?.responseModel,
        callInput,
        callCacheRead,
        callOutput,
        { at: s.createdAt }
      ).cost;
      totalCost += callCost;
      const callTtftMs = officialCall ? officialCall.ttftMs : stepTtftMs;
      const callStreamExact = officialCall ? officialCall.streamingMsExact : stepStreamingExact;
      const callTotalMs = officialCall && officialCall.totalMs > 0 ? officialCall.totalMs : modelDurMs;
      const speedEval = evaluateCallSpeed(
        callOutput,
        callStreamExact > 0 ? callStreamExact : (officialCall ? 0 : callTotalMs)
      );
      const callStatus = officialCall?.hasError
        ? 'error'
        : (officialCall?.retries > 0 ? 'retry' : 'ok');

      let netDeltaTokens = null;
      if (callTotalPrompt > 0) {
        if (prevCallPromptTokens !== null) {
          netDeltaTokens = callTotalPrompt - prevCallPromptTokens;
        }
        prevCallPromptTokens = callTotalPrompt;
      }
      const isCompactionDrop = (netDeltaTokens !== null && netDeltaTokens <= -8000) || flags.includes('compaction');

      plannerSnapshots.push({
        seq: plannerSeq,
        stepIndex: s.stepIndex,
        turnIndex: s.turnIndex,
        createdAt: s.createdAt,
        model: s.model,
        actualModel: officialCall?.responseModel || s.model,
        rawModelId: officialCall?.model || s.model,
        executionModel: officialCall?.executionModel || '',
        callRole: 'direct',
        isRoleSwitch: false,
        switchDirection: '',
        isColdCacheSwitch: false,
        coldSwitchFreshInputTokens: 0,
        netDeltaTokens,
        isCompactionDrop,
        modelLabel: stepMeta.label,
        modelLabelZh: stepMeta.labelZh,
        modelQuotaPool: stepMeta.quotaPool,
        canonicalModelKey: stepMeta.canonicalKey,
        contextWindow: s.contextWindow,
        maxOutput: s.maxOutput,
        durationMs: modelDurMs,
        callDurationMs: callTotalMs,
        streamingMs: officialCall ? officialCall.streamingMs : stepStreamingMs,
        ttftMs: callTtftMs,
        tokensPerSec: stepTps,
        displayTokensPerSec: speedEval.displaySpeed,
        rawTokensPerSec: speedEval.rawSpeed,
        isShortSample: speedEval.isShortSample,
        callStatus,
        retries: officialCall?.retries || 0,
        errorMessage: officialCall?.errorMessage || '',
        actual: {
          inputTokens: callInput,
          cacheReadTokens: callCacheRead,
          cacheCreationTokens: callCacheCreation,
          outputTokens: callOutput,
          thinkingOutputTokens: callThinkingTokens,
          thinkingPct: callThinkingPct,
          totalPromptTokens: callTotalPrompt || s.totalPromptTokens,
          totalBillableTokens: callTotalPrompt + callOutput,
          cacheHitRate: reqCacheRate,
          cacheStart: callCacheStart,
          cost: callCost,
        },
        composition,
        delta,
        flags,
        brief: {
          user: truncate(currentUserText, 120),
          inItems: pendingInItems.slice(0, 6),
          responseText: truncate(s.content || s.thinking, 120),
          responseTools: (s.toolCalls || []).map(tc => tc.name),
        },
        historyCountBefore,
        historyCountAfter: historyItems.length,
        historyEpoch,
        estimatedBaseTokens,
      });

      pendingInItems = [];
      prevPromptTokens = s.totalPromptTokens > 0 ? s.totalPromptTokens : prevPromptTokens;
      prevComp = composition;
      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
      continue;
    }

    if (s.type === 'GENERIC') {
      const targetPlannerSeq = Math.max(0, lastPlannerSeq);
      if (s.durationMs > 0) totalToolDurationMs += s.durationMs;
      if (prevStepMs > 0 && s.createdMs > prevStepMs) {
        const gap = s.createdMs - prevStepMs;
        if (gap < 30_000) {
          totalOverheadMs += Math.max(0, gap - (s.durationMs || 0));
        }
      }

      if (s.isSkillLoad) {
        cum.skills += s.tokensEst || 0;
        historyItems.push({
          kind: 'skills',
          stepIndex: s.stepIndex,
          turnIndex: s.turnIndex,
          createdAt: s.createdAt,
          tokens: s.tokensEst || 0,
          skillName: s.skillName,
          skillPath: s.skillPath,
          toolName: s.toolName,
          toolArgs: s.toolArgs,
          title: `Skill: ${s.skillName}`,
          body: s.resultBody,
          rawBody: s.rawResult,
          lineCount: s.lineCount,
          isError: s.isError,
        });
        events.push({
          type: 'skill',
          label: `Skill Loaded: ${s.skillName}`,
          source: s.skillName,
          detail: s.skillPath,
          tokenDelta: s.tokensEst || 0,
          turnIndex: s.turnIndex,
          stepIndex: s.stepIndex,
          plannerSeq: targetPlannerSeq,
          createdAt: s.createdAt,
        });
      } else {
        cum.tools += s.tokensEst || 0;
        cum.toolResult += s.tokensEst || 0;
        historyItems.push({
          kind: 'tool_results',
          stepIndex: s.stepIndex,
          turnIndex: s.turnIndex,
          createdAt: s.createdAt,
          tokens: s.tokensEst || 0,
          toolName: s.toolName,
          toolArgs: s.toolArgs,
          title: s.toolName,
          body: s.resultBody,
          rawBody: s.rawResult,
          lineCount: s.lineCount,
          durationMs: s.durationMs,
          exitCode: s.exitCode,
          isError: s.isError,
        });
      }

      if (Array.isArray(s.media) && s.media.length > 0) {
        cum.media += s.mediaTokensEst || 0;
        for (const m of s.media) {
          const uri = localPathFromUri(m?.uri);
          let fileSize = 0;
          try {
            if (uri && existsSync(uri)) fileSize = statSync(uri).size;
          } catch {
            // ignore
          }
          const mime = String(m?.mime_type || 'application/octet-stream');
          const ext = extname(uri || '').toLowerCase();
          const mTok = mime.startsWith('image/')
            ? 258
            : mime.startsWith('video/')
              ? 1500
              : mime.startsWith('audio/')
                ? 600
                : 512;
          historyItems.push({
            kind: 'media',
            stepIndex: s.stepIndex,
            turnIndex: s.turnIndex,
            createdAt: s.createdAt,
            tokens: mTok,
            title: basename(uri.replace(/\\/g, '/')) || 'tool-media',
            mimeType: mime,
            ext,
            uri,
            fileSize,
          });
        }
      }

      if (s.isError && lastPlannerSeq >= 0) {
        const snap = plannerSnapshots[lastPlannerSeq];
        if (snap && !snap.flags.includes('error')) snap.flags.push('error');
      }

      pendingInItems.push({
        kind: s.isSkillLoad ? 'skill' : 'tool',
        label: s.isSkillLoad ? `Skill ${s.skillName}` : `${s.toolName}${s.isError ? ' (err)' : ''}`,
      });

      // Collect file operations
      for (const op of s.fileOps || []) {
        allFileOps.push({
          ...op,
          stepIndex: s.stepIndex,
          turnIndex: s.turnIndex,
          plannerSeq: targetPlannerSeq,
          createdAt: s.createdAt,
        });
      }

      // Collect command executions
      if (s.commandInfo) {
        allCommands.push({
          ...s.commandInfo,
          plannerSeq: targetPlannerSeq,
          outputPreview: truncate(s.resultBody, 240),
        });
      }

      prevStepMs = s.createdMs || prevStepMs;
      prevStepType = s.type;
    }
  }

  // Two-pass Orchestrator / Executor role attribution & cold-cache switch detection
  if (plannerSnapshots.length > 0) {
    const planIds = new Set();
    const execIds = new Set();
    let hasPlanHandoffTools = false;

    const addModelKeys = (set, snap) => {
      for (const k of [snap?.rawModelId, snap?.actualModel, snap?.model]) {
        const clean = String(k || '').trim();
        if (clean) set.add(clean);
      }
    };
    const matchesSet = (set, snap) =>
      [snap?.rawModelId, snap?.actualModel, snap?.model].some(k => {
        const clean = String(k || '').trim();
        return clean && set.has(clean);
      });

    for (let i = 0; i < plannerSnapshots.length; i++) {
      const snap = plannerSnapshots[i];
      const tools = snap.brief?.responseTools || [];
      if (tools.includes('exit_plan_mode')) {
        hasPlanHandoffTools = true;
        addModelKeys(planIds, snap);
        if (i + 1 < plannerSnapshots.length && plannerSnapshots[i + 1].turnIndex === snap.turnIndex) {
          addModelKeys(execIds, plannerSnapshots[i + 1]);
        }
      }
      if (tools.includes('enter_plan_mode')) {
        hasPlanHandoffTools = true;
        addModelKeys(execIds, snap);
        if (i + 1 < plannerSnapshots.length && plannerSnapshots[i + 1].turnIndex === snap.turnIndex) {
          addModelKeys(planIds, plannerSnapshots[i + 1]);
        }
      }
      if (snap.executionModel) {
        execIds.add(snap.executionModel);
        if (snap.rawModelId && snap.rawModelId !== snap.executionModel) {
          addModelKeys(planIds, snap);
        }
      }
      if (LEGACY_ORCHESTRATOR_PLANNER_IDS.has(snap.rawModelId)) {
        addModelKeys(planIds, snap);
      }
      if (LEGACY_ORCHESTRATOR_EXECUTOR_IDS.has(snap.rawModelId)) {
        addModelKeys(execIds, snap);
      }
    }

    const hasPlanExecute = planIds.size > 0 || execIds.size > 0 || hasPlanHandoffTools;
    if (hasPlanExecute) {
      let phase = 'orchestrator';
      let prevTurnIndex = null;
      let prevRole = null;

      for (let i = 0; i < plannerSnapshots.length; i++) {
        const snap = plannerSnapshots[i];
        if (prevTurnIndex !== null && snap.turnIndex !== prevTurnIndex) {
          phase = 'orchestrator';
        }
        const tools = snap.brief?.responseTools || [];
        const inPlan = matchesSet(planIds, snap);
        const inExec = matchesSet(execIds, snap);

        let role = 'direct';
        if (LEGACY_ORCHESTRATOR_PLANNER_IDS.has(snap.rawModelId)) {
          role = 'orchestrator';
        } else if (LEGACY_ORCHESTRATOR_EXECUTOR_IDS.has(snap.rawModelId)) {
          role = 'executor';
        } else if (tools.includes('exit_plan_mode')) {
          role = 'orchestrator';
        } else if (tools.includes('enter_plan_mode')) {
          role = 'executor';
        } else if (inExec && !inPlan) {
          role = 'executor';
        } else if (inPlan && !inExec) {
          role = 'orchestrator';
        } else if (snap.rawModelId && snap.executionModel && snap.rawModelId !== snap.executionModel) {
          role = 'orchestrator';
        } else if (hasPlanHandoffTools) {
          role = phase;
        } else if (execIds.size > 0 && snap.rawModelId && !inExec) {
          role = 'orchestrator';
        }

        snap.callRole = role;
        if (prevRole !== null && prevRole !== role) {
          if (prevRole === 'orchestrator' && role === 'executor') {
            snap.isRoleSwitch = true;
            snap.switchDirection = 'orchestrator_to_executor';
          } else if (prevRole === 'executor' && role === 'orchestrator') {
            snap.isRoleSwitch = true;
            snap.switchDirection = 'executor_to_orchestrator';
          }
          if (
            snap.isRoleSwitch &&
            (snap.actual?.cacheReadTokens || 0) === 0 &&
            (snap.actual?.totalPromptTokens || 0) > 0
          ) {
            snap.isColdCacheSwitch = true;
            snap.coldSwitchFreshInputTokens = snap.actual?.inputTokens || 0;
          }
        }

        if (tools.includes('exit_plan_mode')) {
          phase = 'executor';
        } else if (tools.includes('enter_plan_mode')) {
          phase = 'orchestrator';
        }
        prevTurnIndex = snap.turnIndex;
        prevRole = role;
      }
    }
  }

  const modelUsage = computeModelUsage(plannerSnapshots, checkpointRecords, lastMs);

  // Mark slowest and largest_growth flags across planner snapshots
  if (plannerSnapshots.length > 1) {
    let slowestIdx = -1;
    let maxDur = 0;
    let largestGrowthIdx = -1;
    let maxGrowth = 0;
    for (let i = 0; i < plannerSnapshots.length; i++) {
      const sn = plannerSnapshots[i];
      if (sn.durationMs > maxDur) {
        maxDur = sn.durationMs;
        slowestIdx = i;
      }
      if (i > 0 && sn.delta.total > maxGrowth) {
        maxGrowth = sn.delta.total;
        largestGrowthIdx = i;
      }
    }
    if (slowestIdx >= 0 && maxDur >= 3000) {
      plannerSnapshots[slowestIdx].flags.push('slowest');
    }
    if (largestGrowthIdx >= 0 && maxGrowth >= 2000) {
      plannerSnapshots[largestGrowthIdx].flags.push('largest_growth');
    }
  }

  // Build Turn-level aggregated timeline
  const turnMap = new Map();
  for (const sn of plannerSnapshots) {
    let t = turnMap.get(sn.turnIndex);
    if (!t) {
      t = {
        turnIndex: sn.turnIndex,
        firstSeq: sn.seq,
        lastSeq: sn.seq,
        stepIndex: sn.stepIndex,
        createdAt: sn.createdAt,
        model: sn.model,
        modelLabel: sn.modelLabel,
        contextWindow: sn.contextWindow,
        requestsCount: 0,
        durationMs: 0,
        actual: {
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          totalPromptTokens: 0,
          totalBillableTokens: 0,
          cacheHitRate: 0,
          cost: 0,
        },
        composition: sn.composition,
        delta: { systemBase: 0, toolDefs: 0, user: 0, injected: 0, skills: 0, assistant: 0, tools: 0, total: 0 },
        flags: new Set(),
        brief: sn.brief,
      };
      turnMap.set(sn.turnIndex, t);
    }
    t.lastSeq = sn.seq;
    t.stepIndex = sn.stepIndex;
    t.model = sn.model;
    t.modelLabel = sn.modelLabel;
    t.requestsCount++;
    t.durationMs += sn.durationMs;
    t.actual.inputTokens += sn.actual.inputTokens;
    t.actual.cacheReadTokens += sn.actual.cacheReadTokens;
    t.actual.outputTokens += sn.actual.outputTokens;
    t.actual.totalPromptTokens = sn.actual.totalPromptTokens;
    t.actual.totalBillableTokens += sn.actual.totalBillableTokens;
    t.actual.cost += sn.actual.cost;
    t.composition = sn.composition;
    for (const f of sn.flags) t.flags.add(f);
    t.brief = sn.brief;
  }

  const turns = [];
  let prevTurnComp = null;
  for (const t of turnMap.values()) {
    const tp = t.actual.inputTokens + t.actual.cacheReadTokens;
    t.actual.cacheHitRate = tp > 0 ? t.actual.cacheReadTokens / tp : 0;
    t.delta = prevTurnComp
      ? {
          systemBase: t.composition.systemBase - prevTurnComp.systemBase,
          toolDefs: t.composition.toolDefs - (prevTurnComp.toolDefs || 0),
          user: t.composition.user - prevTurnComp.user,
          injected: t.composition.injected - prevTurnComp.injected,
          skills: t.composition.skills - prevTurnComp.skills,
          assistant: t.composition.assistant - prevTurnComp.assistant,
          thinking: t.composition.thinking - (prevTurnComp.thinking || 0),
          tools: t.composition.tools - prevTurnComp.tools,
          media: t.composition.media - (prevTurnComp.media || 0),
          other: t.composition.other - (prevTurnComp.other || 0),
          total: t.composition.total - prevTurnComp.total,
        }
      : { ...t.composition };
    prevTurnComp = t.composition;
    turns.push({ ...t, flags: [...t.flags] });
  }

  const latestSnapForMeta = plannerSnapshots[plannerSnapshots.length - 1] || null;
  const latestOrchSnap = [...plannerSnapshots].reverse().find(sn => sn.callRole === 'orchestrator') || null;
  const primaryModelId = (latestSnapForMeta?.callRole === 'executor' && latestOrchSnap?.model)
    ? latestOrchSnap.model
    : (latestModel || latestSnapForMeta?.rawModelId || '');
  const spec = resolveModelMeta(primaryModelId, { at: lastMs || Date.now() });
  const plannerPromptAll = plannerInputTokens + plannerCacheReadTokens;
  const cacheHitRate = official?.cache?.totalPromptTokens > 0
    ? official.cache.cacheHitRate
    : (plannerPromptAll > 0 ? plannerCacheReadTokens / plannerPromptAll : 0);
  const totalSpanMs = firstMs > 0 && lastMs >= firstMs ? Math.min(lastMs - firstMs, 60_000) : 0;
  const overheadMs = totalOverheadMs;
  const totalActiveMs =
    totalModelDurationMs + totalToolDurationMs + overheadMs > 0
      ? totalModelDurationMs + totalToolDurationMs + overheadMs
      : totalSpanMs;
  const officialTotals = official?.timing?.totals || null;
  const effectiveStreamMs = totalStreamingMs > 0
    ? totalStreamingMs
    : (officialTotals?.streamingMsExact || officialTotals?.streamingMs || 0);
  const effectiveStreamOut = totalStreamingMs > 0 ? totalStreamingOutputTokens : (officialTotals?.streamingOutputTokens || 0);
  const effectiveTtftMs = ttftSamples > 0 ? totalTtftMs : (officialTotals?.ttftMs || 0);
  const effectiveTtftSamples = ttftSamples > 0 ? ttftSamples : (officialTotals?.ttftSamples || 0);
  const endToEndTokensPerSec = totalModelDurationMs > 0
    ? Math.round((totalOutputTokens / (totalModelDurationMs / 1000)) * 10) / 10
    : 0;
  const hasStreamingSpeed = effectiveStreamMs >= MIN_STREAM_MS && effectiveStreamOut >= MIN_OUTPUT_TOKENS_FOR_SPEED;
  const outputTokensPerSec = hasStreamingSpeed
    ? Math.round((effectiveStreamOut / (effectiveStreamMs / 1000)) * 10) / 10
    : endToEndTokensPerSec;
  const latestOutputTokensPerSec = officialTotals?.latestOutputTokensPerSec || latestStepSpeed || outputTokensPerSec;
  const avgTtftMs = effectiveTtftSamples > 0 ? Math.round(effectiveTtftMs / effectiveTtftSamples) : 0;
  const speedSource = hasStreamingSpeed ? 'streaming' : 'estimated';

  const toolCountMap = new Map();
  for (const sn of plannerSnapshots) {
    for (const tn of sn.brief?.responseTools || []) {
      toolCountMap.set(tn, (toolCountMap.get(tn) || 0) + 1);
    }
  }
  const topTools = [...toolCountMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const eventsSummary = { injection: 0, compaction: 0, skill: 0, model_switch: 0, error: 0 };
  for (const ev of events) {
    if (eventsSummary[ev.type] !== undefined) eventsSummary[ev.type]++;
  }

  const fileOpCounts = { read: 0, written: 0, searched: 0, images: 0 };
  for (const op of allFileOps) {
    if (fileOpCounts[op.kind] !== undefined) fileOpCounts[op.kind]++;
  }

  // Align browser item tokens with the official per-step chat breakdown.
  // The language server reports exact tokens for the current context only.
  for (let r = 0; r < historyEpochRanges.length; r++) {
    const range = historyEpochRanges[r];
    const end = r + 1 < historyEpochRanges.length ? historyEpochRanges[r + 1].start : historyItems.length;
    for (let i = range.start; i < end; i++) {
      historyItems[i].epoch = range.epoch;
    }
  }

  if (officialStepTokens.size > 0) {
    const itemsByStep = new Map();
    for (const item of historyItems) {
      if (!officialStepTokens.has(item.stepIndex)) continue;
      if (!itemsByStep.has(item.stepIndex)) itemsByStep.set(item.stepIndex, []);
      itemsByStep.get(item.stepIndex).push(item);
    }
    for (const [stepIndex, items] of itemsByStep) {
      const target = officialStepTokens.get(stepIndex) || 0;
      const current = items.reduce((acc, item) => acc + (item.tokens || 0), 0);
      if (target <= 0 || current <= 0) continue;
      const scale = target / current;
      let assigned = 0;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const isLast = index === items.length - 1;
        const tokens = isLast
          ? Math.max(0, target - assigned)
          : Math.max(0, Math.round((item.tokens || 0) * scale));
        item.tokens = tokens;
        assigned += tokens;
      }
    }
  }

  const latestSnap = plannerSnapshots[plannerSnapshots.length - 1] || null;
  if (latestSnap && official?.hasBreakdown && latestSnap.composition) {
    const latestEpoch = latestSnap.historyEpoch ?? 0;
    const mediaTokens = historyItems
      .filter(item => item.kind === 'media' && (item.epoch ?? 0) === latestEpoch)
      .reduce((acc, item) => acc + (item.tokens || 0), 0);
    const mediaDelta = mediaTokens - (latestSnap.composition.media || 0);
    if (mediaDelta > 0) {
      const moved = Math.min(mediaDelta, latestSnap.composition.tools || 0);
      latestSnap.composition.tools -= moved;
      latestSnap.composition.media += moved;
      latestSnap.delta.tools += moved * -1;
      latestSnap.delta.media = (latestSnap.delta.media || 0) + moved;
    }
  }
  const compactedAfterLatestPlanner = lastCheckpointStepIndex > lastPlannerStepIndex;
  const firstUserItem = historyItems.find(h => h.kind === 'user');
  const effectiveWindow = official?.maxContextTokens || latestSnap?.contextWindow || spec.contextWindow;
  const nativeWindow = Math.max(official?.nativeContextWindow || 0, spec.contextWindow, effectiveWindow);
  let currentComposition;
  let currentUsedTokens;
  let currentActual;

  if (compactedAfterLatestPlanner) {
    const postCompactBarCum = {
      ...cum,
      assistant: cum.assistant + cum.thinking + cum.toolCall,
      thinking: 0,
      tools: cum.toolResult,
    };
    const postCompactVisSum =
      postCompactBarCum.user +
      postCompactBarCum.injected +
      postCompactBarCum.skills +
      postCompactBarCum.assistant +
      postCompactBarCum.tools +
      postCompactBarCum.media +
      postCompactBarCum.other;
    const baseForPostCompact = officialFixedTotal > 0 ? officialFixedTotal : (latestSnap?.estimatedBaseTokens || 0);
    const postCompactTotal = baseForPostCompact + postCompactVisSum;
    currentComposition = estimateComposition(postCompactBarCum, postCompactTotal, official).composition;
    currentUsedTokens = currentComposition.total;
    currentActual = {
      inputTokens: currentUsedTokens,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalPromptTokens: currentUsedTokens,
      totalBillableTokens: currentUsedTokens,
      cacheHitRate: 0,
      cost: 0,
    };
  } else {
    currentComposition = latestSnap?.composition
      || {
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
    currentUsedTokens = official?.usedTokens || currentComposition.total || 0;
    const officialUsage = official?.usage;
    currentActual = officialUsage && officialUsage.totalPromptTokens > 0
      ? {
          inputTokens: officialUsage.inputTokens,
          cacheReadTokens: officialUsage.cacheReadTokens,
          outputTokens: officialUsage.outputTokens,
          totalPromptTokens: officialUsage.totalPromptTokens,
          totalBillableTokens: officialUsage.totalBillableTokens,
          cacheHitRate: officialUsage.totalPromptTokens > 0
            ? officialUsage.cacheReadTokens / officialUsage.totalPromptTokens
            : 0,
          cost: latestSnap?.actual.cost || 0,
        }
      : (latestSnap?.actual || {
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          totalPromptTokens: 0,
          totalBillableTokens: 0,
          cacheHitRate: 0,
          cost: 0,
        });
  }

  return {
    id: convId,
    mtimeMs: parsed.mtimeMs,
    size: parsed.size,
    isFullTranscript: parsed.isFull,
    meta: {
      id: convId,
      title: meta?.title || firstUserItem?.title || convId.slice(0, 8),
      workspaceName: meta?.workspaceName || 'Workspace',
      workspacePath: meta?.workspacePath || '',
      status: meta?.status || '',
      model: primaryModelId || 'unknown',
      modelLabel: spec.label,
      modelLabelZh: spec.labelZh,
      contextWindow: effectiveWindow,
      nativeContextWindow: nativeWindow,
      contextSource: official?.hasBreakdown ? 'official' : (official ? 'official-usage' : 'transcript'),
      maxOutput: spec.maxOutput,
      pricing: {
        inputPerM: spec.inputPerM,
        cacheReadPerM: spec.cacheReadPerM,
        outputPerM: spec.outputPerM,
        isFallback: Boolean(spec.isFallback),
      },
      firstMs,
      lastMs,
    },
    stats: {
      context: {
        turns: turns.length || (userInputsCount > 0 ? userInputsCount : 0),
        requests: plannerSnapshots.length,
        checkpoints: checkpointCount,
        totalSteps: steps.length,
        userInputs: userInputsCount,
        toolCalls: totalToolCalls,
        skillsLoaded: eventsSummary.skill,
        eventsSummary,
        topTools,
        fileOps: fileOpCounts,
        cost: totalCost,
      },
      tokens: {
        billableTotal: totalInputTokens + totalCacheReadTokens + totalOutputTokens,
        inputTokens: totalInputTokens,
        cacheReadTokens: totalCacheReadTokens,
        cacheCreationTokens: official?.cache?.cacheCreationTokens || 0,
        outputTokens: totalOutputTokens,
        cacheHitRate,
        buckets: billableBuckets,
      },
      timing: {
        modelMs: totalModelDurationMs,
        toolMs: totalToolDurationMs,
        overheadMs,
        totalActiveMs,
        streamingMs: Math.round(effectiveStreamMs),
        ttftMs: effectiveTtftMs,
        avgTtftMs,
        outputTokensPerSec,
        latestOutputTokensPerSec,
        endToEndTokensPerSec,
        speedSource,
      },
    },
    currentContext: {
      composition: currentComposition,
      contextWindow: effectiveWindow,
      nativeContextWindow: nativeWindow,
      maxOutput: latestSnap?.maxOutput || spec.maxOutput,
      autocompactReserve: 0,
      usagePct: effectiveWindow > 0 ? (currentUsedTokens / effectiveWindow) * 100 : 0,
      nativeUsagePct: nativeWindow > 0 ? (currentUsedTokens / nativeWindow) * 100 : 0,
      actual: currentActual,
      official: official
        ? {
            source: official.source,
            hasBreakdown: official.hasBreakdown,
            usedTokens: official.usedTokens,
            maxContextTokens: official.maxContextTokens,
            nativeContextWindow: official.nativeContextWindow,
            fixed: officialFixed,
            chat: official.chat,
            checkpoints: official.checkpoints,
            sections: (official.sections || []).map(section => ({
              title: section.title,
              tokenType: section.tokenType,
              sourceType: section.sourceType,
              tokens: section.tokens,
              estimated: section.estimated,
            })),
            tools: (official.tools || []).map(tool => ({
              name: tool.name,
              tokens: tool.tokens,
              estimated: tool.estimated,
            })),
          }
        : null,
    },
    timeline: {
      steps: plannerSnapshots,
      turns,
    },
    modelUsage,
    events,
    allFileOps,
    allCommands,
    historyItems,
    // Kept internal for getStepBrowser(); getOverview() intentionally does not
    // serialize the full prompt sections and tool schemas on every poll.
    _officialFull: official,
    _compactedAfterLatestPlanner: compactedAfterLatestPlanner,
    _latestHistoryEpoch: historyEpoch,
  };
}

function createEmptyRoleBucket() {
  return {
    calls: 0,
    models: [],
    labelsEn: [],
    labelsZh: [],
    primaryLabelEn: '',
    primaryLabelZh: '',
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalPromptTokens: 0,
    totalTokens: 0,
    cacheHitRate: null,
    cost: 0,
  };
}

function computeModelUsage(plannerSnapshots, checkpointRecords, lastMs) {
  const byModelMap = new Map();
  const roleBuckets = {
    orchestrator: createEmptyRoleBucket(),
    executor: createEmptyRoleBucket(),
    direct: createEmptyRoleBucket(),
  };
  const compactionBucket = createEmptyRoleBucket();
  const compactionModelCounts = new Map();
  const roleModelCounts = {
    orchestrator: new Map(),
    executor: new Map(),
    direct: new Map(),
  };
  let roleSwitchCount = 0;
  let coldCacheSwitchCount = 0;
  let coldCacheSwitchInputTokens = 0;
  let totalCallsCost = 0;
  let latestOrchModel = '';
  let latestExecModel = '';
  let latestExplicitExec = '';

  for (const sn of plannerSnapshots) {
    const a = sn.actual || {};
    const freshIn = Math.max(0, Number(a.inputTokens) || 0);
    const cacheRead = Math.max(0, Number(a.cacheReadTokens) || 0);
    const cacheCreate = Math.max(0, Number(a.cacheCreationTokens) || 0);
    const out = Math.max(0, Number(a.outputTokens) || 0);
    const think = Math.max(0, Number(a.thinkingOutputTokens) || 0);
    const totalPrompt = freshIn + cacheRead + cacheCreate;
    const totalTok = totalPrompt + out;
    const cost = Math.max(0, Number(a.cost) || 0);
    totalCallsCost += cost;

    const rawModelId = sn.model || sn.rawModelId || sn.actualModel || 'unknown';
    const canonicalKey = sn.canonicalModelKey || rawModelId;
    const labelEn = sn.modelLabel || sn.actualModel || rawModelId;
    const labelZh = sn.modelLabelZh || labelEn;
    const quotaPool = sn.modelQuotaPool || 'other';
    const role = sn.callRole === 'orchestrator' || sn.callRole === 'executor' ? sn.callRole : 'direct';

    if (role === 'orchestrator' && rawModelId && rawModelId !== 'unknown') latestOrchModel = rawModelId;
    if (role === 'executor' && rawModelId && rawModelId !== 'unknown') latestExecModel = rawModelId;
    if (sn.executionModel) latestExplicitExec = sn.executionModel;

    if (sn.isRoleSwitch) roleSwitchCount++;
    if (sn.isColdCacheSwitch) {
      coldCacheSwitchCount++;
      coldCacheSwitchInputTokens += sn.coldSwitchFreshInputTokens || 0;
    }

    // Aggregate per-model
    let modelRow = byModelMap.get(canonicalKey);
    if (!modelRow) {
      modelRow = {
        model: rawModelId,
        canonicalKey,
        labelEn,
        labelZh,
        quotaPool,
        roles: new Set(),
        calls: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        totalPromptTokens: 0,
        totalTokens: 0,
        cacheHitRate: null,
        cost: 0,
      };
      byModelMap.set(canonicalKey, modelRow);
    }
    modelRow.roles.add(role);
    modelRow.calls++;
    modelRow.inputTokens += freshIn;
    modelRow.cacheReadTokens += cacheRead;
    modelRow.cacheCreationTokens += cacheCreate;
    modelRow.outputTokens += out;
    modelRow.thinkingTokens += think;
    modelRow.totalPromptTokens += totalPrompt;
    modelRow.totalTokens += totalTok;
    modelRow.cost += cost;

    // Aggregate per-role
    const rb = roleBuckets[role];
    const rc = roleModelCounts[role];
    if (!rb.models.includes(canonicalKey)) {
      rb.models.push(canonicalKey);
      rb.labelsEn.push(labelEn);
      rb.labelsZh.push(labelZh);
    }
    const prevCnt = rc.get(canonicalKey)?.count || 0;
    rc.set(canonicalKey, { count: prevCnt + 1, labelEn, labelZh });
    rb.calls++;
    rb.inputTokens += freshIn;
    rb.cacheReadTokens += cacheRead;
    rb.cacheCreationTokens += cacheCreate;
    rb.outputTokens += out;
    rb.thinkingTokens += think;
    rb.totalPromptTokens += totalPrompt;
    rb.totalTokens += totalTok;
    rb.cost += cost;
  }

  for (const role of ['orchestrator', 'executor', 'direct']) {
    const rb = roleBuckets[role];
    rb.cacheHitRate = rb.totalPromptTokens > 0
      ? Math.max(0, Math.min(1, rb.cacheReadTokens / rb.totalPromptTokens))
      : null;
    let bestCount = -1;
    let bestEn = '';
    let bestZh = '';
    for (const info of roleModelCounts[role].values()) {
      if (info.count >= bestCount) {
        bestCount = info.count;
        bestEn = info.labelEn;
        bestZh = info.labelZh;
      }
    }
    rb.primaryLabelEn = bestEn;
    rb.primaryLabelZh = bestZh;
  }

  const byModel = [...byModelMap.values()]
    .map(row => ({
      model: row.model,
      canonicalKey: row.canonicalKey,
      labelEn: row.labelEn,
      labelZh: row.labelZh,
      quotaPool: row.quotaPool,
      roles: [...row.roles],
      calls: row.calls,
      inputTokens: row.inputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      outputTokens: row.outputTokens,
      thinkingTokens: row.thinkingTokens,
      totalPromptTokens: row.totalPromptTokens,
      totalTokens: row.totalTokens,
      cacheHitRate: row.totalPromptTokens > 0
        ? Math.max(0, Math.min(1, row.cacheReadTokens / row.totalPromptTokens))
        : null,
      cost: row.cost,
    }))
    .sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens || b.calls - a.calls);

  const orch = roleBuckets.orchestrator;
  const exec = roleBuckets.executor;
  const hasOrchestration = orch.calls > 0 || exec.calls > 0;

  let route = null;
  let orchestratorSplit = null;

  if (hasOrchestration) {
    const localCfg = readLocalOrchestratorConfigFallback();
    const routePlannerId = latestOrchModel || localCfg?.planModel || '';
    const routeExecutorId = latestExecModel || latestExplicitExec || localCfg?.executionModel || '';

    if (routePlannerId && routeExecutorId) {
      const pMeta = resolveModelMeta(routePlannerId, { at: lastMs || Date.now() });
      const eMeta = resolveModelMeta(routeExecutorId, { at: lastMs || Date.now() });
      if (!orch.primaryLabelEn) {
        orch.primaryLabelEn = pMeta.labelEn;
        orch.primaryLabelZh = pMeta.labelZh;
      }
      if (!exec.primaryLabelEn) {
        exec.primaryLabelEn = eMeta.labelEn;
        exec.primaryLabelZh = eMeta.labelZh;
      }
      const isCrossPool = Boolean(
        pMeta.quotaPool &&
        eMeta.quotaPool &&
        pMeta.quotaPool !== 'other' &&
        eMeta.quotaPool !== 'other' &&
        pMeta.quotaPool !== eMeta.quotaPool
      );
      route = {
        plannerModel: routePlannerId,
        executorModel: routeExecutorId,
        plannerLabelEn: pMeta.labelEn,
        plannerLabelZh: pMeta.labelZh,
        executorLabelEn: eMeta.labelEn,
        executorLabelZh: eMeta.labelZh,
        plannerPool: pMeta.quotaPool,
        executorPool: eMeta.quotaPool,
        isCrossPool,
      };
    }

    const pKey = orch.models[0] || (route ? resolveModelMeta(route.plannerModel).canonicalKey : '');
    const eKey = exec.models[0] || (route ? resolveModelMeta(route.executorModel).canonicalKey : '');
    const isSameModelOrchestrated = Boolean(
      (orch.models.length === 1 && exec.models.length === 1 && orch.models[0] === exec.models[0]) ||
      (orch.models.length === 1 && exec.calls === 0 && pKey && eKey && pKey === eKey)
    );
    const hasMidConversationReconfig = orch.models.length > 1 || exec.models.length > 1;
    const isMultiModelOrchestrated = (orch.calls > 0 && exec.calls > 0) || byModel.length >= 2;

    orchestratorSplit = {
      isMultiModelOrchestrated,
      isSameModelOrchestrated,
      hasMidConversationReconfig,
      isCrossPool: Boolean(route?.isCrossPool),
      distinctModelCount: byModel.length,
      orchestrator: orch,
      executor: exec,
      direct: roleBuckets.direct.calls > 0 ? roleBuckets.direct : null,
      compaction: compactionBucket.calls > 0 ? compactionBucket : null,
      totalCalls: plannerSnapshots.length + compactionBucket.calls,
      totalCost: totalCallsCost + compactionBucket.cost,
      roleSwitchCount,
      coldCacheSwitchCount,
      coldCacheSwitchInputTokens,
    };
  }

  for (const cp of checkpointRecords || []) {
    const freshIn = Math.max(0, Number(cp.inputTokens) || 0);
    const cacheRead = Math.max(0, Number(cp.cacheReadTokens) || 0);
    const cacheCreate = Math.max(0, Number(cp.cacheCreationTokens) || 0);
    const out = Math.max(0, Number(cp.outputTokens) || 0);
    const totalPrompt = freshIn + cacheRead + cacheCreate;
    const totalTok = totalPrompt + out;
    const cpCost = Math.max(0, Number(cp.cost) || 0);
    const key = cp.canonicalModelKey || cp.model || 'checkpoint';
    const labelEn = cp.labelEn || cp.model || 'Checkpoint';
    const labelZh = cp.labelZh || labelEn;

    if (!compactionBucket.models.includes(key)) {
      compactionBucket.models.push(key);
      compactionBucket.labelsEn.push(labelEn);
      compactionBucket.labelsZh.push(labelZh);
    }
    const prevCnt = compactionModelCounts.get(key)?.count || 0;
    compactionModelCounts.set(key, { count: prevCnt + 1, labelEn, labelZh });
    compactionBucket.calls++;
    compactionBucket.inputTokens += freshIn;
    compactionBucket.cacheReadTokens += cacheRead;
    compactionBucket.cacheCreationTokens += cacheCreate;
    compactionBucket.outputTokens += out;
    compactionBucket.totalPromptTokens += totalPrompt;
    compactionBucket.totalTokens += totalTok;
    compactionBucket.cost += cpCost;
  }

  if (compactionBucket.calls > 0) {
    compactionBucket.cacheHitRate = compactionBucket.totalPromptTokens > 0
      ? Math.max(0, Math.min(1, compactionBucket.cacheReadTokens / compactionBucket.totalPromptTokens))
      : null;
    let bestCnt = -1;
    let bestEn = '';
    let bestZh = '';
    for (const info of compactionModelCounts.values()) {
      if (info.count >= bestCnt) {
        bestCnt = info.count;
        bestEn = info.labelEn;
        bestZh = info.labelZh;
      }
    }
    compactionBucket.primaryLabelEn = bestEn;
    compactionBucket.primaryLabelZh = bestZh;
    if (orchestratorSplit) {
      orchestratorSplit.compaction = compactionBucket;
      orchestratorSplit.totalCalls = plannerSnapshots.length + compactionBucket.calls;
      orchestratorSplit.totalCost = totalCallsCost + compactionBucket.cost;
    }
  }

  return {
    totalCost: totalCallsCost + compactionBucket.cost,
    compaction: compactionBucket.calls > 0 ? compactionBucket : null,
    route,
    orchestratorSplit,
    byModel,
  };
}

function summarizeFileActivity(allFileOps, maxPlannerSeq) {
  const filtered =
    typeof maxPlannerSeq === 'number' && maxPlannerSeq >= 0
      ? allFileOps.filter(op => op.plannerSeq <= maxPlannerSeq)
      : allFileOps;

  const byFile = new Map();
  const counts = { read: 0, written: 0, searched: 0, images: 0, addedLines: 0, removedLines: 0 };

  for (const op of filtered) {
    if (counts[op.kind] !== undefined) counts[op.kind]++;
    counts.addedLines += op.addedLines || 0;
    counts.removedLines += op.removedLines || 0;

    const key = op.path;
    let entry = byFile.get(key);
    if (!entry) {
      entry = {
        path: key,
        name: basename(key.replace(/\\/g, '/')) || key,
        read: 0,
        written: 0,
        searched: 0,
        images: 0,
        addedLines: 0,
        removedLines: 0,
        totalOps: 0,
        lastStepIndex: op.stepIndex,
        operations: [],
      };
      byFile.set(key, entry);
    }
    if (entry[op.kind] !== undefined) entry[op.kind]++;
    entry.addedLines += op.addedLines || 0;
    entry.removedLines += op.removedLines || 0;
    entry.totalOps++;
    entry.lastStepIndex = Math.max(entry.lastStepIndex, op.stepIndex);
    entry.operations.push({
      kind: op.kind,
      tool: op.tool,
      stepIndex: op.stepIndex,
      plannerSeq: op.plannerSeq,
      addedLines: op.addedLines || 0,
      removedLines: op.removedLines || 0,
      createdAt: op.createdAt,
    });
  }

  const files = [...byFile.values()].sort((a, b) => b.totalOps - a.totalOps || a.name.localeCompare(b.name));
  return {
    counts,
    totalFiles: files.length,
    files,
  };
}

function summarizeCommands(allCommands) {
  const progMap = new Map();
  let succeeded = 0;
  let failed = 0;
  let totalDurationMs = 0;
  let slowest = null;

  for (const cmd of allCommands) {
    if (cmd.isError) failed++;
    else succeeded++;
    totalDurationMs += cmd.durationMs || 0;
    if (!slowest || (cmd.durationMs || 0) > (slowest.durationMs || 0)) {
      slowest = cmd;
    }

    const p = cmd.program || 'shell';
    let entry = progMap.get(p);
    if (!entry) {
      entry = { name: p, count: 0, failed: 0, totalDurationMs: 0 };
      progMap.set(p, entry);
    }
    entry.count++;
    if (cmd.isError) entry.failed++;
    entry.totalDurationMs += cmd.durationMs || 0;
  }

  const programs = [...progMap.values()]
    .map(p => ({ ...p, avgMs: p.count > 0 ? Math.round(p.totalDurationMs / p.count) : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    summary: {
      total: allCommands.length,
      succeeded,
      failed,
      totalDurationMs,
      avgDurationMs: allCommands.length > 0 ? Math.round(totalDurationMs / allCommands.length) : 0,
    },
    notable: {
      slowest: slowest ? { program: slowest.program, durationMs: slowest.durationMs, stepIndex: slowest.stepIndex, plannerSeq: slowest.plannerSeq, commandLine: truncate(slowest.commandLine, 80) } : null,
      failedCount: failed,
    },
    programs,
    items: allCommands,
  };
}

export class SessionDetailStore {
  constructor() {
    this.lru = new Map(); // convId -> analyzed session
  }

  async load(convId, meta, options = {}) {
    const force = Boolean(options?.force);
    const { path: filePath, isFull } = getTranscriptPaths(convId);
    if (!filePath) return null;

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return null;
    }

    const cached = this.lru.get(convId);
    if (!force && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      // Refresh LRU recency
      this.lru.delete(convId);
      this.lru.set(convId, cached);
      return cached;
    }

    const parsed = parseTranscriptFile(filePath, { keepFullText: true });
    if (!parsed) return null;
    parsed.isFull = isFull;

    const officialRaw = await getGeneratorMetadata(convId, { force });
    const transcriptModel = [...parsed.steps].reverse()
      .find(step => step.type === 'PLANNER_RESPONSE' && step.model)?.model || '';
    const official = parseOfficialContext(officialRaw, { modelId: transcriptModel });
    const analyzed = analyzeSession(convId, parsed, meta, official);
    this.lru.set(convId, analyzed);

    // Evict oldest entry beyond LRU cap
    while (this.lru.size > MAX_LRU_SESSIONS) {
      const oldestKey = this.lru.keys().next().value;
      this.lru.delete(oldestKey);
    }

    return analyzed;
  }

  async getOverview(convId, meta, selectedSeq = -1, options = {}) {
    const session = await this.load(convId, meta, options);
    if (!session) return null;

    const steps = session.timeline.steps;
    const activeSeq =
      selectedSeq >= 0 && selectedSeq < steps.length
        ? selectedSeq
        : steps.length - 1;
    const rev = `${session.mtimeMs}:${session.size}:${activeSeq}:${session.stats.context.requests}:${session.currentContext.actual?.totalPromptTokens || 0}:${session.currentContext.composition?.total || 0}`;

    return {
      id: session.id,
      rev,
      isFullTranscript: session.isFullTranscript,
      meta: session.meta,
      stats: session.stats,
      currentContext: session.currentContext,
      modelUsage: session.modelUsage,
      selectedSeq: activeSeq,
      timeline: {
        steps: steps.map(s => ({
          seq: s.seq,
          stepIndex: s.stepIndex,
          turnIndex: s.turnIndex,
          createdAt: s.createdAt,
          model: s.model,
          actualModel: s.actualModel || s.model,
          callRole: s.callRole || 'direct',
          isColdCacheSwitch: Boolean(s.isColdCacheSwitch),
          netDeltaTokens: s.netDeltaTokens ?? null,
          isCompactionDrop: Boolean(s.isCompactionDrop),
          modelLabel: s.modelLabel,
          modelLabelZh: s.modelLabelZh || s.modelLabel,
          contextWindow: s.contextWindow,
          durationMs: s.durationMs,
          callDurationMs: s.callDurationMs || s.durationMs || 0,
          streamingMs: s.streamingMs || 0,
          ttftMs: s.ttftMs || 0,
          tokensPerSec: s.tokensPerSec || 0,
          displayTokensPerSec: s.displayTokensPerSec ?? null,
          rawTokensPerSec: s.rawTokensPerSec ?? null,
          isShortSample: Boolean(s.isShortSample),
          callStatus: s.callStatus || 'ok',
          retries: s.retries || 0,
          errorMessage: s.errorMessage || '',
          actual: s.actual,
          composition: s.composition,
          delta: s.delta,
          flags: s.flags,
          brief: s.brief,
        })),
        turns: session.timeline.turns,
      },
      events: session.events,
      fileActivity: summarizeFileActivity(session.allFileOps, activeSeq),
      commands: summarizeCommands(session.allCommands),
    };
  }

  async getStepBrowser(convId, meta, seqParam = -1, baseline = 'prev_turn', options = {}) {
    const session = await this.load(convId, meta, options);
    if (!session) return null;

    const itemIdParam = typeof options?.itemId === 'string' ? options.itemId.trim() : '';
    const searchQ = typeof options?.q === 'string' ? options.q.trim().toLowerCase() : '';
    const steps = session.timeline.steps;
    const isLatest = steps.length === 0
      ? seqParam < 0
      : (seqParam < 0 || seqParam >= steps.length - 1);
    const targetSeq = steps.length > 0 ? (isLatest ? steps.length - 1 : seqParam) : -1;
    const snap = targetSeq >= 0 ? steps[targetSeq] : null;
    const officialFull = isLatest ? session._officialFull : null;
    const hasOfficialFixed = Boolean(officialFull?.hasBreakdown);
    const isPostCompactLatest = isLatest && Boolean(session._compactedAfterLatestPlanner);
    const detailById = new Map();

    // Only show items belonging to the snapshot's history epoch. A compaction
    // starts a new epoch, so pre-compaction items stay viewable on old steps
    // but never leak into the current context view.
    const targetEpoch = isPostCompactLatest
      ? (session._latestHistoryEpoch ?? 0)
      : (snap ? (snap.historyEpoch ?? 0) : 0);
    const cutoff = isPostCompactLatest
      ? session.historyItems.length
      : (snap ? snap.historyCountBefore : session.historyItems.length);
    const items = session.historyItems
      .slice(0, cutoff)
      .filter(item => (item.epoch ?? 0) === targetEpoch);

    // Find baseline snapshot for diff badges (`vs previous turn` or `vs previous step`)
    let baseSeq = -1;
    if (isPostCompactLatest) {
      baseSeq = targetSeq;
    } else if (snap && targetSeq > 0) {
      if (baseline === 'prev_step') {
        baseSeq = targetSeq - 1;
      } else {
        for (let i = targetSeq - 1; i >= 0; i--) {
          if (steps[i].turnIndex < snap.turnIndex) {
            baseSeq = i;
            break;
          }
        }
      }
    }
    const baseSnap = baseSeq >= 0 ? steps[baseSeq] : null;
    const baseEpoch = baseSnap ? (baseSnap.historyEpoch ?? 0) : 0;
    const baseItems = baseSnap
      ? session.historyItems
          .slice(0, baseSnap.historyCountBefore)
          .filter(item => (item.epoch ?? 0) === baseEpoch)
      : [];

    const toSlimCategoryItem = (it, hasDetail) => {
      const out = {
        id: it.id,
        title: it.title,
        tokens: it.tokens || 0,
        stepIndex: it.stepIndex ?? 0,
        turnIndex: it.turnIndex ?? 0,
        hasDetail: Boolean(hasDetail),
      };
      if (it.createdAt) out.createdAt = it.createdAt;
      if (it.source) out.source = it.source;
      if (it.officialContext) out.officialContext = true;
      if (it.estimated) out.estimated = true;
      if (it.kind) out.kind = it.kind;
      if (it.toolName) out.toolName = it.toolName;
      if (it.skillName) out.skillName = it.skillName;
      if (it.isError) out.isError = true;
      if (it.lineCount) out.lineCount = it.lineCount;
      if (it.durationMs) out.durationMs = it.durationMs;
      if (it.exitCode !== null && it.exitCode !== undefined) out.exitCode = it.exitCode;
      if (it.hasThinking) out.hasThinking = true;
      if (it.hasAnswer) out.hasAnswer = true;
      if (it.hasTools) out.hasTools = true;
      if (it.thinkingTokens) out.thinkingTokens = it.thinkingTokens;
      if (it.answerTokens) out.answerTokens = it.answerTokens;
      if (it.toolCallTokens) out.toolCallTokens = it.toolCallTokens;
      if (it.mimeType) out.mimeType = it.mimeType;
      if (it.ext) out.ext = it.ext;
      if (it.fileSize) out.fileSize = it.fileSize;
      if (it.attachmentUrl) out.attachmentUrl = it.attachmentUrl;
      return out;
    };

    const itemMatchesQuery = (it, detail, qLower) => {
      if (!qLower) return true;
      const hay = [
        it?.title,
        it?.toolName,
        it?.skillName,
        it?.category,
        detail?.body,
        detail?.rawBody,
        detail?.answer,
        detail?.thinking,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(qLower);
    };

    const groupItems = (list, estBaseTokens, includeOfficialFixed = false, captureDetails = false) => {
      const sysBody =
        'Antigravity does not persist the built-in system prompt text or native tool JSON schemas inside transcript.jsonl. ' +
        'This value is derived as max(0, actual_prompt_tokens - estimated_visible_history_tokens).';
      if (captureDetails && estBaseTokens > 0) {
        detailById.set('system-base', { body: sysBody });
      }
      const groups = {
        system_base: {
          key: 'system_base',
          tokens: estBaseTokens || 0,
          items: estBaseTokens > 0
            ? [{
                id: 'system-base',
                title: 'Antigravity Built-in System Prompt & Tool Schemas (Estimated Base)',
                tokens: estBaseTokens,
                stepIndex: 0,
                estimated: true,
              }]
            : [],
        },
        tool_defs: { key: 'tool_defs', tokens: 0, items: [] },
        user: { key: 'user', tokens: 0, items: [] },
        injected: { key: 'injected', tokens: 0, items: [] },
        skills: { key: 'skills', tokens: 0, items: [] },
        assistant: { key: 'assistant', tokens: 0, items: [] },
        tool_results: { key: 'tool_results', tokens: 0, items: [] },
        media: { key: 'media', tokens: 0, items: [] },
      };

      if (includeOfficialFixed) {
        // The language server exposes the actual prompt sections and tool
        // schemas for the latest request. Use them instead of the synthetic
        // "estimated base" bucket, splitting fixed sections by their tokenType.
        groups.system_base.tokens = 0;
        groups.system_base.items = [];
        const sections = Array.isArray(officialFull?.sections) ? officialFull.sections : [];
        for (let index = 0; index < sections.length; index++) {
          const section = sections[index];
          if (!section || !section.tokens) continue;
          const category = officialSectionCategory(section);
          const bucket = groups[category];
          if (!bucket) continue;
          bucket.tokens += section.tokens;
          const id = `section-${index}-${category}`;
          const source = officialSectionSource(section);
          const body = section.content || '(官方未返回正文)';
          if (captureDetails) {
            detailById.set(id, { body, source });
          }
          bucket.items.push({
            id,
            title: section.title || `Section ${index + 1}`,
            tokens: section.tokens,
            stepIndex: snap?.stepIndex ?? 0,
            turnIndex: snap?.turnIndex ?? 0,
            source,
            officialContext: true,
            estimated: Boolean(section.estimated),
          });
        }

        const tools = (Array.isArray(officialFull?.tools) ? [...officialFull.tools] : [])
          .sort((a, b) => (b.tokens || 0) - (a.tokens || 0) || String(a.name).localeCompare(String(b.name)));
        for (let index = 0; index < tools.length; index++) {
          const tool = tools[index];
          if (!tool || !tool.tokens) continue;
          groups.tool_defs.tokens += tool.tokens;
          const id = `tool-def-${index}-${tool.name}`;
          const source = officialToolSource(tool.name);
          const body = toolDefinitionBody(tool);
          if (captureDetails) {
            detailById.set(id, { body, source });
          }
          groups.tool_defs.items.push({
            id,
            title: tool.name || `Tool ${index + 1}`,
            tokens: tool.tokens,
            stepIndex: snap?.stepIndex ?? 0,
            turnIndex: snap?.turnIndex ?? 0,
            source,
            officialContext: true,
            estimated: Boolean(tool.estimated),
          });
        }
      }

      const brainDir = resolveBrainDir();
      const convDir = join(brainDir, convId);

      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const bucket = groups[it.kind];
        if (!bucket) continue;
        bucket.tokens += it.tokens || 0;

        if (it.kind === 'media') {
          const safePreview = it.uri && isPathInside(convDir, it.uri);
          const relPath = safePreview ? it.uri.slice(convDir.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') : '';
          bucket.items.push({
            id: `media-${i}`,
            kind: 'media',
            title: it.title,
            tokens: it.tokens,
            stepIndex: it.stepIndex,
            turnIndex: it.turnIndex,
            createdAt: it.createdAt,
            mimeType: it.mimeType,
            ext: it.ext,
            fileSize: it.fileSize,
            attachmentUrl: relPath ? `/api/attachment?id=${encodeURIComponent(convId)}&path=${encodeURIComponent(relPath)}` : '',
          });
        } else {
          const id = `${it.kind}-${it.stepIndex}-${i}`;
          if (captureDetails) {
            detailById.set(id, {
              body: it.body || '',
              rawBody: it.rawBody || '',
              thinking: it.thinking || '',
              answer: it.answer || '',
              toolArgs: it.toolArgs || null,
              toolCalls: it.toolCalls || null,
              toolName: it.toolName || '',
              lineCount: it.lineCount || 0,
              durationMs: it.durationMs || 0,
              exitCode: it.exitCode ?? null,
            });
          }
          bucket.items.push({
            id,
            ...it,
          });
        }
      }
      return groups;
    };

    const currentGroups = groupItems(items, snap ? snap.estimatedBaseTokens : 0, hasOfficialFixed, true);
    if (itemIdParam) {
      return {
        id: convId,
        seq: targetSeq,
        itemId: itemIdParam,
        detail: detailById.get(itemIdParam) || null,
      };
    }

    const baseGroups = baseSnap ? groupItems(baseItems, baseSnap.estimatedBaseTokens, false, false) : null;

    const categories = Object.values(currentGroups).map(cat => {
      const prevCat = baseGroups ? baseGroups[cat.key] : null;
      const suppressFixedDelta = hasOfficialFixed && (cat.key === 'system_base' || cat.key === 'tool_defs');
      const matchedItems = searchQ
        ? cat.items.filter(it => itemMatchesQuery(it, detailById.get(it.id), searchQ))
        : cat.items;
      return {
        key: cat.key,
        tokens: cat.tokens,
        items: matchedItems.map(it => toSlimCategoryItem(it, detailById.has(it.id))),
        count: matchedItems.length,
        deltaItems: prevCat && !suppressFixedDelta ? cat.items.length - prevCat.items.length : null,
        deltaTokens: prevCat && !suppressFixedDelta ? cat.tokens - prevCat.tokens : null,
      };
    });

    // Build DNA flat sequence: model reads oldest -> newest (ribbon), flat list renders newest -> oldest
    const dnaRibbon = [];
    if (hasOfficialFixed) {
      const fixedOrder = ['system_base', 'tool_defs', 'injected', 'skills'];
      for (const key of fixedOrder) {
        for (const item of currentGroups[key]?.items || []) {
          if (!item.officialContext) continue;
          dnaRibbon.push({
            pos: dnaRibbon.length,
            itemId: item.id,
            category: key,
            title: item.title,
            stepIndex: item.stepIndex,
            turnIndex: item.turnIndex,
            tokens: item.tokens || 0,
            source: item.source || '',
          });
        }
      }
    } else if (snap && snap.estimatedBaseTokens > 0) {
      dnaRibbon.push({
        pos: 0,
        itemId: 'system-base',
        category: 'system_base',
        title: 'System & Tool Schemas (Estimated)',
        stepIndex: 0,
        tokens: snap.estimatedBaseTokens,
      });
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const itemId = it.kind === 'media' ? `media-${i}` : `${it.kind}-${it.stepIndex}-${i}`;
      dnaRibbon.push({
        pos: dnaRibbon.length,
        itemId,
        category: it.kind,
        title: it.title,
        stepIndex: it.stepIndex,
        turnIndex: it.turnIndex,
        tokens: it.tokens || 0,
        isError: Boolean(it.isError),
        toolName: it.toolName || '',
      });
    }

    const filteredDnaRibbon = searchQ
      ? dnaRibbon.filter(d => itemMatchesQuery(d, detailById.get(d.itemId), searchQ))
      : dnaRibbon;
    const rev = `${session.mtimeMs}:${session.size}:${targetSeq}:${baseline}:${isPostCompactLatest ? 1 : 0}:${officialFull?.usedTokens || 0}`;

    return {
      id: convId,
      rev,
      seq: targetSeq,
      isLatest,
      stepIndex: snap ? snap.stepIndex : -1,
      turnIndex: snap ? snap.turnIndex : 0,
      model: snap ? snap.model : session.meta.model,
      actual: snap ? snap.actual : null,
      officialFixed: hasOfficialFixed,
      baseline: {
        mode: baseline,
        seq: baseSeq,
        turnIndex: baseSnap ? baseSnap.turnIndex : null,
      },
      categories,
      dna: {
        totalTokens: dnaRibbon.reduce((acc, x) => acc + x.tokens, 0),
        ribbon: filteredDnaRibbon.map(d => ({
          pos: d.pos,
          category: d.category,
          title: d.title,
          stepIndex: d.stepIndex,
          tokens: d.tokens,
        })),
        list: filteredDnaRibbon.slice().reverse().map(d => ({
          pos: d.pos,
          itemId: d.itemId,
          category: d.category,
          title: d.title,
          stepIndex: d.stepIndex,
          turnIndex: d.turnIndex,
          tokens: d.tokens || 0,
          ...(d.isError ? { isError: true } : {}),
          ...(d.toolName ? { toolName: d.toolName } : {}),
          ...(d.source ? { source: d.source } : {}),
          hasDetail: detailById.has(d.itemId),
        })),
      },
    };
  }

  /**
   * Lightweight current-context snapshot for the Fleet page. Reuses the same
   * LRU-parsed session as getOverview(), so composition matches the Context
   * page exactly without serializing the full timeline.
   */
  async getContextSnapshot(convId, meta) {
    const session = await this.load(convId, meta);
    if (!session) return null;
    const cc = session.currentContext || {};
    return {
      composition: cc.composition || null,
      contextWindow: Number(cc.contextWindow) || 0,
      promptTokens: Number(cc.official?.usedTokens) || Number(cc.composition?.total) || 0,
      usagePct: Number(cc.usagePct) || 0,
      nativeUsagePct: Number(cc.nativeUsagePct) || 0,
      source: cc.official ? 'official' : 'transcript',
    };
  }
}
