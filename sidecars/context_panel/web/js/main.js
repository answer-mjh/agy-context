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
      quotaPool: 'all',
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
    insightsRev: '',
    insightsQueryKey: '',
    sessionId: initialHostId,
    hostSessionId: initialHostId,
    emptyReason: '',
    sessionsList: [],
    sessionData: null,
    sessionRev: '',
    sessionQueryKey: '',
    stepData: null,
    stepRev: '',
    stepQueryKey: '',
    stepItemCache: new Map(),
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
    events: { type: 'all', collapsed: false, limit: 50 },
    models: { collapsed: false },
    calls: { collapsed: false, filter: 'all', page: 1, pageSize: 20 },
    files: { kind: 'all', search: '', sortBy: 'ops', expanded: new Set(), collapsed: false, limit: 50 },
    commands: { status: 'all', search: '', program: '', collapsed: false, limit: 50 },
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

  const MAX_SESSION_CACHE = 4;
  const sessionCache = new Map();
  const paneDirty = { insights: true, context: true, fleet: true };
  let hoverFetchTimer = null;
  let pollTimer = null;
  let sessionLoadToken = 0;
  let stepLoadToken = 0;
  let contextRenderToken = 0;
  let contextRafId = 0;

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
          const pane = showActivePane();
          if (pane && (paneDirty[nextPage] || pane.childElementCount === 0)) {
            renderMain();
          }
          loadActivePage(false);
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
        saveCurrentSessionToCache();
        const nextId = sessSel.value;
        appState.sessionId = nextId;
        appState.emptyReason = '';
        appState.timeline.pinnedSeq = -1;
        appState.timeline.hoveredSeq = -1;
        appState.calls.page = 1;
        appState.browser.openItems.clear();
        resetContextLimits();
        if (!hydrateSessionFromCache(nextId)) {
          appState.sessionData = null;
          appState.stepData = null;
          clearSessionCaches();
        }
        appState.fleet.data = null;
        appState.fleet.signature = '';
        appState.fleet.selectedAgent = '';
        appState.fleet.selectedTask = '';
        paneDirty.context = true;
        paneDirty.fleet = true;
        renderTopbar();
        renderMain();
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
    paneDirty.insights = true;
    paneDirty.context = true;
    paneDirty.fleet = true;
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

  function resetContextLimits() {
    appState.events.limit = 50;
    appState.files.limit = 50;
    appState.commands.limit = 50;
  }

  function clearSessionCaches() {
    appState.sessionRev = '';
    appState.sessionQueryKey = '';
    appState.stepRev = '';
    appState.stepQueryKey = '';
    appState.stepItemCache.clear();
  }

  function saveCurrentSessionToCache() {
    const id = (appState.sessionId || '').trim();
    if (!id || !appState.sessionData || appState.timeline.pinnedSeq >= 0) return;
    sessionCache.delete(id);
    sessionCache.set(id, {
      sessionData: appState.sessionData,
      sessionRev: appState.sessionRev,
      sessionQueryKey: appState.sessionQueryKey,
      stepData: appState.stepData,
      stepRev: appState.stepRev,
      stepQueryKey: appState.stepQueryKey,
    });
    while (sessionCache.size > MAX_SESSION_CACHE) {
      const oldestKey = sessionCache.keys().next().value;
      sessionCache.delete(oldestKey);
    }
  }

  function hydrateSessionFromCache(id) {
    const clean = (id || '').trim();
    if (!clean || !sessionCache.has(clean)) return false;
    const cached = sessionCache.get(clean);
    sessionCache.delete(clean);
    sessionCache.set(clean, cached);
    appState.sessionData = cached.sessionData || null;
    appState.sessionRev = cached.sessionRev || '';
    appState.sessionQueryKey = cached.sessionQueryKey || '';
    appState.stepData = cached.stepData || null;
    appState.stepRev = cached.stepRev || '';
    appState.stepQueryKey = cached.stepQueryKey || '';
    appState.stepItemCache.clear();
    return Boolean(appState.sessionData);
  }

  function ensurePanes() {
    const main = document.getElementById('main-content');
    if (!main) return null;
    let insights = document.getElementById('pane-insights');
    let context = document.getElementById('pane-context');
    let fleet = document.getElementById('pane-fleet');
    if (!insights || !context || !fleet) {
      main.innerHTML = `
        <div id="pane-insights" class="page-pane" hidden></div>
        <div id="pane-context" class="page-pane" hidden></div>
        <div id="pane-fleet" class="page-pane" hidden></div>
      `;
      insights = document.getElementById('pane-insights');
      context = document.getElementById('pane-context');
      fleet = document.getElementById('pane-fleet');
    }
    return { insights, context, fleet };
  }

  function getActivePane() {
    const panes = ensurePanes();
    if (!panes) return null;
    if (appState.page === 'insights' && !isAuxPane) return panes.insights;
    if (appState.page === 'fleet') return panes.fleet;
    return panes.context;
  }

  function showActivePane() {
    const panes = ensurePanes();
    if (!panes) return null;
    const activeKey = appState.page === 'insights' && !isAuxPane
      ? 'insights'
      : appState.page === 'fleet'
        ? 'fleet'
        : 'context';
    panes.insights.hidden = activeKey !== 'insights';
    panes.context.hidden = activeKey !== 'context';
    panes.fleet.hidden = activeKey !== 'fleet';
    return panes[activeKey];
  }

  function getCachedStepItem(itemId) {
    if (!itemId) return null;
    const seq = appState.stepData?.seq ?? -1;
    return appState.stepItemCache.get(`${appState.sessionId}:${seq}:${itemId}`) || null;
  }

  async function loadStepItemDetail(itemId) {
    const targetId = (appState.sessionId || '').trim();
    const seq = appState.stepData?.seq ?? appState.timeline.pinnedSeq;
    if (!targetId || !itemId) return null;
    const cacheKey = `${targetId}:${seq}:${itemId}`;
    if (appState.stepItemCache.has(cacheKey)) {
      return appState.stepItemCache.get(cacheKey);
    }
    try {
      const res = await AGY.bridge.apiFetch(
        `/api/step${qs({ id: targetId, step: seq >= 0 ? seq : '', baseline: appState.browser.baseline, itemId })}`
      );
      const detail = res?.detail || null;
      if (detail) {
        appState.stepItemCache.set(cacheKey, detail);
        while (appState.stepItemCache.size > 80) {
          const oldest = appState.stepItemCache.keys().next().value;
          appState.stepItemCache.delete(oldest);
        }
      }
      return detail;
    } catch {
      return null;
    }
  }

  function syncHostConversation(nextHostId) {
    if (!isAuxPane) return false;
    const clean = typeof nextHostId === 'string' ? nextHostId.trim() : '';
    if (!clean || clean === appState.hostSessionId) return false;
    saveCurrentSessionToCache();
    appState.hostSessionId = clean;
    appState.sessionId = clean;
    appState.emptyReason = '';
    appState.timeline.pinnedSeq = -1;
    appState.timeline.hoveredSeq = -1;
    appState.calls.page = 1;
    appState.browser.openItems.clear();
    resetContextLimits();
    if (!hydrateSessionFromCache(clean)) {
      appState.sessionData = null;
      appState.stepData = null;
      clearSessionCaches();
    }
    appState.fleet.data = null;
    appState.fleet.signature = '';
    appState.fleet.selectedAgent = '';
    appState.fleet.selectedTask = '';
    paneDirty.context = true;
    paneDirty.fleet = true;
    if (appState.page === 'insights') appState.page = 'context';
    renderTopbar();
    renderMain();
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
    if (query.range !== 'weekly_quota' || query.quotaPool === 'all') {
      delete query.quotaPool;
    }
    const queryKey = JSON.stringify(Object.assign({}, query, { force: undefined }));
    const revParam = !force && appState.insightsData && appState.insightsQueryKey === queryKey
      ? appState.insightsRev
      : '';
    if (revParam) query.rev = revParam;
    try {
      const data = await AGY.bridge.apiFetch(`/api/insights${qs(query)}`);
      if (data?.unchanged) return;
      appState.insightsData = data;
      appState.insightsRev = data.rev || '';
      appState.insightsQueryKey = queryKey;
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
      if (appState.page === 'insights') renderMain();
      else paneDirty.insights = true;
    } catch (err) {
      showError(err);
    }
  }

  async function loadContextSession(force = false) {
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
      if (appState.page === 'context') renderMain();
      else paneDirty.context = true;
      return;
    }

    try {
      const pinnedSeq = appState.timeline.pinnedSeq;
      const stepParam = pinnedSeq >= 0 ? pinnedSeq : '';
      const queryKey = `${targetId}|${stepParam}`;
      const revParam = !force && appState.sessionData && appState.sessionQueryKey === queryKey
        ? appState.sessionRev
        : '';

      const sessionPromise = AGY.bridge.apiFetch(
        `/api/session${qs({
          id: targetId,
          step: stepParam,
          rev: revParam,
          omitSessions: isAuxPane ? 1 : '',
          force: force ? 1 : '',
        })}`
      );
      const stepPromise = loadStepBrowser(pinnedSeq, force);

      const payload = await sessionPromise;
      if (myToken !== sessionLoadToken) return;
      if (payload?.unchanged) {
        await stepPromise;
        return;
      }
      if (Array.isArray(payload.sessions) && payload.sessions.length > 0) {
        appState.sessionsList = payload.sessions;
      } else if (!isAuxPane) {
        appState.sessionsList = payload.sessions || [];
      }
      if (payload.empty || !payload.session) {
        appState.sessionData = null;
        appState.stepData = null;
        clearSessionCaches();
        sessionCache.delete(targetId);
        appState.emptyReason = payload.reason || 'no_transcript_yet';
        renderTopbar();
        if (appState.page === 'context') renderMain();
        else paneDirty.context = true;
        await stepPromise;
        return;
      }
      appState.emptyReason = '';
      appState.sessionRev = payload.rev || '';
      appState.sessionQueryKey = queryKey;
      appState.sessionData = payload.session;
      appState.sessionData.fleet = payload.fleet || null;
      if (pinnedSeq < 0) {
        saveCurrentSessionToCache();
      }
      renderTopbar();
      if (appState.page === 'context') {
        renderMain();
      } else {
        paneDirty.context = true;
      }
      await stepPromise;
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
      const data = await AGY.bridge.apiFetch(`/api/fleet${qs({ id: targetId, force: force ? 1 : '' })}`);
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
      if (!force && sameData && !paneDirty.fleet && document.getElementById('fleet-page-host')) return;
      if (appState.page === 'fleet') renderMain();
      else paneDirty.fleet = true;
    } catch (err) {
      if (myToken !== sessionLoadToken) return;
      showError(err);
    }
  }

  async function loadStepBrowser(seq, force = false) {
    const targetId = (appState.sessionId || '').trim();
    if (!targetId) return;
    const myStepToken = ++stepLoadToken;
    const searchQ = (appState.browser.search || '').trim();
    const queryKey = `${targetId}|${seq}|${appState.browser.baseline}|${searchQ}`;
    const revParam = !force && !searchQ && appState.stepData && appState.stepQueryKey === queryKey
      ? appState.stepRev
      : '';
    try {
      const data = await AGY.bridge.apiFetch(
        `/api/step${qs({
          id: targetId,
          step: seq >= 0 ? seq : '',
          baseline: appState.browser.baseline,
          q: searchQ,
          rev: revParam,
          force: force ? 1 : '',
        })}`
      );
      if (myStepToken !== stepLoadToken || targetId !== appState.sessionId) return;
      if (data?.unchanged) return;
      appState.stepRev = data?.rev || '';
      appState.stepQueryKey = queryKey;
      appState.stepData = data?.empty ? null : data;
      if (appState.timeline.pinnedSeq < 0 && appState.sessionData) {
        saveCurrentSessionToCache();
      }
      const host = document.getElementById('ctx-browser-host');
      if (host) {
        const prevInput = host.querySelector('#br-search');
        const wasFocused = prevInput && document.activeElement === prevInput;
        const selStart = wasFocused ? prevInput.selectionStart : null;
        const selEnd = wasFocused ? prevInput.selectionEnd : null;
        renderBrowserSection(host);
        if (wasFocused) {
          const nextInput = host.querySelector('#br-search');
          if (nextInput) {
            nextInput.focus();
            if (selStart !== null && selEnd !== null) {
              nextInput.setSelectionRange(selStart, selEnd);
            }
          }
        }
      } else {
        paneDirty.context = true;
      }
    } catch {
      // ignore transient hover fetch errors
    }
  }

  function showError(err) {
    const pane = showActivePane() || getActivePane() || document.getElementById('main-content');
    if (pane) {
      paneDirty[appState.page] = true;
      pane.innerHTML = `<div class="card"><div class="empty-state" style="color:var(--danger)">${AGY.i18n.escHtml(String(err?.message || err))}</div></div>`;
    }
  }

  function renderMain() {
    const pane = showActivePane();
    if (!pane) return;

    if (appState.page === 'insights' && !isAuxPane) {
      paneDirty.insights = false;
      AGY.views.insights.render(pane, appState.insightsData, appState.insightsFilters, {
        onRangeChange: (nextRange) => {
          appState.insightsFilters.range = nextRange;
          appState.insightsFilters.day = '';
          if (nextRange !== 'weekly_quota') {
            appState.insightsFilters.quotaPool = 'all';
          }
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
      paneDirty.fleet = false;
      if (!appState.fleet.data && appState.emptyReason) {
        pane.innerHTML = renderSessionEmptyMessage();
        return;
      }
      pane.innerHTML = `<div id="fleet-page-host"></div>`;
      renderFleetPage();
      return;
    }

    // Context Dashboard (DSH Layout)
    if (contextRafId) {
      if (typeof global.cancelAnimationFrame === 'function') global.cancelAnimationFrame(contextRafId);
      else clearTimeout(contextRafId);
      contextRafId = 0;
    }
    const renderToken = ++contextRenderToken;

    if (!appState.sessionData) {
      paneDirty.context = false;
      pane.innerHTML = appState.emptyReason
        ? renderSessionEmptyMessage()
        : `<div class="card"><div class="empty-state">${AGY.i18n.escHtml(AGY.i18n.t('commonLoading'))}</div></div>`;
      return;
    }

    paneDirty.context = false;
    pane.innerHTML = `
      <div id="ctx-stats-host" style="display:flex;flex-direction:column;gap:12px"></div>
      <div id="ctx-models-host"></div>
      <div class="grid-timeline-browser">
        <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
          <div id="ctx-current-host"></div>
          <div id="ctx-timeline-host"></div>
        </div>
        <div id="ctx-browser-host"></div>
      </div>
      <div id="ctx-calls-host" class="ctx-below-fold"></div>
      <div id="ctx-events-host" class="ctx-below-fold"></div>
      <div id="ctx-files-host" class="ctx-below-fold"></div>
      <div id="ctx-commands-host" class="ctx-below-fold"></div>
    `;

    // Phase 1: synchronous above-the-fold render
    renderStatsSection(document.getElementById('ctx-stats-host'));
    renderModelsSection(document.getElementById('ctx-models-host'));
    AGY.views.stats.renderCurrentContext(document.getElementById('ctx-current-host'), appState.sessionData);
    renderTimelineSection(document.getElementById('ctx-timeline-host'));
    renderBrowserSection(document.getElementById('ctx-browser-host'));

    // Phase 2: next animation frame below-the-fold render
    const schedulePhase2 = typeof global.requestAnimationFrame === 'function'
      ? global.requestAnimationFrame.bind(global)
      : (fn) => setTimeout(fn, 0);
    contextRafId = schedulePhase2(() => {
      contextRafId = 0;
      if (renderToken !== contextRenderToken) return;
      if (appState.page !== 'context') {
        paneDirty.context = true;
        return;
      }
      renderCallsSection(document.getElementById('ctx-calls-host'));
      renderEventsSection(document.getElementById('ctx-events-host'));
      renderFilesSection(document.getElementById('ctx-files-host'));
      renderCommandsSection(document.getElementById('ctx-commands-host'));
    });
  }

  function renderModelsSection(host) {
    if (!host || !AGY.views.models) return;
    AGY.views.models.render(host, appState.sessionData?.modelUsage || null, appState.models, {
      onToggleCollapse: (nextCollapsed, opts) => {
        appState.models.collapsed = typeof nextCollapsed === 'boolean' ? nextCollapsed : !appState.models.collapsed;
        if (!opts?.silent) renderModelsSection(host);
      },
    });
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
          const pane = showActivePane();
          if (pane && (paneDirty.fleet || pane.childElementCount === 0)) renderMain();
          loadFleet();
        } else if (target.startsWith('file:')) {
          appState.files.kind = target.slice(5);
          appState.files.limit = 50;
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
            const pane = showActivePane();
            if (pane && (paneDirty.insights || pane.childElementCount === 0)) renderMain();
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
    saveCurrentSessionToCache();
    appState.sessionId = id;
    appState.emptyReason = '';
    appState.page = 'context';
    appState.timeline.pinnedSeq = -1;
    appState.timeline.hoveredSeq = -1;
    appState.calls.page = 1;
    appState.browser.openItems.clear();
    resetContextLimits();
    if (!hydrateSessionFromCache(id)) {
      appState.sessionData = null;
      appState.stepData = null;
      clearSessionCaches();
    }
    appState.fleet.selectedAgent = id;
    appState.fleet.data = null;
    appState.fleet.signature = '';
    paneDirty.context = true;
    paneDirty.fleet = true;
    renderTopbar();
    renderMain();
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
        loadStepBrowser(appState.timeline.pinnedSeq);
      },
      onToggleCat: (key, opts) => {
        if (appState.browser.openCats.has(key)) appState.browser.openCats.delete(key);
        else appState.browser.openCats.add(key);
        if (!opts?.silent) renderBrowserSection(host);
      },
      onToggleItem: (id, opts) => {
        if (appState.browser.openItems.has(id)) appState.browser.openItems.delete(id);
        else appState.browser.openItems.add(id);
        if (!opts?.silent) renderBrowserSection(host);
      },
      onChangeAssistantKind: (k) => {
        appState.browser.assistantKind = k;
        renderBrowserSection(host);
      },
      onChangeCatSort: (key, mode) => {
        appState.browser.catSort[key] = mode;
        renderBrowserSection(host);
      },
      onToggleRaw: (id, opts) => {
        if (appState.browser.rawItems.has(id)) appState.browser.rawItems.delete(id);
        else appState.browser.rawItems.add(id);
        if (!opts?.silent) renderBrowserSection(host);
      },
      getCachedDetail: (itemId) => getCachedStepItem(itemId),
      onLoadItemDetail: (itemId) => loadStepItemDetail(itemId),
      onOpenDnaPos: (pos) => {
        const key = `dna-${pos}`;
        appState.browser.openItems.add(key);
        renderBrowserSection(host);
        const row = host.querySelector(`[data-dna-row="${pos}"]`);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    });
  }

  function renderCallsSection(host) {
    if (!host || !AGY.views.calls) return;
    const steps = appState.sessionData?.timeline?.steps || [];
    AGY.views.calls.render(
      host,
      steps,
      Object.assign({}, appState.calls, { pinnedSeq: appState.timeline.pinnedSeq }),
      {
        onToggleCollapse: (nextCollapsed, opts) => {
          appState.calls.collapsed = typeof nextCollapsed === 'boolean' ? nextCollapsed : !appState.calls.collapsed;
          if (!opts?.silent) renderCallsSection(host);
        },
        onChangeFilter: (f) => {
          appState.calls.filter = f || 'all';
          appState.calls.page = 1;
          renderCallsSection(host);
        },
        onChangePage: (p) => {
          appState.calls.page = Math.max(1, Number(p) || 1);
          renderCallsSection(host);
        },
        onChangePageSize: (sz) => {
          appState.calls.pageSize = Number(sz) || 20;
          appState.calls.page = 1;
          renderCallsSection(host);
        },
        onJumpSeq: (seq) => {
          appState.timeline.pinnedSeq = seq;
          appState.timeline.hoveredSeq = -1;
          loadContextSession();
          document.getElementById('ctx-timeline-host')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }
    );
  }

  function renderEventsSection(host) {
    if (!host) return;
    AGY.views.events.render(host, appState.sessionData.events, appState.events, {
      onToggleCollapse: (nextCollapsed, opts) => {
        appState.events.collapsed = typeof nextCollapsed === 'boolean' ? nextCollapsed : !appState.events.collapsed;
        if (!opts?.silent) renderEventsSection(host);
      },
      onChangeType: (t) => {
        appState.events.type = t;
        appState.events.limit = 50;
        renderEventsSection(host);
      },
      onLoadMore: () => {
        appState.events.limit = (Number(appState.events.limit) || 50) + 50;
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
      onToggleCollapse: (nextCollapsed, opts) => {
        appState.files.collapsed = typeof nextCollapsed === 'boolean' ? nextCollapsed : !appState.files.collapsed;
        if (!opts?.silent) renderFilesSection(host);
      },
      onChangeKind: (k) => {
        appState.files.kind = k;
        appState.files.limit = 50;
        renderFilesSection(host);
      },
      onSearch: (q) => {
        appState.files.search = q;
        appState.files.limit = 50;
        renderFilesSection(host);
        const inp = host.querySelector('#fa-search');
        if (inp) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      },
      onSort: (s) => {
        appState.files.sortBy = s;
        renderFilesSection(host);
      },
      onLoadMore: () => {
        appState.files.limit = (Number(appState.files.limit) || 50) + 50;
        renderFilesSection(host);
      },
      onToggleFile: (fp, opts) => {
        if (appState.files.expanded.has(fp)) appState.files.expanded.delete(fp);
        else appState.files.expanded.add(fp);
        if (!opts?.silent) renderFilesSection(host);
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
      onToggleCollapse: (nextCollapsed, opts) => {
        appState.commands.collapsed = typeof nextCollapsed === 'boolean' ? nextCollapsed : !appState.commands.collapsed;
        if (!opts?.silent) renderCommandsSection(host);
      },
      onChangeStatus: (s) => {
        appState.commands.status = s;
        appState.commands.limit = 50;
        renderCommandsSection(host);
      },
      onSearch: (q) => {
        appState.commands.search = q;
        appState.commands.limit = 50;
        if (q !== appState.commands.program) appState.commands.program = '';
        renderCommandsSection(host);
        const inp = host.querySelector('#cmd-search');
        if (inp) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      },
      onSelectProgram: (prog, queryStr) => {
        appState.commands.program = prog;
        appState.commands.search = queryStr;
        appState.commands.limit = 50;
        renderCommandsSection(host);
      },
      onLoadMore: () => {
        appState.commands.limit = (Number(appState.commands.limit) || 50) + 50;
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
    return loadContextSession(force);
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
    if (global.__AGY_INIT_PREFS__ && typeof global.__AGY_INIT_PREFS__ === 'object') {
      appState.prefs = Object.assign({}, appState.prefs, global.__AGY_INIT_PREFS__);
    } else {
      try {
        appState.prefs = await AGY.bridge.apiFetch('/api/prefs');
      } catch {
        // use defaults
      }
    }
    applyPrefsToState();
    renderTopbar();
    renderMain();
    await loadActivePage();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        loadActivePage(false);
      }
    });

    // Gentle visibility-gated background refresh every 3s (only when not hovering)
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
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
