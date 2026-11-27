import assert from 'node:assert/strict';
import { createRouter, startStandaloneServer } from '../sidecars/context_panel/lib/router.mjs';
import { parseDurationMs, parseOfficialContext } from '../sidecars/context_panel/lib/official-context.mjs';
import { analyzeSession } from '../sidecars/context_panel/lib/session-detail.mjs';

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
  console.log(`[verify] Post-compaction context reset OK: ${postCompactAnalyzed.currentContext.composition.total} tokens`);

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
      const comp = s.currentContext?.composition || {};
      const compKeys = ['systemBase', 'toolDefs', 'tools', 'user', 'injected', 'skills', 'assistant', 'thinking', 'media', 'other'];
      const compSum = compKeys.reduce((acc, key) => acc + (comp[key] || 0), 0);
      assert.ok(Number(comp.toolDefs) >= 0, 'composition.toolDefs missing');
      assert.ok(comp.total > 0 && Math.abs(compSum - comp.total) <= 2, `composition sum ${compSum} != total ${comp.total}`);
      console.log(`[verify] Composition OK: toolDefs=${comp.toolDefs || 0}, sum=${compSum}, total=${comp.total}`);

      const stepRes = await fetch(`${server.url}/api/step?id=${encodeURIComponent(health.latestSessionId)}&baseline=prev_turn`);
      assert.equal(stepRes.status, 200);
      const stepData = await stepRes.json();
      assert.ok(Array.isArray(stepData.categories) && stepData.categories.length === 8);
      assert.ok(Array.isArray(stepData.dna?.ribbon));
      console.log(
        `[verify] Step Browser OK: seq=${stepData.seq}, categories=${stepData.categories.length}, ` +
        `dnaItems=${stepData.dna.ribbon.length}`
      );

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

    // 5. Prefs GET/POST
    const prefsGet = await fetch(`${server.url}/api/prefs`);
    assert.equal(prefsGet.status, 200);
    const currentPrefs = await prefsGet.json();
    const prefsPost = await fetch(`${server.url}/api/prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: currentPrefs.lang }),
    });
    assert.equal(prefsPost.status, 200);
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
