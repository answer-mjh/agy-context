(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const CATS = [
    { key: 'systemBase', i18n: 'catSystemBase', color: 'var(--cat-system)' },
    { key: 'toolDefs', i18n: 'catToolDefs', color: 'var(--cat-tool-def)' },
    { key: 'user', i18n: 'catUser', color: 'var(--cat-user)' },
    { key: 'injected', i18n: 'catInjected', color: 'var(--cat-injected)' },
    { key: 'skills', i18n: 'catSkills', color: 'var(--cat-skills)' },
    { key: 'assistant', i18n: 'catAssistant', color: 'var(--cat-assistant)' },
    { key: 'tools', i18n: 'catTools', color: 'var(--cat-tools)' },
    { key: 'media', i18n: 'catMedia', color: 'var(--cat-media)' },
    { key: 'other', i18n: 'catOther', color: 'var(--cat-other)' },
  ];

  function buildLineage(agents) {
    const byId = new Map(agents.map(agent => [agent.id, agent]));
    const map = new Map();
    for (const agent of agents) {
      const ids = new Set([agent.id]);
      let parent = byId.get(agent.parentId);
      while (parent) {
        ids.add(parent.id);
        parent = byId.get(parent.parentId);
      }
      for (const other of agents) {
        let cursor = byId.get(other.parentId);
        while (cursor) {
          if (cursor.id === agent.id) {
            ids.add(other.id);
            break;
          }
          cursor = byId.get(cursor.parentId);
        }
      }
      map.set(agent.id, ids);
    }
    return map;
  }

  function compositionDetail(agent) {
    const { t, fmtTokens, escHtml } = AGY.i18n;
    const comp = agent.composition || {};
    const chips = CATS
      .filter(cat => (comp[cat.key] || 0) > 0)
      .map(cat => `
        <span class="fleet-comp-chip">
          <span class="legend-swatch" style="background:${cat.color}"></span>
          ${escHtml(t(cat.i18n))} <b class="mono">${escHtml(fmtTokens(comp[cat.key] || 0))}</b>
        </span>
      `).join('');
    return chips || `<span class="card-subtitle">${escHtml(t('noRecords'))}</span>`;
  }

  function agentStatusLabel(agent) {
    const { t } = AGY.i18n;
    return agent.running ? t('fleetRunningStatus') : t('fleetIdle');
  }

  function renderAgentCard(agent, data, state, lineage) {
    const { t, fmtTokens, fmtCost, fmtDuration, escHtml } = AGY.i18n;
    const selected = state.selectedAgent === agent.id || (!state.selectedAgent && agent.isCurrent);
    const title = agent.role || agent.agentName || agent.title || agent.shortId;
    const usage = Math.max(0, Math.min(100, Number(agent.usagePct) || 0));
    const lineageIds = [...(lineage.get(agent.id) || [agent.id])].join(',');
    return `
      <div class="fleet-agent-card ${agent.isCurrent ? 'is-current' : ''} ${selected ? 'is-selected' : ''}"
           data-agent-id="${escHtml(agent.id)}" data-lineage="${escHtml(lineageIds)}">
        <div class="fleet-agent-head">
          <span class="fleet-status-dot ${agent.running ? 'is-running' : 'is-idle'}"></span>
          <span class="fleet-agent-title" title="${escHtml(agent.id)}">${escHtml(title)}</span>
          ${agent.agentName ? `<span class="fleet-agent-badge">${escHtml(agent.agentName)}</span>` : ''}
          ${agent.isCurrent ? `<span class="fleet-current-chip">${escHtml(t('fleetCurrentAgent'))}</span>` : ''}
        </div>
        <div class="fleet-agent-sub mono">${escHtml(agent.shortId)} · ${escHtml(agent.modelLabel || '—')}</div>
        <div class="fleet-agent-usage">
          <span>${escHtml(t('fleetContextUsed'))} <b class="mono" style="color:${usage >= 80 ? 'var(--danger)' : usage >= 60 ? 'var(--warn)' : 'inherit'}">${usage.toFixed(1)}%</b></span>
          <span class="mono">${escHtml(fmtTokens(agent.promptTokens || 0))} / ${escHtml(fmtTokens(agent.contextWindow || 0))}</span>
        </div>
        ${AGY.charts.renderCompositionBarHtml(agent.composition, { contextWindow: agent.contextWindow, mini: true })}
        <div class="fleet-agent-stats">
          <span>${escHtml(t('fleetSteps'))} <b class="mono">${agent.steps}</b></span>
          <span>${escHtml(t('fleetRequests'))} <b class="mono">${agent.requests}</b></span>
          <span>${escHtml(t('fleetActive'))} <b class="mono">${escHtml(fmtDuration(agent.activeMs || 0))}</b></span>
        </div>
        <div class="fleet-agent-foot">
          <span class="mono">${escHtml(fmtTokens(agent.billableTokens || 0))} · ${escHtml(fmtCost(agent.cost || 0))}</span>
          <button class="fleet-open-btn" data-open-agent="${escHtml(agent.id)}">${escHtml(t('fleetOpenContext'))} →</button>
        </div>
      </div>
    `;
  }

  function renderAgentDetail(agent, tasks) {
    const { t, fmtTokens, fmtCost, fmtDuration, fmtClock, escHtml, renderSimpleMarkdown } = AGY.i18n;
    if (!agent) return '';
    const task = tasks.find(item => item.agentId === agent.id) || null;
    const brief = task?.brief ? renderSimpleMarkdown(task.brief) : '';
    return `
      <div class="fleet-detail-head">
        <span class="fleet-detail-title">${escHtml(agent.role || agent.agentName || agent.title)}</span>
        <span class="fleet-agent-badge">${escHtml(agent.agentName || (agent.isRoot ? t('fleetRootAgent') : t('fleetChildAgent')))}</span>
        <span class="card-subtitle mono">${escHtml(agent.shortId)} · ${escHtml(agentStatusLabel(agent))}</span>
      </div>
      <div class="fleet-comp-chips">${compositionDetail(agent)}</div>
      <div class="fleet-detail-meta">
        <span>${escHtml(t('fleetSteps'))} <b class="mono">${agent.steps}</b></span>
        <span>${escHtml(t('fleetRequests'))} <b class="mono">${agent.requests}</b></span>
        <span>${escHtml(t('toolCalls'))} <b class="mono">${agent.toolCalls}</b></span>
        <span>${escHtml(t('fleetActive'))} <b class="mono">${escHtml(fmtDuration(agent.activeMs || 0))}</b></span>
        <span>${escHtml(t('fleetBilled'))} <b class="mono">${escHtml(fmtTokens(agent.billableTokens || 0))}</b> · ${escHtml(fmtCost(agent.cost || 0))}</span>
        ${agent.firstMs ? `<span>${escHtml(t('fleetStarted'))} <b class="mono">${escHtml(fmtClock(agent.firstMs))}</b></span>` : ''}
      </div>
      ${brief ? `
        <div class="fleet-detail-brief">
          <span class="fleet-detail-label">${escHtml(t('fleetTaskBrief'))}</span>
          <div class="fleet-detail-brief-body">${brief}</div>
        </div>
      ` : ''}
      <div class="fleet-detail-actions">
        <button class="btn btn-sm" data-open-agent="${escHtml(agent.id)}">${escHtml(t('fleetOpenContext'))} →</button>
      </div>
    `;
  }

  function renderLane(agent, timeline, minMs, spanMs, state, taskByAgent) {
    const { t, fmtClock, escHtml } = AGY.i18n;
    const collapsed = state.collapsed.has(agent.id);
    const markers = timeline.filter(item => item.agentId === agent.id);
    const title = agent.role || agent.agentName || agent.title || agent.shortId;
    const markerHtml = markers.map(item => {
      const rawPct = spanMs > 0 ? Math.max(0, Math.min(1, (item.ts - minMs) / spanMs)) : 0;
      const pct = 1.5 + rawPct * 97;
      const label = item.kind === 'delegate' ? t('fleetEventDelegate') : item.kind === 'complete' ? t('fleetEventComplete') : t('fleetEventMessage');
      const peerId = item.kind === 'delegate' ? item.to : item.from === agent.id ? item.to : item.from;
      return `
        <button class="fleet-marker kind-${item.kind}" style="left:${pct.toFixed(3)}%"
                data-task-id="${escHtml(item.taskId || '')}" data-agent-id="${escHtml(agent.id)}"
                title="${escHtml(`${fmtClock(item.ts)} · ${label} · ${String(item.detail || '').slice(0, 120)}`)}"></button>
      `;
    }).join('');
    const task = taskByAgent.get(agent.id);
    return `
      <div class="fleet-lane ${collapsed ? 'is-collapsed' : ''}" data-lane-agent="${escHtml(agent.id)}">
        <button class="fleet-lane-head" data-toggle-lane="${escHtml(agent.id)}">
          <span class="fleet-status-dot ${agent.running ? 'is-running' : 'is-idle'}"></span>
          <span class="fleet-lane-title">${escHtml(title)}</span>
          ${task ? `<span class="fleet-task-status ${task.status}">${escHtml(task.status === 'completed' ? t('fleetTaskCompleted') : t('fleetTaskInProgress'))}</span>` : ''}
          <span class="fleet-lane-count mono">${markers.length}</span>
        </button>
        <div class="fleet-lane-track" title="${escHtml(fmtClock(minMs))} → ${escHtml(fmtClock(minMs + spanMs))}">
          <div class="fleet-lane-axis"></div>
          ${markerHtml}
        </div>
      </div>
    `;
  }

  function render(host, data, state, callbacks) {
    const { t, fmtTokens, fmtCost, fmtDuration, fmtClock, escHtml, renderSimpleMarkdown } = AGY.i18n;
    if (!data || data.empty) {
      host.innerHTML = `<div class="card"><div class="empty-state">${escHtml(t('noData'))}</div></div>`;
      return;
    }

    const agents = data.agents || [];
    const tasks = data.tasks || [];
    const timeline = data.timeline || [];
    const summary = data.summary || {};
    const byId = new Map(agents.map(agent => [agent.id, agent]));
    const lineage = buildLineage(agents);
    const taskByAgent = new Map(tasks.map(task => [task.agentId, task]));
    const current = agents.find(agent => agent.isCurrent) || agents[0] || null;
    const selectedId = state.selectedAgent || current?.id || '';
    const selected = byId.get(selectedId) || current;
    const selectedTask = state.selectedTask ? tasks.find(task => task.id === state.selectedTask) : null;
    const levels = [...new Set(agents.map(agent => agent.depth))].sort((a, b) => a - b);

    const summaryTiles = [
      { label: t('fleetAgentCount'), value: summary.agents || 0, sub: `${summary.children || 0} ${t('fleetChildCount')}` },
      { label: t('fleetRunning'), value: summary.running || 0, sub: '', accent: summary.running ? 'var(--good)' : '' },
      { label: t('fleetWorkItems'), value: summary.tasks || 0, sub: `${summary.completedTasks || 0} ${t('fleetTaskCompleted')}` },
      { label: t('fleetMessages'), value: summary.messages || 0, sub: '' },
      { label: t('fleetFamilyTokens'), value: fmtTokens(summary.billableTokens || 0), sub: fmtCost(summary.cost || 0), mono: true },
    ];

    const laneDomain = timeline.length
      ? { min: Math.min(...timeline.map(item => item.ts)), max: Math.max(...timeline.map(item => item.ts)) }
      : { min: 0, max: 0 };
    const spanMs = Math.max(1, laneDomain.max - laneDomain.min);
    const laneQuery = String(state.laneQuery || '').trim().toLowerCase();
    const laneAgents = agents.filter(agent => {
      if (!laneQuery) return true;
      const hay = `${agent.title} ${agent.agentName} ${agent.role} ${agent.shortId}`.toLowerCase();
      return hay.includes(laneQuery);
    });
    const laneOrder = state.laneOrder === 'desc' ? [...laneAgents].reverse() : laneAgents;

    const taskFilter = state.taskFilter || 'all';
    const filteredTasks = tasks.filter(task => taskFilter === 'all' || task.status === taskFilter);
    const eventFilter = state.eventFilter || 'all';
    const eventQuery = String(state.eventQuery || '').trim().toLowerCase();
    const filteredEvents = timeline.filter(item => {
      if (eventFilter !== 'all' && item.kind !== eventFilter) return false;
      if (!eventQuery) return true;
      const from = byId.get(item.from);
      const to = byId.get(item.to);
      const hay = [
        item.title, item.detail,
        from?.title, from?.agentName, from?.role,
        to?.title, to?.agentName, to?.role,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(eventQuery);
    });
    const eventLimit = Number(state.eventLimit) || 120;
    const visibleEvents = filteredEvents.slice(0, eventLimit);

    host.innerHTML = `
      <div class="fleet-page">
        <div class="card fleet-summary-card">
          <div class="card-header">
            <span class="card-title">🚢 ${escHtml(t('fleetSummary'))}</span>
            <span class="card-subtitle mono">${escHtml(t('fleetFamily'))} ${escHtml(data.rootId ? data.rootId.slice(0, 8) : '')}</span>
          </div>
          <div class="fleet-summary-strip">
            ${summaryTiles.map(tile => `
              <div class="fleet-summary-tile">
                <div class="fleet-summary-num ${tile.mono ? 'mono' : ''}" style="${tile.accent ? `color:${tile.accent}` : ''}">${escHtml(String(tile.value))}</div>
                <div class="fleet-summary-lbl">${escHtml(tile.label)}</div>
                ${tile.sub ? `<div class="fleet-summary-sub mono">${escHtml(tile.sub)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="grid-fleet-top">
          <div class="card fleet-network-card">
            <div class="card-header">
              <span class="card-title">🕸 ${escHtml(t('fleetAgentNetwork'))}</span>
              <span class="card-subtitle">${escHtml(t('fleetAgentNetworkHint'))}</span>
            </div>
            ${agents.length <= 1 && tasks.length === 0 ? `
              <div class="fleet-empty-inline">${escHtml(t('fleetNoFamilyHint'))}</div>
            ` : ''}
            <div class="fleet-tree">
              ${levels.map(depth => {
                const levelAgents = agents.filter(agent => agent.depth === depth);
                return `
                  <div class="fleet-level" data-depth="${depth}">
                    <div class="fleet-level-label">${escHtml(depth === 0 ? t('fleetRootAgent') : `${t('fleetChildAgent')} · L${depth}`)}</div>
                    <div class="fleet-level-cards">
                      ${levelAgents.map(agent => renderAgentCard(agent, data, { ...state, selectedAgent: selectedId }, lineage)).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            <div class="fleet-agent-detail" id="fleet-agent-detail">${renderAgentDetail(selected, tasks)}</div>
          </div>

          <div class="card fleet-collab-card">
            <div class="card-header">
              <span class="card-title">🛰 ${escHtml(t('fleetCollaboration'))}</span>
              <span class="card-subtitle">${escHtml(t('fleetCollabHint'))}</span>
            </div>
            <div class="fleet-collab-toolbar">
              <input class="input fleet-lane-search" id="fleet-lane-search" type="search"
                     placeholder="${escHtml(t('fleetSearchLanes'))}" value="${escHtml(state.laneQuery || '')}"/>
              <button class="fleet-order-btn ${state.laneOrder !== 'desc' ? 'active' : ''}" data-lane-order="asc">${escHtml(t('fleetEarliest'))}</button>
              <button class="fleet-order-btn ${state.laneOrder === 'desc' ? 'active' : ''}" data-lane-order="desc">${escHtml(t('fleetLatest'))}</button>
            </div>
            <div class="fleet-lanes">
              ${timeline.length === 0 ? `<div class="fleet-empty-inline">${escHtml(t('fleetNoEvents'))}</div>` : laneOrder.map(agent =>
                renderLane(agent, timeline, laneDomain.min, spanMs, state, taskByAgent)
              ).join('')}
            </div>
            ${timeline.length > 0 ? `
              <div class="fleet-lane-ticks mono">
                <span>${escHtml(fmtClock(laneDomain.min))}</span>
                <span>${escHtml(fmtClock(laneDomain.min + spanMs / 2))}</span>
                <span>${escHtml(fmtClock(laneDomain.max))}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="card fleet-tasks-card">
          <div class="card-header">
            <span class="card-title">✅ ${escHtml(t('fleetTasks'))}</span>
            <span class="card-subtitle">${escHtml(t('fleetTasksHint'))}</span>
          </div>
          <div class="fleet-filter-row">
            ${['all', 'in_progress', 'completed'].map(key => `
              <button class="fleet-filter-chip ${taskFilter === key ? 'active' : ''}" data-task-filter="${key}">
                ${escHtml(key === 'all' ? t('fleetEventAll') : key === 'completed' ? t('fleetTaskCompleted') : t('fleetTaskInProgress'))}
              </button>
            `).join('')}
          </div>
          ${filteredTasks.length === 0 ? `<div class="fleet-empty-inline">${escHtml(t('fleetNoTasks'))}</div>` : `
            <div class="fleet-task-list">
              ${filteredTasks.map(task => {
                const agent = byId.get(task.agentId);
                const parent = byId.get(task.parentId);
                const expanded = state.expanded.has(task.id);
                return `
                  <div class="fleet-task-card ${expanded ? 'is-open' : ''} ${state.selectedTask === task.id ? 'is-selected' : ''}" data-task-card="${escHtml(task.id)}">
                    <div class="fleet-task-head">
                      <span class="fleet-task-status ${task.status}">${escHtml(task.status === 'completed' ? t('fleetTaskCompleted') : t('fleetTaskInProgress'))}</span>
                      <span class="fleet-task-title">${escHtml(task.title)}</span>
                      ${task.agentName ? `<span class="fleet-agent-badge">${escHtml(task.agentName)}</span>` : ''}
                      <span class="fleet-task-owner card-subtitle">
                        ${escHtml(parent?.role || parent?.agentName || t('fleetRootAgent'))}
                        <span class="mono">→ ${escHtml(agent?.shortId || task.agentId.slice(0, 8))}</span>
                      </span>
                    </div>
                    <div class="fleet-task-meta mono">
                      ${task.startedMs ? `<span>${escHtml(t('fleetStarted'))} ${escHtml(fmtClock(task.startedMs))}</span>` : ''}
                      ${task.completedMs ? `<span>${escHtml(t('fleetFinished'))} ${escHtml(fmtClock(task.completedMs))}</span>` : ''}
                      ${task.completedMs && task.startedMs ? `<span>${escHtml(fmtDuration(task.completedMs - task.startedMs))}</span>` : ''}
                    </div>
                    <div class="fleet-task-brief ${expanded ? '' : 'is-clamped'}">${renderSimpleMarkdown(task.brief || '')}</div>
                    ${expanded && task.report ? `
                      <div class="fleet-task-report">
                        <div class="fleet-detail-label">${escHtml(t('fleetTaskReport'))}</div>
                        <div class="fleet-task-report-body">${renderSimpleMarkdown(task.report)}</div>
                      </div>
                    ` : ''}
                    <div class="fleet-task-actions">
                      <button class="btn btn-sm" data-toggle-task="${escHtml(task.id)}">${escHtml(expanded ? t('fleetCollapse') : t('fleetExpand'))}</button>
                      <button class="btn btn-sm" data-open-agent="${escHtml(task.agentId)}">${escHtml(t('fleetOpenContext'))} →</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div class="card fleet-events-card">
          <div class="card-header">
            <span class="card-title">📡 ${escHtml(t('fleetEvents'))}</span>
            <span class="card-subtitle">${escHtml(t('fleetEventsHint'))}</span>
          </div>
          <div class="fleet-filter-row">
            ${['all', 'delegate', 'message', 'complete'].map(key => `
              <button class="fleet-filter-chip ${eventFilter === key ? 'active' : ''}" data-event-filter="${key}">
                ${escHtml(key === 'all' ? t('fleetEventAll') : key === 'delegate' ? t('fleetEventDelegate') : key === 'complete' ? t('fleetEventComplete') : t('fleetEventMessage'))}
              </button>
            `).join('')}
            <input class="input fleet-event-search" id="fleet-event-search" type="search"
                   placeholder="${escHtml(t('fleetSearchEvents'))}" value="${escHtml(state.eventQuery || '')}"/>
          </div>
          ${filteredEvents.length === 0 ? `<div class="fleet-empty-inline">${escHtml(t('fleetNoEvents'))}</div>` : `
            <div class="fleet-event-list">
              ${visibleEvents.map(item => {
                const from = byId.get(item.from);
                const to = byId.get(item.to);
                const expanded = state.expanded.has(`ev-${item.id}`);
                const label = item.kind === 'delegate' ? t('fleetEventDelegate') : item.kind === 'complete' ? t('fleetEventComplete') : t('fleetEventMessage');
                return `
                  <div class="fleet-event-row ${expanded ? 'is-open' : ''}" data-event-row="${escHtml(item.id)}">
                    <div class="fleet-event-head">
                      <span class="mono fleet-event-time">${escHtml(fmtClock(item.ts))}</span>
                      <span class="fleet-event-kind kind-${item.kind}">${escHtml(label)}</span>
                      <span class="fleet-event-peer">
                        ${escHtml(from?.role || from?.agentName || from?.shortId || item.from.slice(0, 8))}
                        <span class="mono">→</span>
                        ${escHtml(to?.role || to?.agentName || to?.shortId || item.to.slice(0, 8))}
                      </span>
                      ${item.title ? `<span class="fleet-event-title">${escHtml(item.title)}</span>` : ''}
                    </div>
                    <div class="fleet-event-detail ${expanded ? '' : 'is-clamped'}">${renderSimpleMarkdown(item.detail || '')}</div>
                    <button class="fleet-event-toggle" data-toggle-event="${escHtml(item.id)}">${escHtml(expanded ? t('fleetCollapse') : t('fleetExpand'))}</button>
                  </div>
                `;
              }).join('')}
            </div>
            ${filteredEvents.length > visibleEvents.length ? `
              <button class="btn btn-sm fleet-more-btn" data-more-events="1">${escHtml(t('fleetShowMore'))} (${filteredEvents.length - visibleEvents.length})</button>
            ` : ''}
          `}
        </div>
      </div>
    `;

    bind(host, data, state, callbacks, selected, tasks);
  }

  function bind(host, data, state, callbacks, selected, tasks) {
    let hovered = '';
    const cards = [...host.querySelectorAll('.fleet-agent-card')];
    const detail = host.querySelector('#fleet-agent-detail');
    const byId = new Map(data.agents.map(agent => [agent.id, agent]));

    function highlight(agentId) {
      const card = cards.find(item => item.getAttribute('data-agent-id') === agentId);
      const ids = new Set(String(card?.getAttribute('data-lineage') || '').split(',').filter(Boolean));
      cards.forEach(item => {
        const id = item.getAttribute('data-agent-id');
        item.classList.toggle('is-dim', Boolean(agentId) && !ids.has(id));
        item.classList.toggle('is-lineage', Boolean(agentId) && ids.has(id) && id !== agentId);
      });
    }

    cards.forEach(card => {
      card.addEventListener('mouseenter', () => {
        hovered = card.getAttribute('data-agent-id') || '';
        highlight(hovered);
        const agent = byId.get(hovered);
        if (detail && agent) detail.innerHTML = renderAgentDetail(agent, tasks);
      });
      card.addEventListener('mouseleave', () => {
        hovered = '';
        highlight('');
        if (detail && selected) detail.innerHTML = renderAgentDetail(selected, tasks);
      });
      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-open-agent]')) return;
        callbacks?.onSelectAgent?.(card.getAttribute('data-agent-id') || '');
      });
    });

    host.querySelectorAll('[data-open-agent]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks?.onOpenAgent?.(btn.getAttribute('data-open-agent') || '');
      });
    });

    host.querySelectorAll('[data-toggle-lane]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onToggleLane?.(btn.getAttribute('data-toggle-lane') || ''));
    });

    host.querySelectorAll('[data-lane-order]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onLaneOrder?.(btn.getAttribute('data-lane-order') || 'asc'));
    });

    const laneSearch = host.querySelector('#fleet-lane-search');
    if (laneSearch) {
      laneSearch.addEventListener('input', () => {
        const value = laneSearch.value;
        callbacks?.onLaneQuery?.(value);
        const pos = value.length;
        const next = host.querySelector('#fleet-lane-search');
        if (next) { next.focus(); next.setSelectionRange(pos, pos); }
      });
    }

    host.querySelectorAll('[data-task-filter]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onTaskFilter?.(btn.getAttribute('data-task-filter') || 'all'));
    });

    host.querySelectorAll('[data-event-filter]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onEventFilter?.(btn.getAttribute('data-event-filter') || 'all'));
    });

    const eventSearch = host.querySelector('#fleet-event-search');
    if (eventSearch) {
      eventSearch.addEventListener('input', () => {
        const value = eventSearch.value;
        callbacks?.onEventQuery?.(value);
        const pos = value.length;
        const next = host.querySelector('#fleet-event-search');
        if (next) { next.focus(); next.setSelectionRange(pos, pos); }
      });
    }

    host.querySelectorAll('[data-task-card]').forEach(card => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-open-agent]') || event.target.closest('[data-toggle-task]')) return;
        callbacks?.onSelectTask?.(card.getAttribute('data-task-card') || '');
      });
    });
    host.querySelectorAll('[data-toggle-task]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks?.onToggleExpand?.(btn.getAttribute('data-toggle-task') || '');
      });
    });

    host.querySelectorAll('[data-event-row]').forEach(row => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('[data-toggle-event]')) return;
        const id = row.getAttribute('data-event-row') || '';
        callbacks?.onSelectEvent?.(id);
      });
    });
    host.querySelectorAll('[data-toggle-event]').forEach(btn => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks?.onToggleExpand?.(`ev-${btn.getAttribute('data-toggle-event') || ''}`);
      });
    });

    host.querySelectorAll('[data-more-events]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onMoreEvents?.());
    });

    host.querySelectorAll('.fleet-marker').forEach(marker => {
      marker.addEventListener('click', () => callbacks?.onSelectTask?.(marker.getAttribute('data-task-id') || ''));
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.fleet = { render };
})(window);
