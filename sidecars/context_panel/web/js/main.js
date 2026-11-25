(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const viewMode = document.body.getAttribute('data-view') || 'sidebar';
  const isAuxPane = viewMode === 'aux';
  const initialHostId = isAuxPane ? (AGY.bridge.getHostConversationId() || '') : '';

  const appState = {
    page: isAuxPane ? 'context' : 'insights', // 'insights' | 'context' | 'fleet'
    prefs: {
      lang: 'zh',
      insightsRange: '30d',
      insightsSort: 'recent',
      timelineGranularity: 'step',
      timelineMode: 'total',
      browserBaseline: 'prev_turn',
      fleetTab: 'show',
    },
    settingsOpen: false,
    // Insights state
    insightsData: null,
    insightsFilters: {
      range: '30d',
      day: '',
      workspace: '',
      q: '',
      skill: '',
      tool: '',
      cmd: '',
      sort: 'recent',
      hmMetric: 'tokens',
    },
    // Context dashboard state
    sessionId: initialHostId,
    hostSessionId: initialHostId,
    emptyReason: '',
    sessionsList: [],
    sessionData: null,
    stepData: null,
    timeline: {
      granularity: 'step',
      mode: 'total',
      pinnedSeq: -1,
      hoveredSeq: -1,
    },
    browser: {
      viewMode: 'categories',
      baseline: 'prev_turn',
      search: '',
      assistantKind: '',
      openCats: new Set(['user', 'assistant', 'tool_results']),
      openItems: new Set(),
      rawItems: new Set(),
      catSort: {},
    },
    events: { type: 'all' },
    files: { kind: 'all', search: '', sortBy: 'ops', expanded: new Set() },
    commands: { status: 'all', search: '', program: '' },
    fleet: {
      data: null,
      selectedAgent: '',
      selectedTask: '',
      taskFilter: 'all',
      eventFilter: 'all',
      eventQuery: '',
      laneQuery: '',
      laneOrder: 'asc',
      eventLimit: 120,
      collapsed: new Set(),
      expanded: new Set(),
    },
  };

  let hoverFetchTimer = null;
  let pollTimer = null;
  let sessionLoadToken = 0;

  function qs(obj) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(obj || {})) {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  function renderTopbar() {
    const { t, escHtml } = AGY.i18n;
    const topbar = document.getElementById('topbar');
    if (!topbar) return;
    const showFleetTab = appState.prefs.fleetTab !== 'hide';

    const sessOptions = [
      `<option value="" ${!appState.sessionId ? 'selected' : ''}>${escHtml(t('selectSessionPlaceholder'))}</option>`,
      ...(appState.sessionsList || []).map(
        s => `<option value="${escHtml(s.id)}" ${s.id === appState.sessionId ? 'selected' : ''}>${escHtml(s.title)} (${escHtml(s.workspaceName)})</option>`
      ),
    ].join('');

    const activeTitle = appState.sessionData?.meta?.title || '';
    const shortId = appState.sessionId ? appState.sessionId.slice(0, 8) : '';
    const viewingChildInAux = isAuxPane && appState.hostSessionId && appState.sessionId && appState.sessionId !== appState.hostSessionId;

    topbar.innerHTML = `
      <div class="topbar-left">
        <span class="brand"><span class="brand-dot"></span>${escHtml(t('brand'))}</span>
        <div class="nav-tabs topbar-tabs">
          ${!isAuxPane ? `<button class="nav-tab ${appState.page === 'insights' ? 'active' : ''}" data-nav="insights">${escHtml(t('navInsights'))}</button>` : ''}
          <button class="nav-tab ${appState.page === 'context' ? 'active' : ''}" data-nav="context">${escHtml(t('navContext'))}</button>
          ${showFleetTab ? `<button class="nav-tab ${appState.page === 'fleet' ? 'active' : ''}" data-nav="fleet">${escHtml(t('navFleet'))}</button>` : ''}
        </div>
        ${isAuxPane
          ? (shortId
              ? `<span class="pill mono" title="${escHtml(appState.sessionId)}" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${escHtml(activeTitle || shortId)}${activeTitle ? ` · ${escHtml(shortId)}` : ''}</span>`
              : '')
            + (viewingChildInAux
              ? `<button class="btn btn-sm" id="btn-back-host-session">← ${escHtml(t('backToCurrentSession'))}</button>`
              : '')
          : ((appState.page === 'context' || appState.page === 'fleet') && appState.sessionsList.length > 0
              ? `<select class="select session-select" id="top-session-select">${sessOptions}</select>`
              : '')
        }
      </div>
      <div class="topbar-right">
        <button class="btn btn-sm" id="btn-refresh">${escHtml(t('refresh'))}</button>
        <button class="btn btn-sm" id="btn-lang">${escHtml(t('langToggle'))}</button>
        <button class="btn btn-sm" id="btn-settings">${escHtml(t('settings'))}</button>
      </div>
    `;

    topbar.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextPage = btn.getAttribute('data-nav');
        if (isAuxPane && nextPage === 'insights') return;
        if (nextPage !== appState.page) {
          appState.page = nextPage;
          renderTopbar();
          loadActivePage();
        }
      });
    });

    const backHostBtn = topbar.querySelector('#btn-back-host-session');
    if (backHostBtn) {
      backHostBtn.addEventListener('click', () => {
        if (appState.hostSessionId) openContextFor(appState.hostSessionId);
      });
    }

    const sessSel = topbar.querySelector('#top-session-select');
    if (sessSel) {
      sessSel.addEventListener('change', () => {
        appState.sessionId = sessSel.value;
        appState.timeline.pinnedSeq = -1;
        appState.timeline.hoveredSeq = -1;
        appState.browser.openItems.clear();
        appState.sessionData = null;
        appState.stepData = null;
        appState.fleet.data = null;
        appState.fleet.signature = '';
        appState.fleet.selectedAgent = '';
        appState.fleet.selectedTask = '';
        if (appState.page === 'fleet') loadFleet(true);
        else loadContextSession();
      });
    }

    const refBtn = topbar.querySelector('#btn-refresh');
    if (refBtn) refBtn.addEventListener('click', () => loadActivePage(true));

    const langBtn = topbar.querySelector('#btn-lang');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        const nextLang = AGY.i18n.getLang() === 'zh' ? 'en' : 'zh';
        savePrefPatch({ lang: nextLang });
      });
    }

    const setBtn = topbar.querySelector('#btn-settings');
    if (setBtn) {
      setBtn.addEventListener('click', () => {
        appState.settingsOpen = true;
        renderSettings();
      });
    }
  }

  function renderSettings() {
    const el = document.getElementById('settings-drawer');
    if (!el) return;
    AGY.views.settings.render(el, appState.prefs, appState.settingsOpen, {
      onClose: () => {
        appState.settingsOpen = false;
        renderSettings();
      },
      onSavePref: (patch) => savePrefPatch(patch),
    });
  }

  async function savePrefPatch(patch) {
    try {
      const saved = await AGY.bridge.apiFetch('/api/prefs', {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      appState.prefs = saved;
    } catch {
      appState.prefs = Object.assign({}, appState.prefs, patch);
    }
    applyPrefsToState(patch);
    if (appState.prefs.fleetTab === 'hide' && appState.page === 'fleet') {
      appState.page = 'context';
      loadActivePage();
    }
    renderTopbar();
    renderSettings();
    renderMain();
  }

  function applyPrefsToState(patch) {
    AGY.i18n.setLang(appState.prefs.lang);
    if (!patch || patch.insightsRange) appState.insightsFilters.range = appState.prefs.insightsRange;
    if (!patch || patch.timelineGranularity) appState.timeline.granularity = appState.prefs.timelineGranularity;
    if (!patch || patch.timelineMode) appState.timeline.mode = appState.prefs.timelineMode;
    if (!patch || patch.browserBaseline) appState.browser.baseline = appState.prefs.browserBaseline;
  }

  function syncHostConversation(nextHostId) {
    if (!isAuxPane) return false;
    const clean = typeof nextHostId === 'string' ? nextHostId.trim() : '';
    if (!clean || clean === appState.hostSessionId) return false;
    appState.hostSessionId = clean;
    appState.sessionId = clean;
    appState.emptyReason = '';
    appState.sessionData = null;
    appState.stepData = null;
    appState.timeline.pinnedSeq = -1;
    appState.timeline.hoveredSeq = -1;
    appState.browser.openItems.clear();
    appState.fleet.data = null;
    appState.fleet.signature = '';
    appState.fleet.selectedAgent = '';
    appState.fleet.selectedTask = '';
    if (appState.page === 'insights') appState.page = 'context';
    renderTopbar();
    return true;
  }

  function renderSessionEmptyMessage() {
    const { t, escHtml } = AGY.i18n;
    if (appState.emptyReason === 'no_transcript_yet') {
      const idBadge = appState.sessionId ? ` <span class="pill mono">${escHtml(appState.sessionId.slice(0, 8))}</span>` : '';
      return `<div class="card"><div class="empty-state">${escHtml(t('emptyWaitingTranscript'))}${idBadge}</div></div>`;
    }
    if (isAuxPane) {
      return `<div class="card"><div class="empty-state">${escHtml(t('emptyNoHostConversation'))}</div></div>`;
    }
    return `<div class="card"><div class="empty-state">${escHtml(t('emptySelectSession'))}</div></div>`;
  }

  async function loadInsights(force = false) {
    if (isAuxPane) return;
    const query = Object.assign({}, appState.insightsFilters, force ? { force: 1 } : {});
    try {
      const data = await AGY.bridge.apiFetch(`/api/insights${qs(query)}`);
      appState.insightsData = data;
      if (Array.isArray(data.sessions)) {
        appState.sessionsList = data.sessions.map(s => ({
          id: s.id,
          title: s.title,
          workspaceName: s.workspaceName,
          lastMs: s.lastMs,
          latestModelLabel: s.latestModelLabel,
          windowUsagePct: s.windowUsagePct,
          billableTokens: s.billableTokens,
        }));
      }
      renderMain();
    } catch (err) {
      showError(err);
    }
  }

  async function loadContextSession() {
    if (isAuxPane) {
      const hostConv = AGY.bridge.getHostConversationId();
      if (hostConv && hostConv !== appState.hostSessionId) {
        syncHostConversation(hostConv);
      }
    }

    const targetId = (appState.sessionId || '').trim();
    const myToken = ++sessionLoadToken;

    if (!targetId) {
      appState.sessionData = null;
      appState.stepData = null;
      appState.emptyReason = isAuxPane ? 'missing_conversation_id' : 'select_session';
      if (!isAuxPane && appState.sessionsList.length === 0) {
        try {
          const payload = await AGY.bridge.apiFetch('/api/session');
          if (myToken !== sessionLoadToken) return;
          appState.sessionsList = payload.sessions || [];
        } catch {
          // ignore
        }
      }
      renderTopbar();
      renderMain();
      return;
    }

    try {
      const stepParam = appState.timeline.pinnedSeq >= 0 ? appState.timeline.pinnedSeq : '';
      const payload = await AGY.bridge.apiFetch(`/api/session${qs({ id: targetId, step: stepParam })}`);
      if (myToken !== sessionLoadToken) return;
      appState.sessionsList = payload.sessions || [];
      if (payload.empty || !payload.session) {
        appState.sessionData = null;
        appState.stepData = null;
        appState.emptyReason = payload.reason || 'no_transcript_yet';
        renderTopbar();
        renderMain();
        return;
      }
      appState.emptyReason = '';
      appState.sessionData = payload.session;
      appState.sessionData.fleet = payload.fleet || null;
      renderTopbar();
      renderMain();
      await loadStepBrowser(appState.timeline.pinnedSeq);
    } catch (err) {
      if (myToken !== sessionLoadToken) return;
      showError(err);
    }
  }

  async function loadFleet(force = false) {
    if (isAuxPane) {
      const hostConv = AGY.bridge.getHostConversationId();
      if (hostConv && hostConv !== appState.hostSessionId) {
        syncHostConversation(hostConv);
      }
    }

    const targetId = (appState.sessionId || '').trim();
    const myToken = ++sessionLoadToken;

    if (!targetId) {
      appState.fleet.data = null;
      appState.fleet.signature = '';
      appState.emptyReason = isAuxPane ? 'missing_conversation_id' : 'select_session';
      if (!isAuxPane && appState.sessionsList.length === 0) {
        try {
          const payload = await AGY.bridge.apiFetch('/api/fleet');
          if (myToken !== sessionLoadToken) return;
          appState.sessionsList = payload.sessions || [];
        } catch {
          // ignore
        }
      }
      renderTopbar();
      renderMain();
      return;
    }

    try {
      const data = await AGY.bridge.apiFetch(`/api/fleet${qs({ id: targetId })}`);
      if (myToken !== sessionLoadToken) return;
      if (Array.isArray(data?.sessions) && data.sessions.length > 0) {
        appState.sessionsList = data.sessions;
      }
      if (data?.empty) {
        appState.fleet.data = null;
        appState.fleet.signature = '';
        appState.emptyReason = data.reason || 'no_transcript_yet';
        renderTopbar();
        renderMain();
        return;
      }
      appState.emptyReason = '';
      appState.fleet.data = data;
      const signature = JSON.stringify([
        targetId,
        data?.agents?.map(agent => [agent.id, agent.steps, agent.requests, agent.lastMs, agent.billableTokens, agent.status]),
        data?.tasks?.map(task => [task.id, task.status, task.completedMs]),
        data?.timeline?.length,
        data?.summary,
      ]);
      const sameData = signature === appState.fleet.signature;
      appState.fleet.signature = signature;
      if (data?.currentId && !appState.fleet.selectedAgent) {
        appState.fleet.selectedAgent = data.currentId;
      }
      renderTopbar();
      if (!force && sameData && document.getElementById('fleet-page-host')) return;
      renderMain();
    } catch (err) {
      if (myToken !== sessionLoadToken) return;
      showError(err);
    }
  }

  async function loadStepBrowser(seq) {
    const targetId = (appState.sessionId || '').trim();
    if (!targetId) return;
    try {
      const data = await AGY.bridge.apiFetch(
        `/api/step${qs({ id: targetId, step: seq >= 0 ? seq : '', baseline: appState.browser.baseline })}`
      );
      if (targetId !== appState.sessionId) return;
      appState.stepData = data?.empty ? null : data;
      const host = document.getElementById('ctx-browser-host');
      if (host) renderBrowserSection(host);
    } catch {
      // ignore transient hover fetch errors
    }
  }

  function showError(err) {
    const main = document.getElementById('main-content');
    if (main) {
      main.innerHTML = `<div class="card"><div class="empty-state" style="color:var(--danger)">${AGY.i18n.escHtml(String(err?.message || err))}</div></div>`;
    }
  }

  function renderMain() {
    const main = document.getElementById('main-content');
    if (!main) return;

    if (appState.page === 'insights' && !isAuxPane) {
      AGY.views.insights.render(main, appState.insightsData, appState.insightsFilters, {
        onRangeChange: (nextRange) => {
          appState.insightsFilters.range = nextRange;
          appState.insightsFilters.day = '';
          savePrefPatch({ insightsRange: nextRange });
          loadInsights();
        },
        onFilterChange: (patch) => {
          Object.assign(appState.insightsFilters, patch);
          loadInsights();
        },
        onLocalFilterChange: (patch) => {
          Object.assign(appState.insightsFilters, patch);
          renderMain();
        },
        onOpenSettings: () => {
          appState.settingsOpen = true;
          renderSettings();
        },
        onOpenSession: (convId) => {
          openContextFor(convId);
        },
      });
      return;
    }

    if (appState.page === 'fleet') {
      if (!appState.fleet.data && appState.emptyReason) {
        main.innerHTML = renderSessionEmptyMessage();
        return;
      }
      main.innerHTML = `<div id="fleet-page-host"></div>`;
      renderFleetPage();
      return;
    }

    // Context Dashboard (DSH Layout)
    if (!appState.sessionData) {
      main.innerHTML = renderSessionEmptyMessage();
      return;
    }

    main.innerHTML = `
      <div id="ctx-stats-host" style="display:flex;flex-direction:column;gap:12px"></div>
      <div class="grid-timeline-browser">
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div id="ctx-current-host"></div>
          <div id="ctx-timeline-host"></div>
        </div>
        <div id="ctx-browser-host"></div>
      </div>
      <div id="ctx-events-host"></div>
      <div id="ctx-files-host"></div>
      <div id="ctx-commands-host"></div>
    `;

    renderStatsSection(document.getElementById('ctx-stats-host'));
    AGY.views.stats.renderCurrentContext(document.getElementById('ctx-current-host'), appState.sessionData);
    renderTimelineSection(document.getElementById('ctx-timeline-host'));
    renderBrowserSection(document.getElementById('ctx-browser-host'));
    renderEventsSection(document.getElementById('ctx-events-host'));
    renderFilesSection(document.getElementById('ctx-files-host'));
    renderCommandsSection(document.getElementById('ctx-commands-host'));
  }

  function renderStatsSection(host) {
    AGY.views.stats.render(host, appState.sessionData, {
      onJump: (target) => {
        if (target === 'user') {
          appState.browser.viewMode = 'categories';
          appState.browser.openCats.add('user');
          renderBrowserSection(document.getElementById('ctx-browser-host'));
          document.getElementById('ctx-browser-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (target === 'events') {
          document.getElementById('ctx-events-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (target === 'commands') {
          document.getElementById('ctx-commands-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (target === 'fleet') {
          appState.page = 'fleet';
          renderTopbar();
          loadFleet();
        } else if (target.startsWith('file:')) {
          appState.files.kind = target.slice(5);
          renderFilesSection(document.getElementById('ctx-files-host'));
          document.getElementById('ctx-files-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
      onOpenSettings: () => {
        appState.settingsOpen = true;
        renderSettings();
      },
      onGoInsights: !isAuxPane
        ? () => {
            appState.page = 'insights';
            renderTopbar();
            loadActivePage();
          }
        : null,
    });
  }

  function renderFleetPage() {
    const host = document.getElementById('fleet-page-host');
    if (!host) return;
    if (!appState.fleet.data) {
      if (!appState.sessionId || appState.emptyReason) {
        host.innerHTML = renderSessionEmptyMessage();
        return;
      }
      host.innerHTML = `<div class="card"><div class="empty-state">${AGY.i18n.escHtml(AGY.i18n.t('commonLoading'))}</div></div>`;
      loadFleet();
      return;
    }
    AGY.views.fleet.render(host, appState.fleet.data, appState.fleet, {
      onSelectAgent: (id) => {
        appState.fleet.selectedAgent = id;
        renderFleetPage();
      },
      onOpenAgent: (id) => openContextFor(id),
      onSelectTask: (id) => {
        if (!id) return;
        appState.fleet.selectedTask = id;
        appState.fleet.expanded.add(id);
        renderFleetPage();
      },
      onToggleExpand: (key) => {
        const expanded = appState.fleet.expanded;
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        renderFleetPage();
      },
      onTaskFilter: (value) => {
        appState.fleet.taskFilter = value;
        renderFleetPage();
      },
      onEventFilter: (value) => {
        appState.fleet.eventFilter = value;
        appState.fleet.eventLimit = 120;
        renderFleetPage();
      },
      onEventQuery: (value) => {
        appState.fleet.eventQuery = value;
        appState.fleet.eventLimit = 120;
        renderFleetPage();
      },
      onLaneQuery: (value) => {
        appState.fleet.laneQuery = value;
        renderFleetPage();
      },
      onLaneOrder: (value) => {
        appState.fleet.laneOrder = value === 'desc' ? 'desc' : 'asc';
        renderFleetPage();
      },
      onToggleLane: (id) => {
        const collapsed = appState.fleet.collapsed;
        if (collapsed.has(id)) collapsed.delete(id);
        else collapsed.add(id);
        renderFleetPage();
      },
      onSelectEvent: (id) => {
        const item = (appState.fleet.data.timeline || []).find(entry => entry.id === id);
        if (item) appState.fleet.selectedAgent = item.from === appState.sessionId ? item.to : item.from;
        appState.fleet.expanded.add(`ev-${id}`);
        renderFleetPage();
      },
      onMoreEvents: () => {
        appState.fleet.eventLimit = (Number(appState.fleet.eventLimit) || 120) + 120;
        renderFleetPage();
      },
    });
  }

  function openContextFor(id) {
    if (!id) return;
    appState.sessionId = id;
    appState.emptyReason = '';
    appState.page = 'context';
    appState.sessionData = null;
    appState.stepData = null;
    appState.timeline.pinnedSeq = -1;
    appState.timeline.hoveredSeq = -1;
    appState.browser.openItems.clear();
    appState.fleet.selectedAgent = id;
    appState.fleet.data = null;
    appState.fleet.signature = '';
    renderTopbar();
    loadContextSession();
  }

  function renderTimelineSection(host) {
    AGY.views.timeline.render(host, appState.sessionData, appState.timeline, {
      onChangeGranularity: (g) => {
        appState.timeline.granularity = g;
        renderTimelineSection(host);
      },
      onChangeMode: (m) => {
        appState.timeline.mode = m;
        renderTimelineSection(host);
      },
      onHoverSeq: (seq) => {
        appState.timeline.hoveredSeq = seq;
        clearTimeout(hoverFetchTimer);
        hoverFetchTimer = setTimeout(() => {
          const target = seq >= 0 ? seq : appState.timeline.pinnedSeq;
          loadStepBrowser(target);
        }, 70);
      },
      onPinSeq: async (seq) => {
        appState.timeline.pinnedSeq = seq;
        appState.timeline.hoveredSeq = -1;
        await loadContextSession();
      },
      onFocusCategory: (catKey) => {
        appState.browser.viewMode = 'categories';
        appState.browser.openCats.add(catKey);
        renderBrowserSection(document.getElementById('ctx-browser-host'));
        document.getElementById('ctx-browser-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
  }

  function renderBrowserSection(host) {
    if (!host) return;
    AGY.views.browser.render(host, appState.stepData, appState.browser, {
      onChangeViewMode: (vm) => {
        appState.browser.viewMode = vm;
        renderBrowserSection(host);
      },
      onChangeBaseline: (b) => {
        appState.browser.baseline = b;
        loadStepBrowser(appState.timeline.pinnedSeq);
      },
      onSearch: (q) => {
        appState.browser.search = q;
        renderBrowserSection(host);
        const inp = host.querySelector('#br-search');
        if (inp) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      },
      onToggleCat: (key) => {
        if (appState.browser.openCats.has(key)) appState.browser.openCats.delete(key);
        else appState.browser.openCats.add(key);
        renderBrowserSection(host);
      },
      onToggleItem: (id) => {
        if (appState.browser.openItems.has(id)) appState.browser.openItems.delete(id);
        else appState.browser.openItems.add(id);
        renderBrowserSection(host);
      },
      onChangeAssistantKind: (k) => {
        appState.browser.assistantKind = k;
        renderBrowserSection(host);
      },
      onChangeCatSort: (key, mode) => {
        appState.browser.catSort[key] = mode;
        renderBrowserSection(host);
      },
      onToggleRaw: (id) => {
        if (appState.browser.rawItems.has(id)) appState.browser.rawItems.delete(id);
        else appState.browser.rawItems.add(id);
        renderBrowserSection(host);
      },
      onOpenDnaPos: (pos) => {
        const key = `dna-${pos}`;
        appState.browser.openItems.add(key);
        renderBrowserSection(host);
        const row = host.querySelector(`[data-dna-row="${pos}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    });
  }

  function renderEventsSection(host) {
    if (!host) return;
    AGY.views.events.render(host, appState.sessionData.events, appState.events, {
      onChangeType: (t) => {
        appState.events.type = t;
        renderEventsSection(host);
      },
      onJumpSeq: (seq) => {
        appState.timeline.pinnedSeq = seq;
        loadContextSession();
        document.getElementById('ctx-timeline-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
  }

  function renderFilesSection(host) {
    if (!host) return;
    AGY.views.files.render(host, appState.sessionData.fileActivity, appState.files, {
      onChangeKind: (k) => {
        appState.files.kind = k;
        renderFilesSection(host);
      },
      onSearch: (q) => {
        appState.files.search = q;
        renderFilesSection(host);
        const inp = host.querySelector('#fa-search');
        if (inp) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      },
      onSort: (s) => {
        appState.files.sortBy = s;
        renderFilesSection(host);
      },
      onToggleFile: (fp) => {
        if (appState.files.expanded.has(fp)) appState.files.expanded.delete(fp);
        else appState.files.expanded.add(fp);
        renderFilesSection(host);
      },
      onJumpToBrowserStep: async (seq, stepIdx) => {
        appState.timeline.pinnedSeq = seq;
        appState.browser.viewMode = 'categories';
        appState.browser.openCats.add('tool_results');
        await loadContextSession();
        const itemEl = document.querySelector(`#ctx-browser-host [data-step-idx="${stepIdx}"]`);
        if (itemEl) {
          const head = itemEl.querySelector('[data-toggle-item]');
          if (head) head.click();
          itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          document.getElementById('ctx-browser-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
    });
  }

  function renderCommandsSection(host) {
    if (!host) return;
    AGY.views.commands.render(host, appState.sessionData.commands, appState.commands, {
      onChangeStatus: (s) => {
        appState.commands.status = s;
        renderCommandsSection(host);
      },
      onSearch: (q) => {
        appState.commands.search = q;
        if (q !== appState.commands.program) appState.commands.program = '';
        renderCommandsSection(host);
        const inp = host.querySelector('#cmd-search');
        if (inp) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      },
      onSelectProgram: (prog, queryStr) => {
        appState.commands.program = prog;
        appState.commands.search = queryStr;
        renderCommandsSection(host);
      },
      onJumpToBrowserStep: async (seq, stepIdx) => {
        appState.timeline.pinnedSeq = seq;
        appState.browser.viewMode = 'categories';
        appState.browser.openCats.add('tool_results');
        await loadContextSession();
        const itemEl = document.querySelector(`#ctx-browser-host [data-step-idx="${stepIdx}"]`);
        if (itemEl) {
          const head = itemEl.querySelector('[data-toggle-item]');
          if (head) head.click();
          itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          document.getElementById('ctx-browser-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
    });
  }

  function loadActivePage(force = false) {
    if (appState.page === 'insights') return loadInsights(force);
    if (appState.page === 'fleet') return loadFleet(force);
    return loadContextSession();
  }

  async function bootstrap() {
    AGY.bridge.initThemeSync();
    if (isAuxPane) {
      const hostConv = AGY.bridge.getHostConversationId();
      if (hostConv) {
        appState.hostSessionId = hostConv;
        appState.sessionId = hostConv;
      }
      AGY.bridge.onConversationChange((nextId) => {
        if (syncHostConversation(nextId)) {
          loadActivePage(true);
        }
      });
    }
    try {
      appState.prefs = await AGY.bridge.apiFetch('/api/prefs');
    } catch {
      // use defaults
    }
    applyPrefsToState();
    renderTopbar();
    await loadActivePage();

    // Gentle visibility-gated background refresh every 6s (only when not hovering)
    pollTimer = setInterval(() => {
      if (document.hidden || appState.timeline.hoveredSeq >= 0) return;
      const active = document.activeElement;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      if (isAuxPane) {
        const hostConv = AGY.bridge.getHostConversationId();
        if (hostConv && hostConv !== appState.hostSessionId) {
          syncHostConversation(hostConv);
          loadActivePage(true);
          return;
        }
      }
      if (appState.page === 'insights' && !isAuxPane) {
        loadInsights();
      } else if (appState.page === 'fleet') {
        loadFleet();
      } else if (appState.timeline.pinnedSeq < 0) {
        loadContextSession();
      }
    }, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
