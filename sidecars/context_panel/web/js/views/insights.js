(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const RANK_DOT_COLORS = [
    '#14b8a6', '#6366f1', '#f59e0b', '#ec4899', '#3b82f6', '#22c55e', '#a855f7', '#f97316',
  ];

  function computeRangeLabel(range, selectedDay) {
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (selectedDay) return selectedDay;
    const today = new Date();
    if (range === 'today') return `${fmt(today)} → ${fmt(today)}`;
    if (range === '7d') {
      const s = new Date(today);
      s.setDate(s.getDate() - 6);
      return `${fmt(s)} → ${fmt(today)}`;
    }
    if (range === '30d') {
      const s = new Date(today);
      s.setDate(s.getDate() - 29);
      return `${fmt(s)} → ${fmt(today)}`;
    }
    return AGY.i18n.t('rangeAll');
  }

  function buildProjectRankings(sessions) {
    const map = new Map();
    for (const s of sessions || []) {
      const name = s.workspaceName || 'Workspace';
      const prev = map.get(name) || { name, count: 0, tokens: 0, lastUsedMs: 0 };
      prev.count += 1;
      prev.tokens += s.billableTokens || 0;
      prev.lastUsedMs = Math.max(prev.lastUsedMs, s.lastMs || 0);
      map.set(name, prev);
    }
    return [...map.values()].sort((a, b) => b.tokens - a.tokens || b.count - a.count);
  }

  function renderDshRankCard({ icon, title, subtitle, items, activeKey, dataAttr, valueFmt, barColor }) {
    const { escHtml, t } = AGY.i18n;
    const list = items || [];
    const maxVal = Math.max(1, ...list.map(x => (x._barVal != null ? x._barVal : x.count) || 0));
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${icon} ${escHtml(title)}</span>
          <span class="card-subtitle mono">${escHtml(subtitle)}</span>
        </div>
        ${list.length === 0
          ? `<div class="empty-state" style="padding:18px 8px">${escHtml(t('noRecords'))}</div>`
          : `<div class="dsh-rank-list">
              ${list.slice(0, 12).map((it, idx) => {
                const v = (it._barVal != null ? it._barVal : it.count) || 0;
                const pct = Math.max(4, (v / maxVal) * 100);
                const col = barColor || RANK_DOT_COLORS[idx % RANK_DOT_COLORS.length];
                const isAct = activeKey && activeKey === it.name;
                return `
                  <div class="dsh-rank-item ${isAct ? 'active' : ''}" data-${dataAttr}="${escHtml(it.name)}" title="${escHtml(it.name)}">
                    <div class="dsh-rank-top">
                      <span class="dsh-rank-label">
                        <span class="dsh-rank-dot" style="background:${col}"></span>
                        <span class="dsh-rank-name ${dataAttr === 'rproj' ? '' : 'mono'}">${escHtml(it.name)}</span>
                      </span>
                      <span class="dsh-rank-val mono">${valueFmt(it)}</span>
                    </div>
                    <div class="dsh-rank-track">
                      <div class="dsh-rank-bar" style="width:${pct.toFixed(1)}%;background:${col}"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>`
        }
      </div>
    `;
  }

  function renderInsights(container, data, filters, callbacks) {
    const { t, fmtTokens, fmtCompactCount, fmtCost, fmtPct, fmtDuration, fmtRelativeTime, escHtml, getLang } = AGY.i18n;
    if (!data) {
      container.innerHTML = `<div class="card"><div class="empty-state">${escHtml(t('loading'))}</div></div>`;
      return;
    }

    const kpi = data.kpi || {};
    const timing = data.timing || {};
    const comp = data.composition || {};
    const range = filters.range || data.range || '30d';
    const hmMetric = filters.hmMetric || 'tokens';
    const hasActiveChips = Boolean(filters.day || filters.skill || filters.tool || filters.cmd || filters.workspace || filters.q);
    const isZh = getLang() === 'zh';

    const projects = buildProjectRankings(data.sessions).map(p => Object.assign({}, p, { _barVal: p.tokens || p.count }));
    const skills = data.rankings?.skills || [];
    const tools = data.rankings?.tools || [];
    const cmds = data.rankings?.commands || [];

    const totalSkillLoads = skills.reduce((s, x) => s + (x.count || 0), 0);
    const totalToolCallsRank = tools.reduce((s, x) => s + (x.count || 0), 0);
    const totalCmdExecs = cmds.reduce((s, x) => s + (x.count || 0), 0);

    const dateSpanLabel = computeRangeLabel(range, filters.day);

    container.innerHTML = `
      <!-- DSH Insights Page Header -->
      <div class="dsh-ins-header">
        <div class="dsh-ins-title-group">
          <span class="dsh-page-title">${escHtml(t('navInsights'))}</span>
          <button class="dsh-chip dsh-chip-btn" id="ins-open-settings">⚙ ${escHtml(t('pluginSettings'))}</button>
          <span class="dsh-chip mono">${escHtml(dateSpanLabel)}</span>
          ${filters.day ? `<button class="dsh-chip dsh-chip-btn" id="ins-clear-day" style="color:var(--accent)">✕ ${escHtml(filters.day)}</button>` : ''}
        </div>
        <div class="nav-tabs">
          ${[
            { key: 'today', label: t('rangeToday') },
            { key: '7d', label: t('range7d') },
            { key: '30d', label: t('range30d') },
            { key: 'all', label: t('rangeAll') },
          ].map(r => `<button class="nav-tab ${range === r.key ? 'active' : ''}" data-irange="${r.key}">${escHtml(r.label)}</button>`).join('')}
        </div>
      </div>

      <!-- Row 1: 3-Column Bento (2x3 KPIs | 7-Day Usage | Activity Heatmap) -->
      <div class="dsh-ins-top">
        <div class="dsh-kpi-2x3">
          <div class="dsh-kpi-card">
            <div class="dsh-kpi-label">${escHtml(t('kpiAllSessions'))}</div>
            <div class="dsh-kpi-val">${kpi.sessionsCount || 0}</div>
            <div class="dsh-kpi-sub">${escHtml(t('dshSubTotal'))} ${data.totalSessionsAll || 0}</div>
          </div>
          <div class="dsh-kpi-card">
            <div class="dsh-kpi-label">${escHtml(t('kpiBillable'))}</div>
            <div class="dsh-kpi-val">${escHtml(fmtTokens(kpi.billableTokens))}</div>
            <div class="dsh-kpi-sub">${escHtml(t('dshSubTurns'))} ${kpi.turnsCount || 0}</div>
          </div>
          <div class="dsh-kpi-card">
            <div class="dsh-kpi-label">${escHtml(t('kpiCost'))}</div>
            <div class="dsh-kpi-val">${escHtml(fmtCost(kpi.cost))}</div>
            <div class="dsh-kpi-sub">${escHtml(t('dshSubReqs'))} ${escHtml(fmtCompactCount(kpi.requestsCount || 0))}</div>
          </div>
          <div class="dsh-kpi-card">
            <div class="dsh-kpi-label">${escHtml(t('kpiCache'))}</div>
            <div class="dsh-kpi-val">${escHtml(fmtPct(kpi.cacheHitRate, 2))}</div>
            <div class="dsh-kpi-sub">${isZh ? `含 ${kpi.sessionsCount || 0} 个会话` : `${kpi.sessionsCount || 0} sessions`}</div>
          </div>
          <div class="dsh-kpi-card">
            <div class="dsh-kpi-label">${escHtml(t('kpiTools'))}</div>
            <div class="dsh-kpi-val">${escHtml(fmtCompactCount(kpi.toolCallsCount || 0))}</div>
            <div class="dsh-kpi-sub">${escHtml(t('dshSubToolExec'))} ${escHtml(fmtDuration(kpi.toolDurationMs || timing.toolMs || 0))}</div>
          </div>
          <div class="dsh-kpi-card">
            <div class="dsh-kpi-label">${escHtml(t('kpiDuration'))}</div>
            <div class="dsh-kpi-val">${escHtml(fmtDuration(kpi.activeDurationMs || timing.totalActiveMs || 0))}</div>
            <div class="dsh-kpi-sub">${escHtml(t('dshSubReqs'))} ${escHtml(fmtCompactCount(kpi.requestsCount || 0))}</div>
          </div>
        </div>

        <!-- 7-Day Usage Bar Chart -->
        <div class="card" style="justify-content:space-between">
          <div class="card-header">
            <span class="card-title">▤ ${escHtml(t('chart7Title'))}</span>
          </div>
          <div class="chart-wrap" id="ins-chart7"></div>
          <div class="legend-row" style="justify-content:center;font-size:11px">
            <span class="legend-item"><span class="legend-swatch" style="background:var(--bar-token)"></span>Token</span>
            <span class="legend-item"><span class="legend-swatch" style="background:var(--bar-cost)"></span>${escHtml(t('kpiCost'))} (${escHtml(t('chart7Sub'))})</span>
          </div>
        </div>

        <!-- 8-Week Activity Heatmap -->
        <div class="card" style="justify-content:space-between">
          <div class="card-header">
            <span class="card-title">◔ ${escHtml(t('heatmapTitle'))}</span>
            <div class="filter-bar" style="gap:5px">
              <span class="card-subtitle">${escHtml(t('heatmapSub'))}</span>
              <div class="nav-tabs">
                <button class="nav-tab ${hmMetric === 'sessions' ? 'active' : ''}" data-hm-metric="sessions" style="padding:2px 8px;font-size:11px">${escHtml(t('hmModeSessions'))}</button>
                <button class="nav-tab ${hmMetric === 'tokens' ? 'active' : ''}" data-hm-metric="tokens" style="padding:2px 8px;font-size:11px">${escHtml(t('hmModeTokens'))}</button>
              </div>
            </div>
          </div>
          <div class="chart-wrap" id="ins-heatmap"></div>
          <div class="dsh-hm-legend">
            <span>${escHtml(t('hmLess'))}</span>
            <span class="dsh-hm-swatch" style="background:var(--heat-0)"></span>
            <span class="dsh-hm-swatch" style="background:var(--heat-1)"></span>
            <span class="dsh-hm-swatch" style="background:var(--heat-2)"></span>
            <span class="dsh-hm-swatch" style="background:var(--heat-3)"></span>
            <span class="dsh-hm-swatch" style="background:var(--heat-4)"></span>
            <span>${escHtml(t('hmMore'))}</span>
          </div>
        </div>
      </div>

      <!-- Row 2: 2-Column Donut Analytics (Token Stats | Timing Stats) -->
      <div class="dsh-donut-row">
        <div class="card">
          <div class="card-header">
            <span class="card-title">⛁ ${escHtml(t('compDonutTitle'))}</span>
            <span class="card-subtitle mono">${escHtml(t('cacheHit'))} ${escHtml(fmtPct(kpi.cacheHitRate, 2))}</span>
          </div>
          <div id="ins-token-donut"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">◷ ${escHtml(t('timingStatsTitle'))}</span>
            <span class="card-subtitle">${escHtml(t('sessionCumulative'))}</span>
            <span class="card-subtitle mono">${escHtml(t('outputSpeed'))} ${timing.outputTokensPerSec || 0} tok/s</span>
          </div>
          <div id="ins-timing-donut"></div>
        </div>
      </div>

      <!-- Row 3: 4-Column Distribution Row (Projects | Skills | Tools | Commands) -->
      <div class="dsh-rank-4">
        ${renderDshRankCard({
          icon: '❐',
          title: t('rankProjects'),
          subtitle: isZh ? `${projects.length} 个项目 · ${fmtTokens(kpi.billableTokens)}` : `${projects.length} projects · ${fmtTokens(kpi.billableTokens)}`,
          items: projects,
          activeKey: filters.workspace,
          dataAttr: 'rproj',
          valueFmt: (it) => `×${it.count} · ${escHtml(fmtTokens(it.tokens))}`,
        })}
        ${renderDshRankCard({
          icon: '✦',
          title: t('rankSkills'),
          subtitle: isZh ? `${skills.length} 个技能 · ${fmtCompactCount(totalSkillLoads)} 次加载` : `${skills.length} skills · ${fmtCompactCount(totalSkillLoads)}`,
          items: skills,
          activeKey: filters.skill,
          dataAttr: 'rskill',
          barColor: '#6366f1',
          valueFmt: (it) => `×${escHtml(fmtCompactCount(it.count))}`,
        })}
        ${renderDshRankCard({
          icon: '⟨/⟩',
          title: t('rankTools'),
          subtitle: isZh ? `${tools.length} 个工具 · ${fmtCompactCount(totalToolCallsRank)} 次调用` : `${tools.length} tools · ${fmtCompactCount(totalToolCallsRank)}`,
          items: tools,
          activeKey: filters.tool,
          dataAttr: 'rtool',
          barColor: '#f59e0b',
          valueFmt: (it) => `×${escHtml(fmtCompactCount(it.count))}`,
        })}
        ${renderDshRankCard({
          icon: '>_',
          title: t('rankCommands'),
          subtitle: isZh ? `${cmds.length} 个程序 · ${fmtCompactCount(totalCmdExecs)} 次执行` : `${cmds.length} cmds · ${fmtCompactCount(totalCmdExecs)}`,
          items: cmds,
          activeKey: filters.cmd,
          dataAttr: 'rcmd',
          barColor: '#f59e0b',
          valueFmt: (it) => `×${escHtml(fmtCompactCount(it.count))}${it.failed ? ` · <span style="color:var(--danger)">${it.failed}!</span>` : ''}`,
        })}
      </div>

      <!-- Row 4: Filterable Sessions Card -->
      <div class="card">
        <div class="card-header">
          <div class="filter-bar">
            <span class="card-title">${escHtml(t('sessionsTitle'))} <span class="pill mono">${(data.sessions || []).length}</span></span>
            ${filters.workspace ? `<span class="pill pill-accent">${escHtml(filters.workspace)}</span>` : ''}
            ${filters.skill ? `<span class="pill pill-accent">Skill: ${escHtml(filters.skill)}</span>` : ''}
            ${filters.tool ? `<span class="pill pill-accent">Tool: ${escHtml(filters.tool)}</span>` : ''}
            ${filters.cmd ? `<span class="pill pill-accent">Cmd: ${escHtml(filters.cmd)}</span>` : ''}
            ${hasActiveChips ? `<button class="btn btn-sm" id="ins-clear">${escHtml(t('clearFilters'))}</button>` : ''}
          </div>
          <div class="filter-bar">
            <select class="select" id="ins-ws">
              <option value="">${escHtml(t('allWorkspaces'))}</option>
              ${(data.workspaces || []).map(w => `<option value="${escHtml(w)}" ${filters.workspace === w ? 'selected' : ''}>${escHtml(w)}</option>`).join('')}
            </select>
            <input class="input" id="ins-q" type="search" style="min-width:170px" placeholder="${escHtml(t('searchSessions'))}" value="${escHtml(filters.q || '')}"/>
            <select class="select" id="ins-sort">
              <option value="recent" ${filters.sort === 'recent' ? 'selected' : ''}>${escHtml(t('sortRecent'))}</option>
              <option value="tokens" ${filters.sort === 'tokens' ? 'selected' : ''}>${escHtml(t('sortTokens'))}</option>
              <option value="context" ${filters.sort === 'context' ? 'selected' : ''}>${escHtml(t('sortContext'))}</option>
              <option value="cost" ${filters.sort === 'cost' ? 'selected' : ''}>${escHtml(t('sortCost'))}</option>
            </select>
          </div>
        </div>
        ${(data.sessions || []).length === 0
          ? `<div class="empty-state">${escHtml(t('noSessions'))}</div>`
          : `<div class="grid-sessions">
              ${data.sessions.map(s => `
                <div class="session-card" data-open-session="${escHtml(s.id)}">
                  <div class="session-card-title" title="${escHtml(s.title)}">${escHtml(s.title)}</div>
                  <div class="session-card-meta">
                    <span class="pill">${escHtml(s.workspaceName)}</span>
                    <span class="mono">${escHtml(fmtRelativeTime(s.lastMs))}</span>
                  </div>
                  ${AGY.charts.renderCompositionBarHtml(s.latestComposition, { mini: true })}
                  <div class="session-card-meta mono">
                    <span>${escHtml(fmtTokens(s.billableTokens))} tok</span>
                    <span>${escHtml(fmtPct(s.cacheHitRate, 0))} cache</span>
                    <span style="color:var(--good)">${escHtml(fmtCost(s.cost))}</span>
                    <span>${s.turnsCount}T</span>
                  </div>
                  <div class="session-card-meta">
                    <span class="card-subtitle mono">${escHtml(s.latestModelLabel)}</span>
                    <span class="pill mono" style="font-size:10px">${Number(s.windowUsagePct || 0).toFixed(1)}% · ${escHtml(fmtTokens(s.latestPromptTokens))}</span>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    `;

    // Render charts
    const c7Host = container.querySelector('#ins-chart7');
    if (c7Host) AGY.charts.renderSevenDayChart(c7Host, data.chart7Days || []);

    const hmHost = container.querySelector('#ins-heatmap');
    if (hmHost) {
      AGY.charts.renderHeatmap56(hmHost, data.heatmap56 || [], filters.day || '', (day) => {
        callbacks?.onFilterChange?.({ day });
      }, hmMetric);
    }

    const tokenDonutHost = container.querySelector('#ins-token-donut');
    if (tokenDonutHost) {
      const tokenItems = [
        { label: t('catSystemBase'), color: 'var(--cat-system)', value: comp.systemBase || 0, sub: `≈${fmtTokens(comp.systemBase || 0)}` },
      { label: t('catToolDefs'), color: 'var(--cat-tool-def)', value: comp.toolDefs || 0, sub: `≈${fmtTokens(comp.toolDefs || 0)}` },
        { label: t('catTools'), color: 'var(--cat-tools)', value: comp.tools || 0, sub: `≈${fmtTokens(comp.tools || 0)}` },
        { label: t('catUser'), color: 'var(--cat-user)', value: comp.user || 0, sub: `≈${fmtTokens(comp.user || 0)}` },
        { label: t('catInjected'), color: 'var(--cat-injected)', value: comp.injected || 0, sub: `≈${fmtTokens(comp.injected || 0)}` },
        { label: t('catSkills'), color: 'var(--cat-skills)', value: comp.skills || 0, sub: `≈${fmtTokens(comp.skills || 0)}` },
        { label: t('catThinking'), color: 'var(--cat-thinking)', value: comp.thinking || 0, sub: `≈${fmtTokens(comp.thinking || 0)}` },
        { label: t('catAssistant'), color: 'var(--cat-assistant)', value: comp.assistant || 0, sub: `≈${fmtTokens(comp.assistant || 0)}` },
        { label: t('catMedia'), color: 'var(--cat-media)', value: comp.media || 0, sub: `≈${fmtTokens(comp.media || 0)}` },
        { label: t('catOther'), color: 'var(--cat-other)', value: comp.other || 0, sub: `≈${fmtTokens(comp.other || 0)}` },
      ];
      AGY.charts.renderDshDonut(tokenDonutHost, {
        centerValue: fmtTokens(kpi.billableTokens || 0),
        centerLabel: t('totalUsage'),
        items: tokenItems,
      });
    }

    const timingDonutHost = container.querySelector('#ins-timing-donut');
    if (timingDonutHost) {
      const reqCount = fmtCompactCount(kpi.requestsCount || 0);
      const toolCount = fmtCompactCount(kpi.toolCallsCount || 0);
      const timesSuffix = isZh ? '次' : ' calls';
      const timingItems = [
        { label: t('modelTime'), color: 'var(--time-model)', value: timing.modelMs || 0, sub: `${fmtDuration(timing.modelMs || 0)} · ${reqCount}${timesSuffix}` },
        { label: t('toolTime'), color: 'var(--time-tool)', value: timing.toolMs || 0, sub: `${fmtDuration(timing.toolMs || 0)} · ${toolCount}${timesSuffix}` },
        { label: t('overheadTime'), color: 'var(--time-overhead)', value: timing.overheadMs || 0, sub: fmtDuration(timing.overheadMs || 0) },
      ];
      AGY.charts.renderDshDonut(timingDonutHost, {
        centerValue: fmtDuration(timing.totalActiveMs || kpi.activeDurationMs || 0),
        centerLabel: t('activeDuration'),
        items: timingItems,
      });
    }

    // Event bindings
    container.querySelector('#ins-open-settings')?.addEventListener('click', () => {
      callbacks?.onOpenSettings?.();
    });

    container.querySelector('#ins-clear-day')?.addEventListener('click', () => {
      callbacks?.onFilterChange?.({ day: '' });
    });

    container.querySelectorAll('[data-irange]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onRangeChange?.(btn.getAttribute('data-irange')));
    });

    container.querySelectorAll('[data-hm-metric]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onLocalFilterChange?.({ hmMetric: btn.getAttribute('data-hm-metric') }));
    });

    container.querySelector('#ins-ws')?.addEventListener('change', (e) => callbacks?.onFilterChange?.({ workspace: e.target.value }));
    container.querySelector('#ins-sort')?.addEventListener('change', (e) => callbacks?.onFilterChange?.({ sort: e.target.value }));

    const qInput = container.querySelector('#ins-q');
    if (qInput) {
      let timer = null;
      qInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => callbacks?.onFilterChange?.({ q: qInput.value }), 180);
      });
    }

    container.querySelector('#ins-clear')?.addEventListener('click', () => {
      callbacks?.onFilterChange?.({ day: '', skill: '', tool: '', cmd: '', workspace: '', q: '' });
    });

    container.querySelectorAll('[data-rproj]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.getAttribute('data-rproj');
        callbacks?.onFilterChange?.({ workspace: filters.workspace === v ? '' : v });
      });
    });
    container.querySelectorAll('[data-rskill]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.getAttribute('data-rskill');
        callbacks?.onFilterChange?.({ skill: filters.skill === v ? '' : v });
      });
    });
    container.querySelectorAll('[data-rtool]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.getAttribute('data-rtool');
        callbacks?.onFilterChange?.({ tool: filters.tool === v ? '' : v });
      });
    });
    container.querySelectorAll('[data-rcmd]').forEach(el => {
      el.addEventListener('click', () => {
        const v = el.getAttribute('data-rcmd');
        callbacks?.onFilterChange?.({ cmd: filters.cmd === v ? '' : v });
      });
    });

    container.querySelectorAll('[data-open-session]').forEach(card => {
      card.addEventListener('click', () => callbacks?.onOpenSession?.(card.getAttribute('data-open-session')));
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.insights = { render: renderInsights };
})(window);
