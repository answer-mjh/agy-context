import assert from 'node:assert/strict';
import { createRouter, startStandaloneServer } from '../sidecars/context_panel/lib/router.mjs';

async function run() {
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
    console.log(
      `[verify] Insights OK (${elapsed1}ms): sessions=${insights.sessions.length}, ` +
      `billable=${insights.kpi.billableTokens}, cacheHit=${(insights.kpi.cacheHitRate * 100).toFixed(1)}%, ` +
      `cost=$${insights.kpi.cost.toFixed(4)}, skills=${insights.rankings.skills.length}, ` +
      `tools=${insights.rankings.tools.length}, cmds=${insights.rankings.commands.length}`
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
      const sessPayload = await sessRes.json();
      assert.equal(sessPayload.empty, false);
      assert.ok(sessPayload.session);
      assert.equal(sessPayload.session.id, health.latestSessionId);
      const s = sessPayload.session;
      console.log(
        `[verify] Session OK: title="${s.meta.title}", model=${s.meta.model}, ` +
        `requests=${s.timeline.steps.length}, turns=${s.timeline.turns.length}, ` +
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
