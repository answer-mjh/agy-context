import assert from 'node:assert/strict';
import { createRouter, startStandaloneServer } from '../sidecars/context_panel/lib/router.mjs';
import {
  classifyCacheStart,
  evaluateCallSpeed,
  parseDurationMs,
  parseOfficialContext,
} from '../sidecars/context_panel/lib/official-context.mjs';
import { analyzeSession } from '../sidecars/context_panel/lib/session-detail.mjs';
import {
  WEEKLY_WINDOW_MS,
  inferModelQuotaPool,
  parseUserQuotaSummary,
  resolveWeeklyQuotaWindow,
} from '../sidecars/context_panel/lib/quota.mjs';
import { estimateStepCost, resolveModelMeta } from '../sidecars/context_panel/lib/pricing.mjs';

async function run() {
  // 0. Unit checks for official streamingDuration & TTFT parsing
  assert.ok(Math.abs(parseDurationMs('7.574362700s') - 7574.3627) < 0.01);
  assert.equal(parseDurationMs({ seconds: 2, nanos: 500_000_000 }), 2500);
  assert.equal(parseDurationMs('-1s'), 0);
  const parsedTiming = parseOfficialContext([
    {
      stepIndices: [1],
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M532',
        streamingDuration: '7.574362700s',
        timeToFirstToken: '10.668614500s',
        usage: { inputTokens: '3597', cacheReadTokens: '392366', cacheCreationTokens: '4037', outputTokens: '1310' },
      },
    },
    {
      stepIndices: [2],
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M532',
        streamingDuration: '0.00158s',
        timeToFirstToken: '0.5s',
        usage: { inputTokens: '0', cacheReadTokens: '0', outputTokens: '401' },
      },
    },
  ]);
  assert.ok(parsedTiming?.timing?.byStep?.get(1));
  assert.equal(parsedTiming.timing.totals.samples, 1);
  assert.equal(parsedTiming.timing.totals.streamingOutputTokens, 1310);
  assert.equal(parsedTiming.timing.totals.latestOutputTokensPerSec, 173);
  assert.equal(
    Math.round(parsedTiming.timing.totals.streamingOutputTokens / (parsedTiming.timing.totals.streamingMsExact / 1000)),
    173
  );
  assert.ok(Math.abs(parsedTiming.cache.cacheHitRate - 392366 / (3597 + 392366 + 4037)) < 1e-6);
  console.log('[verify] Official streamingDuration/TTFT/cache parsing OK');

  // 0b. Post-compaction context drop unit test (CHECKPOINT after latest PLANNER_RESPONSE)
  const staleOfficial = parseOfficialContext([
    {
      stepIndices: [2],
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M532',
        usage: { inputTokens: '10000', cacheReadTokens: '390000', outputTokens: '500' },
        chatStartMetadata: {
          contextWindowMetadata: {
            estimatedTokensUsed: 400000,
            maxContextTokens: 512000,
            tokenBreakdown: {
              groups: [
                { type: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 15000 },
                { type: 'TOKEN_TYPE_CHAT_MESSAGES', numTokens: 385000 },
              ],
            },
          },
        },
      },
    },
  ]);
  const postCompactAnalyzed = analyzeSession(
    'post-compact-test',
    {
      mtimeMs: Date.now(),
      size: 1234,
      isFull: true,
      steps: [
        {
          stepIndex: 1,
          turnIndex: 1,
          type: 'USER_INPUT',
          createdAt: '2026-11-27T04:00:00Z',
          createdMs: 1700000000000,
          cleanText: 'hi',
          rawText: 'hi',
          tokensEst: 100,
          mediaTokensEst: 0,
        },
        {
          stepIndex: 2,
          turnIndex: 1,
          type: 'PLANNER_RESPONSE',
          createdAt: '2026-11-27T04:00:05Z',
          createdMs: 1700000005000,
          model: 'gemini-4-neon-high',
          modelLabel: 'Gemini',
          contextWindow: 512000,
          maxOutput: 65536,
          inputTokens: 10000,
          cacheReadTokens: 390000,
          outputTokens: 500,
          totalPromptTokens: 400000,
          totalBillableTokens: 400500,
          cost: 0.1,
          thinkingTokensEst: 100,
          answerTokensEst: 400,
          toolCallTokensEst: 0,
          toolCalls: [],
        },
        {
          stepIndex: 3,
          turnIndex: 1,
          type: 'CHECKPOINT',
          createdAt: '2026-11-27T04:01:00Z',
          createdMs: 1700000060000,
          tokensEst: 5800,
          inputTokens: 410000,
          cacheReadTokens: 0,
          outputTokens: 3000,
          totalPromptTokens: 410000,
          totalBillableTokens: 413000,
          cost: 0.2,
          content: 'Summary',
        },
      ],
    },
    { title: 'compact-test' },
    staleOfficial
  );
  assert.equal(postCompactAnalyzed._compactedAfterLatestPlanner, true);
  assert.ok(
    postCompactAnalyzed.currentContext.composition.total > 0 &&
    postCompactAnalyzed.currentContext.composition.total <= 25000,
    `Expected post-compact context <= 25000, got ${postCompactAnalyzed.currentContext.composition.total}`
  );
  assert.ok(postCompactAnalyzed.currentContext.usagePct < 10);
  assert.equal(
    postCompactAnalyzed.currentContext.actual.totalPromptTokens,
    postCompactAnalyzed.currentContext.composition.total
  );
  assert.ok(
    Math.abs(postCompactAnalyzed.stats.tokens.cacheHitRate - 390000 / 400000) < 1e-6,
    `Expected cacheHitRate to exclude CHECKPOINT (0.975), got ${postCompactAnalyzed.stats.tokens.cacheHitRate}`
  );
  assert.equal(postCompactAnalyzed.stats.tokens.billableTotal, 813500);
  assert.equal(postCompactAnalyzed.modelUsage?.compaction?.calls, 1);
  assert.ok(
    Math.abs((postCompactAnalyzed.stats?.context?.cost || 0) - (postCompactAnalyzed.modelUsage?.totalCost || 0)) < 1e-9,
    'post-compact stats.context.cost must match modelUsage.totalCost'
  );
  console.log(`[verify] Post-compaction context reset OK: ${postCompactAnalyzed.currentContext.composition.total} tokens`);

  // 0c. Weekly quota parsing & window resolution unit tests
  assert.equal(inferModelQuotaPool('gemini-4-neon-high'), 'gemini');
  assert.equal(inferModelQuotaPool('claude-opus-4-6'), 'premium');
  assert.equal(inferModelQuotaPool('gpt-5.4'), 'premium');
  assert.equal(inferModelQuotaPool('custom-local-model'), 'other');

  const nowMs = Date.parse('2026-11-27T12:00:00Z');
  const parsedQuotaSingle = parseUserQuotaSummary({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.8, resetTime: '2026-11-27T16:00:00Z' },
          { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.6, resetTime: '2026-12-02T00:00:00Z' },
        ],
      },
      {
        displayName: 'Claude and GPT models',
        buckets: [
          { bucketId: '3p-5h', remainingFraction: 1, resetTime: '1970-01-01T00:00:00Z' },
          { bucketId: '3p-weekly', resetTime: '1970-01-01T00:00:00Z' },
        ],
      },
    ],
  });
  assert.ok(parsedQuotaSingle && parsedQuotaSingle.groups.length === 2);
  assert.equal(parsedQuotaSingle.groups[0].pool, 'gemini');
  assert.equal(parsedQuotaSingle.groups[1].pool, 'premium');
  assert.equal(parsedQuotaSingle.groups[1].weekly.remainingFraction, 1);
  assert.equal(parsedQuotaSingle.groups[1].weekly.resetAt, null);

  const winSingle = resolveWeeklyQuotaWindow(parsedQuotaSingle, 'all', nowMs);
  assert.equal(winSingle.source, 'official');
  assert.equal(winSingle.hasDistinctResets, false);
  assert.equal(winSingle.cycleEndMs - winSingle.cycleStartMs, WEEKLY_WINDOW_MS);

  const parsedQuotaDistinct = parseUserQuotaSummary({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [{ bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.4, resetTime: '2026-12-02T00:00:00Z' }],
      },
      {
        displayName: 'Claude and GPT models',
        buckets: [{ bucketId: '3p-weekly', window: 'weekly', resetTime: '2026-12-03T12:00:00Z' }],
      },
    ],
  });
  assert.equal(parsedQuotaDistinct.groups[1].weekly.remainingFraction, 0);
  const winDistinct = resolveWeeklyQuotaWindow(parsedQuotaDistinct, 'all', nowMs);
  assert.equal(winDistinct.hasDistinctResets, true);
  assert.ok(winDistinct.poolWindows.gemini && winDistinct.poolWindows.premium);
  const winPremiumOnly = resolveWeeklyQuotaWindow(parsedQuotaDistinct, 'premium', nowMs);
  assert.equal(winPremiumOnly.source, 'official');
  assert.equal(winPremiumOnly.cycleEndMs, Date.parse('2026-12-03T12:00:00Z'));

  const winFallback = resolveWeeklyQuotaWindow(null, 'all', nowMs);
  assert.equal(winFallback.source, 'fallback_calendar_week');
  assert.equal(winFallback.cycleEndMs - winFallback.cycleStartMs, WEEKLY_WINDOW_MS);
  console.log('[verify] Weekly quota parsing & window resolution OK');

  // 0d. Per-call telemetry diagnostics & 2-pass orchestrator/executor attribution tests
  assert.equal(classifyCacheStart(0.05, 1000), 'cold');
  assert.equal(classifyCacheStart(0.4, 1000), 'partial');
  assert.equal(classifyCacheStart(0.95, 1000), 'warm');
  assert.equal(classifyCacheStart(0.9, 0), 'unknown');

  const shortBurst = evaluateCallSpeed(170, 1.58);
  assert.equal(shortBurst.isShortSample, true);
  assert.equal(shortBurst.displaySpeed, null);
  const shortTokens = evaluateCallSpeed(10, 500);
  assert.equal(shortTokens.isShortSample, true);
  assert.equal(shortTokens.displaySpeed, null);
  const validSpeed = evaluateCallSpeed(669, 6180);
  assert.equal(validSpeed.isShortSample, false);
  assert.equal(validSpeed.displaySpeed, 108.3);

  const mockCallsOfficial = parseOfficialContext([
    {
      stepIndices: [2],
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M532',
        responseModel: 'gemini-4-neon',
        streamingDuration: '6.18s',
        timeToFirstToken: '2.5s',
        usage: { inputTokens: '1000', cacheReadTokens: '9000', outputTokens: '669', thinkingOutputTokens: '335' },
      },
    },
    {
      stepIndices: [3],
      plannerConfig: { planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M525' } },
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M532',
        responseModel: 'gemini-4-neon',
        streamingDuration: '4.0s',
        timeToFirstToken: '1.2s',
        usage: { inputTokens: '2000', cacheReadTokens: '10000', outputTokens: '400', responseOutputTokens: '250' },
        retryInfos: [{ error: 'transient' }, {}],
      },
    },
    {
      stepIndices: [4],
      error: 'rate limit exceeded',
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M525',
        responseModel: 'gemini-4-hydrogen',
        streamingDuration: '0.01s',
        timeToFirstToken: '1.0s',
        usage: { inputTokens: '13000', cacheReadTokens: '0', outputTokens: '20' },
      },
    },
  ]);
  const callsAnalyzed = analyzeSession(
    'calls-attrib-test',
    {
      mtimeMs: Date.now(),
      size: 1000,
      isFull: true,
      steps: [
        { stepIndex: 1, turnIndex: 1, type: 'USER_INPUT', createdAt: '2026-11-27T10:00:00Z', createdMs: 1700000000000, cleanText: 'go', rawText: 'go', tokensEst: 20, mediaTokensEst: 0 },
        { stepIndex: 2, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:05Z', createdMs: 1700000005000, model: 'gemini-4-neon-high', modelLabel: 'Gemini', contextWindow: 512000, maxOutput: 65536, inputTokens: 1000, cacheReadTokens: 9000, outputTokens: 669, totalPromptTokens: 10000, totalBillableTokens: 10669, cost: 0.02, thinkingTokensEst: 100, answerTokensEst: 569, toolCallTokensEst: 0, toolCalls: [] },
        { stepIndex: 3, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:15Z', createdMs: 1700000015000, model: 'gemini-4-neon-high', modelLabel: 'Gemini', contextWindow: 512000, maxOutput: 65536, inputTokens: 2000, cacheReadTokens: 10000, outputTokens: 400, totalPromptTokens: 12000, totalBillableTokens: 12400, cost: 0.03, thinkingTokensEst: 50, answerTokensEst: 350, toolCallTokensEst: 0, toolCalls: [] },
        { stepIndex: 4, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:25Z', createdMs: 1700000025000, model: 'gemini-4-hydrogen-high', modelLabel: 'Gemini', contextWindow: 512000, maxOutput: 65536, inputTokens: 13000, cacheReadTokens: 0, outputTokens: 20, totalPromptTokens: 13000, totalBillableTokens: 13020, cost: 0.04, thinkingTokensEst: 0, answerTokensEst: 20, toolCallTokensEst: 0, toolCalls: [] },
      ],
    },
    { title: 'attrib-test' },
    mockCallsOfficial
  );
  const cs = callsAnalyzed.timeline.steps;
  assert.equal(cs.length, 3);
  assert.equal(cs[0].callRole, 'orchestrator');
  assert.equal(cs[0].actual.thinkingPct, 50);
  assert.equal(cs[0].actual.cacheStart, 'warm');
  assert.equal(cs[0].netDeltaTokens, null);
  assert.equal(cs[1].callRole, 'orchestrator');
  assert.equal(cs[1].actual.thinkingOutputTokens, 150);
  assert.equal(cs[1].actual.thinkingPct, 38);
  assert.equal(cs[1].netDeltaTokens, 2000);
  assert.equal(cs[1].callStatus, 'retry');
  assert.equal(cs[1].retries, 1);
  assert.equal(cs[2].callRole, 'executor');
  assert.equal(cs[2].isColdCacheSwitch, true);
  assert.equal(cs[2].isShortSample, true);
  assert.equal(cs[2].callStatus, 'error');
  assert.equal(cs[2].errorMessage, 'rate limit exceeded');

  // Regression: planner has exit_plan_mode (no executionModel field), executor has cid === executionModel
  const handoffOfficial = parseOfficialContext([
    {
      stepIndices: [2],
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M532',
        responseModel: 'gemini-4-neon',
        streamingDuration: '2.0s',
        timeToFirstToken: '1.0s',
        usage: { inputTokens: '500', cacheReadTokens: '4500', outputTokens: '200' },
      },
    },
    {
      stepIndices: [3],
      plannerConfig: { planExecuteConfig: { executionModel: 'MODEL_PLACEHOLDER_M525' } },
      chatModel: {
        model: 'MODEL_PLACEHOLDER_M525',
        responseModel: 'gemini-4-hydrogen',
        streamingDuration: '2.0s',
        timeToFirstToken: '1.0s',
        usage: { inputTokens: '600', cacheReadTokens: '4400', outputTokens: '300' },
      },
    },
  ]);
  const handoffAnalyzed = analyzeSession(
    'calls-handoff-regression',
    {
      mtimeMs: Date.now(),
      size: 500,
      isFull: true,
      steps: [
        { stepIndex: 1, turnIndex: 1, type: 'USER_INPUT', createdAt: '2026-11-27T10:00:00Z', createdMs: 1700000000000, cleanText: 'go', rawText: 'go', tokensEst: 20, mediaTokensEst: 0 },
        { stepIndex: 2, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:05Z', createdMs: 1700000005000, model: 'gemini-4-neon-high', modelLabel: 'Gemini', contextWindow: 512000, maxOutput: 65536, inputTokens: 500, cacheReadTokens: 4500, outputTokens: 200, totalPromptTokens: 5000, totalBillableTokens: 5200, cost: 0.01, thinkingTokensEst: 0, answerTokensEst: 200, toolCallTokensEst: 0, toolCalls: [{ callIndex: 0, name: 'exit_plan_mode', args: {}, argsTokensEst: 10 }] },
        { stepIndex: 3, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:10Z', createdMs: 1700000010000, model: 'gemini-4-hydrogen-high', modelLabel: 'Gemini', contextWindow: 512000, maxOutput: 65536, inputTokens: 600, cacheReadTokens: 4400, outputTokens: 300, totalPromptTokens: 5000, totalBillableTokens: 5300, cost: 0.01, thinkingTokensEst: 0, answerTokensEst: 300, toolCallTokensEst: 0, toolCalls: [] },
      ],
    },
    { title: 'handoff-regression' },
    handoffOfficial
  );
  assert.equal(handoffAnalyzed.timeline.steps[0].callRole, 'orchestrator');
  assert.equal(handoffAnalyzed.timeline.steps[1].callRole, 'executor');

  // 0e. Model directory, localized names, dated pricing & modelUsage card aggregation
  const neonMeta = resolveModelMeta('gemini-4-neon-high');
  assert.equal(neonMeta.canonicalKey, 'MODEL_PLACEHOLDER_M532');
  assert.equal(neonMeta.labelEn, 'Gemini 4 Neon (High)');
  assert.equal(neonMeta.labelZh, 'Gemini 4 Neon (高)');
  assert.equal(neonMeta.quotaPool, 'gemini');
  assert.equal(neonMeta.inputPerM, 3);
  assert.equal(neonMeta.cacheReadPerM, 0.15);
  assert.equal(neonMeta.outputPerM, 15);

  const m532Meta = resolveModelMeta('MODEL_PLACEHOLDER_M532');
  assert.equal(m532Meta.labelZh, 'Gemini 4 Neon (高)');
  const m525Meta = resolveModelMeta('MODEL_PLACEHOLDER_M525');
  assert.equal(m525Meta.labelZh, 'Gemini 4 Hydrogen (高)');
  assert.equal(m525Meta.inputPerM, 1.5);
  const m537Meta = resolveModelMeta('MODEL_PLACEHOLDER_M537');
  assert.equal(m537Meta.pricingProvenance, 'mapped_base');
  assert.equal(m537Meta.inputPerM, 3);
  const m669Meta = resolveModelMeta('MODEL_PLACEHOLDER_M669');
  assert.equal(m669Meta.pricingProvenance, 'mapped_base');
  assert.equal(m669Meta.inputPerM, 1.5);
  const opus55Meta = resolveModelMeta('claude-opus-5-5-high');
  assert.equal(opus55Meta.labelZh, 'Claude Opus 5.5 (高)');
  assert.equal(opus55Meta.quotaPool, 'premium');
  assert.equal(opus55Meta.inputPerM, 4);

  const carbonIntro = estimateStepCost('gemini-4-carbon-high', 1_000_000, 0, 0, { at: '2026-11-28T00:00:00Z' });
  const carbonStd = estimateStepCost('gemini-4-carbon-high', 1_000_000, 0, 0, { at: '2026-12-01T00:00:00Z' });
  assert.equal(carbonIntro.cost, 2);
  assert.equal(carbonStd.cost, 4);

  // Verify cross-model orchestrator attribution + cold cache switch from callsAnalyzed
  assert.ok(callsAnalyzed.modelUsage?.route, 'expected route on orchestrated session');
  assert.equal(callsAnalyzed.modelUsage.route.plannerLabelZh, 'Gemini 4 Neon (高)');
  assert.equal(callsAnalyzed.modelUsage.route.executorLabelZh, 'Gemini 4 Hydrogen (高)');
  assert.equal(callsAnalyzed.modelUsage.route.isCrossPool, false);
  const split = callsAnalyzed.modelUsage.orchestratorSplit;
  assert.ok(split && split.isMultiModelOrchestrated);
  assert.equal(split.orchestrator.calls, 2);
  assert.equal(split.executor.calls, 1);
  assert.equal(split.coldCacheSwitchCount, 1);
  assert.equal(split.coldCacheSwitchInputTokens, 13000);
  assert.equal(callsAnalyzed.modelUsage.byModel.length, 2);
  assert.equal(callsAnalyzed.meta.model, 'gemini-4-neon-high', 'primary model should protect orchestrator');

  // Mid-conversation reconfig + cross-pool session
  const reconfigAnalyzed = analyzeSession(
    'model-usage-reconfig-cross-pool',
    {
      mtimeMs: Date.now(),
      size: 600,
      isFull: true,
      steps: [
        { stepIndex: 1, turnIndex: 1, type: 'USER_INPUT', createdAt: '2026-11-27T10:00:00Z', createdMs: 1700000000000, cleanText: 'plan', rawText: 'plan', tokensEst: 20, mediaTokensEst: 0 },
        { stepIndex: 2, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:05Z', createdMs: 1700000005000, model: 'gemini-4-neon-high', inputTokens: 1000, cacheReadTokens: 0, outputTokens: 100, totalPromptTokens: 1000, totalBillableTokens: 1100, cost: 0, thinkingTokensEst: 0, answerTokensEst: 100, toolCallTokensEst: 0, toolCalls: [{ callIndex: 0, name: 'exit_plan_mode', args: {}, argsTokensEst: 10 }] },
        { stepIndex: 3, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:10Z', createdMs: 1700000010000, model: 'gemini-4-hydrogen-high', inputTokens: 2000, cacheReadTokens: 0, outputTokens: 200, totalPromptTokens: 2000, totalBillableTokens: 2200, cost: 0, thinkingTokensEst: 0, answerTokensEst: 200, toolCallTokensEst: 0, toolCalls: [{ callIndex: 0, name: 'enter_plan_mode', args: {}, argsTokensEst: 10 }] },
        { stepIndex: 4, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:15Z', createdMs: 1700000015000, model: 'claude-opus-5-5-high', inputTokens: 3000, cacheReadTokens: 0, outputTokens: 300, totalPromptTokens: 3000, totalBillableTokens: 3300, cost: 0, thinkingTokensEst: 0, answerTokensEst: 300, toolCallTokensEst: 0, toolCalls: [{ callIndex: 0, name: 'exit_plan_mode', args: {}, argsTokensEst: 10 }] },
        { stepIndex: 5, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:20Z', createdMs: 1700000020000, model: 'gemini-4-hydrogen-high', inputTokens: 4000, cacheReadTokens: 0, outputTokens: 400, totalPromptTokens: 4000, totalBillableTokens: 4400, cost: 0, thinkingTokensEst: 0, answerTokensEst: 400, toolCallTokensEst: 0, toolCalls: [] },
      ],
    },
    { title: 'reconfig-cross-pool' },
    null
  );
  assert.equal(reconfigAnalyzed.modelUsage.orchestratorSplit.hasMidConversationReconfig, true);
  assert.equal(reconfigAnalyzed.modelUsage.route.isCrossPool, true);
  assert.equal(reconfigAnalyzed.modelUsage.route.plannerPool, 'premium');
  assert.equal(reconfigAnalyzed.modelUsage.route.executorPool, 'gemini');

  // Single-model direct session
  const singleDirect = analyzeSession(
    'single-direct-session',
    {
      mtimeMs: Date.now(),
      size: 200,
      isFull: true,
      steps: [
        { stepIndex: 1, turnIndex: 1, type: 'USER_INPUT', createdAt: '2026-11-27T10:00:00Z', createdMs: 1700000000000, cleanText: 'hi', rawText: 'hi', tokensEst: 10, mediaTokensEst: 0 },
        { stepIndex: 2, turnIndex: 1, type: 'PLANNER_RESPONSE', createdAt: '2026-11-27T10:00:05Z', createdMs: 1700000005000, model: 'gemini-4-neon-high', inputTokens: 500, cacheReadTokens: 4500, outputTokens: 200, totalPromptTokens: 5000, totalBillableTokens: 5200, cost: 0, thinkingTokensEst: 0, answerTokensEst: 200, toolCallTokensEst: 0, toolCalls: [] },
      ],
    },
    { title: 'single-direct' },
    null
  );
  assert.equal(singleDirect.modelUsage.route, null);
  assert.equal(singleDirect.modelUsage.orchestratorSplit, null);
  assert.equal(singleDirect.modelUsage.byModel.length, 1);
  assert.equal(singleDirect.modelUsage.byModel[0].labelZh, 'Gemini 4 Neon (高)');
  console.log('[verify] Per-call telemetry diagnostics, pricing & modelUsage OK');

  const router = createRouter({ version: '0.1.0-test' });
  const server = await startStandaloneServer(router, { port: 0, host: '127.0.0.1' });

  try {
    console.log(`[verify] Standalone server started at ${server.url}`);

    // 1. Health endpoint
    const healthRes = await fetch(`${server.url}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    console.log(`[verify] Health OK: ${health.sessionsCount} sessions discovered, latest=${health.latestSessionId}`);

    // 2. Insights endpoint
    const t0 = Date.now();
    const insightsRes = await fetch(`${server.url}/api/insights?range=30d`);
    assert.equal(insightsRes.status, 200);
    const insights = await insightsRes.json();
    const elapsed1 = Date.now() - t0;
    assert.ok(Array.isArray(insights.chart7Days) && insights.chart7Days.length === 7);
    assert.ok(Array.isArray(insights.heatmap56) && insights.heatmap56.length === 56);
    assert.ok(Array.isArray(insights.sessions));
    assert.ok(Number.isFinite(insights.timing?.outputTokensPerSec) && insights.timing.outputTokensPerSec >= 0);
    console.log(
      `[verify] Insights OK (${elapsed1}ms): sessions=${insights.sessions.length}, ` +
      `billable=${insights.kpi.billableTokens}, cacheHit=${(insights.kpi.cacheHitRate * 100).toFixed(1)}%, ` +
      `cost=$${insights.kpi.cost.toFixed(4)}, speed=${insights.timing.outputTokensPerSec} tok/s (${insights.timing.speedSource}), ` +
      `skills=${insights.rankings.skills.length}, tools=${insights.rankings.tools.length}, cmds=${insights.rankings.commands.length}`
    );

    // 3. Cached second call speed check
    const t1 = Date.now();
    const insightsRes2 = await fetch(`${server.url}/api/insights?range=30d`);
    assert.equal(insightsRes2.status, 200);
    await insightsRes2.json();
    console.log(`[verify] Insights cached pass OK (${Date.now() - t1}ms)`);

    // 3b. Strict session isolation checks (never fall back to sessions[0])
    const noIdSess = await (await fetch(`${server.url}/api/session`)).json();
    assert.equal(noIdSess.empty, true, '/api/session without id must not fall back to sessions[0]');
    assert.equal(noIdSess.reason, 'missing_conversation_id');
    assert.equal(noIdSess.session, null);

    const noIdFleet = await (await fetch(`${server.url}/api/fleet`)).json();
    assert.equal(noIdFleet.empty, true, '/api/fleet without id must not fall back to sessions[0]');
    assert.equal(noIdFleet.reason, 'missing_conversation_id');

    const noIdStep = await (await fetch(`${server.url}/api/step`)).json();
    assert.equal(noIdStep.empty, true, '/api/step without id must not fall back to sessions[0]');
    assert.equal(noIdStep.reason, 'missing_conversation_id');

    const missingIdSess = await (await fetch(`${server.url}/api/session?id=nonexistent-session-id-check`)).json();
    assert.equal(missingIdSess.empty, true, '/api/session with unknown id must stay empty');
    assert.equal(missingIdSess.reason, 'no_transcript_yet');
    assert.equal(missingIdSess.session, null);

    // Insights KPI must equal the sum of matching sessions' billable tokens
    const insightsSum = insights.sessions.reduce((acc, item) => acc + (item.billableTokens || 0), 0);
    assert.equal(insights.kpi.billableTokens, insightsSum, 'insights kpi.billableTokens should equal sum of matching sessions');
    console.log('[verify] Strict isolation & Insights aggregation OK');

    // 3c. Weekly quota Insights endpoints
    const weeklyAllRes = await fetch(`${server.url}/api/insights?range=weekly_quota`);
    assert.equal(weeklyAllRes.status, 200);
    const weeklyAll = await weeklyAllRes.json();
    assert.equal(weeklyAll.range, 'weekly_quota');
    assert.ok(weeklyAll.weeklyQuota && weeklyAll.weeklyQuota.cycleStartMs < weeklyAll.weeklyQuota.cycleEndMs);
    const weeklyAllSum = weeklyAll.sessions.reduce((acc, item) => acc + (item.billableTokens || 0), 0);
    assert.equal(weeklyAll.kpi.billableTokens, weeklyAllSum, 'weekly_quota kpi.billableTokens should equal sum of matching sessions');

    const weeklyGeminiRes = await fetch(`${server.url}/api/insights?range=weekly_quota&quotaPool=gemini`);
    assert.equal(weeklyGeminiRes.status, 200);
    const weeklyGemini = await weeklyGeminiRes.json();
    assert.equal(weeklyGemini.quotaPool, 'gemini');
    const weeklyGeminiSum = weeklyGemini.sessions.reduce((acc, item) => acc + (item.billableTokens || 0), 0);
    assert.equal(weeklyGemini.kpi.billableTokens, weeklyGeminiSum, 'weekly_quota gemini kpi.billableTokens should equal sum of matching sessions');
    console.log(
      `[verify] Weekly quota API OK: source=${weeklyAll.weeklyQuota.source}, ` +
      `allSessions=${weeklyAll.sessions.length}, geminiSessions=${weeklyGemini.sessions.length}`
    );

    // 4. Session overview & step browser endpoints
    if (health.latestSessionId) {
      const sessRes = await fetch(`${server.url}/api/session?id=${encodeURIComponent(health.latestSessionId)}`);
      assert.equal(sessRes.status, 200);
      assert.match(String(sessRes.headers.get('cache-control') || ''), /no-cache/i);
      const sessForceRes = await fetch(`${server.url}/api/session?id=${encodeURIComponent(health.latestSessionId)}&force=1`);
      assert.equal(sessForceRes.status, 200);
      assert.match(String(sessForceRes.headers.get('cache-control') || ''), /no-cache/i);
      await sessForceRes.json();
      const sessPayload = await sessRes.json();
      assert.equal(sessPayload.empty, false);
      assert.ok(sessPayload.session);
      assert.equal(sessPayload.session.id, health.latestSessionId);
      const s = sessPayload.session;
      assert.ok(Number.isFinite(s.stats?.timing?.outputTokensPerSec) && s.stats.timing.outputTokensPerSec >= 0);
      assert.ok(['streaming', 'estimated'].includes(s.stats?.timing?.speedSource));
      console.log(
        `[verify] Session OK: title="${s.meta.title}", model=${s.meta.model}, ` +
        `requests=${s.timeline.steps.length}, turns=${s.timeline.turns.length}, ` +
        `speed=${s.stats.timing.outputTokensPerSec} tok/s (${s.stats.timing.speedSource}), ` +
        `events=${s.events.length}, files=${s.fileActivity.totalFiles}, cmds=${s.commands.summary.total}`
      );
      if (insights.sessions.length >= 2) {
        const secondId = insights.sessions.find(item => item.id !== health.latestSessionId)?.id;
        if (secondId) {
          const secondPayload = await (await fetch(`${server.url}/api/session?id=${encodeURIComponent(secondId)}`)).json();
          assert.equal(secondPayload.empty, false);
          assert.equal(secondPayload.session.id, secondId, 'second session returned wrong conversation id');
          assert.notEqual(secondPayload.session.id, s.id);
          console.log(`[verify] Second distinct session OK: id=${secondId.slice(0, 8)}, billable=${secondPayload.session.stats.tokens.billableTotal}`);
        }
      }
      const [callsAssetRes, modelsAssetRes] = await Promise.all([
        fetch(`${server.url}/js/views/calls.js`),
        fetch(`${server.url}/js/views/models.js`),
      ]);
      assert.equal(callsAssetRes.status, 200);
      assert.equal(modelsAssetRes.status, 200);
      assert.ok(s.modelUsage && Array.isArray(s.modelUsage.byModel), 'session modelUsage missing');
      assert.ok(
        Math.abs((s.stats?.context?.cost || 0) - (s.modelUsage.totalCost || 0)) < 1e-6,
        `stats.context.cost (${s.stats?.context?.cost}) != modelUsage.totalCost (${s.modelUsage.totalCost})`
      );
      if (s.modelUsage.orchestratorSplit) {
        assert.ok(
          Math.abs((s.stats?.context?.cost || 0) - (s.modelUsage.orchestratorSplit.totalCost || 0)) < 1e-6,
          `stats.context.cost (${s.stats?.context?.cost}) != orchestratorSplit.totalCost (${s.modelUsage.orchestratorSplit.totalCost})`
        );
      }
      const firstCallSnap = s.timeline.steps[0];
      assert.ok(firstCallSnap.actualModel, 'actualModel missing on timeline step');
      assert.ok(['direct', 'orchestrator', 'executor'].includes(firstCallSnap.callRole));
      assert.ok(['ok', 'retry', 'error'].includes(firstCallSnap.callStatus));
      assert.ok(['warm', 'partial', 'cold', 'unknown'].includes(firstCallSnap.actual?.cacheStart));
      assert.ok(Number.isFinite(firstCallSnap.actual?.thinkingPct));

      const comp = s.currentContext?.composition || {};
      const compKeys = ['systemBase', 'toolDefs', 'tools', 'user', 'injected', 'skills', 'assistant', 'thinking', 'media', 'other'];
      const compSum = compKeys.reduce((acc, key) => acc + (comp[key] || 0), 0);
      assert.ok(Number(comp.toolDefs) >= 0, 'composition.toolDefs missing');
      assert.ok(comp.total > 0 && Math.abs(compSum - comp.total) <= 2, `composition sum ${compSum} != total ${comp.total}`);
      console.log(`[verify] Composition OK: toolDefs=${comp.toolDefs || 0}, sum=${compSum}, total=${comp.total}`);

      const stepRes = await fetch(`${server.url}/api/step?id=${encodeURIComponent(health.latestSessionId)}&baseline=prev_turn`);
      assert.equal(stepRes.status, 200);
      const stepRawText = await stepRes.text();
      assert.ok(stepRawText.length < 500 * 1024, `/api/step slim payload too large: ${stepRawText.length} bytes`);
      const stepData = JSON.parse(stepRawText);
      assert.ok(stepData.rev, '/api/step missing rev');
      assert.ok(Array.isArray(stepData.categories) && stepData.categories.length === 8);
      assert.ok(Array.isArray(stepData.dna?.ribbon));
      console.log(
        `[verify] Step Browser OK: seq=${stepData.seq}, categories=${stepData.categories.length}, ` +
        `dnaItems=${stepData.dna.ribbon.length}, payloadKB=${(stepRawText.length / 1024).toFixed(1)}`
      );

      // On-demand single item detail check (category item & DNA item)
      const catItemWithDetail = stepData.categories.flatMap(c => c.items || []).find(it => it.hasDetail);
      assert.ok(catItemWithDetail, 'expected at least one category item with detail');
      const itemDetailRes = await fetch(`${server.url}/api/step?id=${encodeURIComponent(health.latestSessionId)}&step=${stepData.seq}&itemId=${encodeURIComponent(catItemWithDetail.id)}`);
      assert.equal(itemDetailRes.status, 200);
      const itemDetailJson = await itemDetailRes.json();
      assert.ok(itemDetailJson.detail, 'on-demand category item detail missing');

      const dnaItemWithDetail = (stepData.dna?.list || []).find(it => it.hasDetail && it.itemId);
      assert.ok(dnaItemWithDetail, 'expected at least one DNA item with detail');
      const dnaDetailRes = await fetch(`${server.url}/api/step?id=${encodeURIComponent(health.latestSessionId)}&step=${stepData.seq}&itemId=${encodeURIComponent(dnaItemWithDetail.itemId)}`);
      assert.equal(dnaDetailRes.status, 200);
      const dnaDetailJson = await dnaDetailRes.json();
      assert.ok(dnaDetailJson.detail, 'on-demand DNA item detail missing');

      // Backend full-text search & rev short-circuit checks
      const stepSearchRes = await fetch(`${server.url}/api/step?id=${encodeURIComponent(health.latestSessionId)}&step=${stepData.seq}&q=antigravity`);
      assert.equal(stepSearchRes.status, 200);
      const stepSearchJson = await stepSearchRes.json();
      assert.ok(Array.isArray(stepSearchJson.categories));

      const stepUnchangedText = await (await fetch(`${server.url}/api/step?id=${encodeURIComponent(health.latestSessionId)}&step=${stepData.seq}&baseline=prev_turn&rev=${encodeURIComponent(stepData.rev)}`)).text();
      assert.ok(stepUnchangedText.length < 160 && JSON.parse(stepUnchangedText).unchanged === true, '/api/step rev short-circuit failed');

      const sessUnchangedText = await (await fetch(`${server.url}/api/session?id=${encodeURIComponent(health.latestSessionId)}&rev=${encodeURIComponent(sessPayload.rev)}`)).text();
      assert.ok(sessUnchangedText.length < 200 && JSON.parse(sessUnchangedText).unchanged === true, '/api/session rev short-circuit failed');

      const insUnchangedText = await (await fetch(`${server.url}/api/insights?range=30d&rev=${encodeURIComponent(insights.rev)}`)).text();
      assert.ok(insUnchangedText.length < 160 && JSON.parse(insUnchangedText).unchanged === true, '/api/insights rev short-circuit failed');
      console.log('[verify] On-demand detail, backend search & rev short-circuits OK');

      const fleetRes = await fetch(`${server.url}/api/fleet?id=${encodeURIComponent(health.latestSessionId)}`);
      assert.equal(fleetRes.status, 200);
      const fleet = await fleetRes.json();
      assert.ok(Array.isArray(fleet.agents) && fleet.agents.length >= 1);
      assert.ok(Array.isArray(fleet.tasks));
      assert.ok(Array.isArray(fleet.timeline));
      assert.ok(fleet.summary && fleet.summary.agents === fleet.agents.length);
      assert.ok(sessPayload.fleet && sessPayload.fleet.agents === fleet.agents.length, 'session fleet summary mismatch');
      const task = fleet.tasks[0] || null;
      if (task) {
        assert.ok(task.brief, 'fleet task brief missing');
        assert.ok(['in_progress', 'completed'].includes(task.status));
      }
      console.log(
        `[verify] Fleet OK: agents=${fleet.agents.length}, children=${fleet.summary.children}, ` +
        `tasks=${fleet.tasks.length}, timeline=${fleet.timeline.length}, messages=${fleet.summary.messages}`
      );
    }

    // 5. Prefs GET/POST (including weekly_quota roundtrip without mutating saved pref)
    const prefsGet = await fetch(`${server.url}/api/prefs`);
    assert.equal(prefsGet.status, 200);
    const currentPrefs = await prefsGet.json();
    const prefsWeeklyPost = await fetch(`${server.url}/api/prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insightsRange: 'weekly_quota' }),
    });
    assert.equal(prefsWeeklyPost.status, 200);
    const prefsWeeklySaved = await prefsWeeklyPost.json();
    assert.equal(prefsWeeklySaved.insightsRange, 'weekly_quota');
    const prefsRestore = await fetch(`${server.url}/api/prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: currentPrefs.lang, insightsRange: currentPrefs.insightsRange }),
    });
    assert.equal(prefsRestore.status, 200);
    console.log('[verify] Prefs GET/POST OK');

    console.log('[verify] ALL BACKEND CHECKS PASSED');
  } finally {
    await server.close();
  }
}

run().catch((err) => {
  console.error('[verify] FAILED:', err);
  process.exit(1);
});
