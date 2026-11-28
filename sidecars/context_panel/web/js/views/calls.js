(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function fmtCallLatency(ms) {
    const v = Number(ms);
    if (!Number.isFinite(v) || v <= 0) return '—';
    if (v < 1000) return `${Math.round(v)}ms`;
    return `${(v / 1000).toFixed(2)}s`;
  }

  function fmtCallCost(usd) {
    const v = Number(usd) || 0;
    if (v <= 0) return '$0.000';
    if (v < 1) return `$${v.toFixed(3)}`;
    return `$${v.toFixed(2)}`;
  }

  function renderCalls(container, steps, state, callbacks) {
    const { t, fmtSignedTokens, fmtClock, escHtml, getLang } = AGY.i18n;
    const isZh = getLang() === 'zh';
    const allOrdered = [...(Array.isArray(steps) ? steps : [])].reverse();
    let isCollapsed = Boolean(state?.collapsed);
    let bodyBuilt = !isCollapsed;
    const filter = state?.filter || 'all';
    const pageSize = [10, 20, 50].includes(Number(state?.pageSize)) ? Number(state.pageSize) : 20;
    const pinnedSeq = Number.isInteger(state?.pinnedSeq) ? state.pinnedSeq : -1;

    const counts = { all: allOrdered.length, warm: 0, cold: 0, issue: 0 };
    for (const s of allOrdered) {
      const start = s.actual?.cacheStart || 'unknown';
      if (start === 'warm') counts.warm++;
      if (start === 'cold' || s.isColdCacheSwitch) counts.cold++;
      if (s.callStatus === 'error' || s.callStatus === 'retry' || s.isShortSample) counts.issue++;
    }

    const filtered = allOrdered.filter((s) => {
      if (filter === 'warm') return s.actual?.cacheStart === 'warm';
      if (filter === 'cold') return s.actual?.cacheStart === 'cold' || Boolean(s.isColdCacheSwitch);
      if (filter === 'issue') return s.callStatus === 'error' || s.callStatus === 'retry' || Boolean(s.isShortSample);
      return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const requestedPage = Math.max(1, Math.round(Number(state?.page) || 1));
    const safePage = Math.min(requestedPage, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const pageRows = filtered.slice(startIdx, startIdx + pageSize);

    const countLabel = filtered.length > pageRows.length
      ? `${pageRows.length} / ${filtered.length}`
      : `${filtered.length}`;

    const filterTabs = [
      { key: 'all', label: t('callsFilterAll') },
      { key: 'warm', label: t('callsFilterWarm') },
      { key: 'cold', label: t('callsFilterCold') },
      { key: 'issue', label: t('callsFilterIssue') },
    ];

    const buildBodyHtml = () => {
      if (pageRows.length === 0) {
        return `<div class="empty-state">${escHtml(t('callsNoMatches'))}</div>`;
      }
      return `
        <div class="calls-table-wrap">
          <table class="calls-table">
            <thead>
              <tr>
                <th>${escHtml(t('callsColTime'))}</th>
                <th>${escHtml(t('callsColModel'))}</th>
                <th class="calls-num">${escHtml(t('callsColInput'))}</th>
                <th class="calls-num">${escHtml(t('callsColDelta'))}</th>
                <th class="calls-num">${escHtml(t('callsColOutput'))}</th>
                <th class="calls-num">${escHtml(t('callsColCache'))}</th>
                <th class="calls-num">${escHtml(t('callsColCost'))}</th>
                <th class="calls-num">${escHtml(t('callsColTtft'))}</th>
                <th class="calls-num">${escHtml(t('callsColTotal'))}</th>
                <th class="calls-num">${escHtml(t('callsColSpeed'))}</th>
                <th>${escHtml(t('callsColStatus'))}</th>
              </tr>
            </thead>
            <tbody>
              ${pageRows.map((s) => {
                const a = s.actual || {};
                const timeStr = fmtClock(s.createdAt) || '—';
                const localizedLabel = isZh ? (s.modelLabelZh || s.modelLabel) : (s.modelLabel || s.modelLabelZh);
                const modelName = localizedLabel || s.actualModel || s.model || '—';
                const modelTip = [localizedLabel, s.actualModel, s.model].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ');
                const roleBadge = s.callRole === 'orchestrator'
                  ? `<span class="calls-role-badge is-orch">${escHtml(t('callsRoleOrch'))}</span>`
                  : s.callRole === 'executor'
                    ? `<span class="calls-role-badge is-exec">${escHtml(t('callsRoleExec'))}</span>`
                    : '';

                const inputStr = Math.max(0, Number(a.inputTokens) || 0).toLocaleString();
                const deltaHtml = s.netDeltaTokens === null || s.netDeltaTokens === undefined
                  ? `<span class="calls-muted">—</span>`
                  : `<span class="${s.isCompactionDrop ? 'calls-delta-drop' : ''}">${escHtml(fmtSignedTokens(s.netDeltaTokens))}</span>`;

                const outputNum = Math.max(0, Number(a.outputTokens) || 0).toLocaleString();
                const thinkPct = Number(a.thinkingPct) || 0;
                const thinkTok = Math.max(0, Number(a.thinkingOutputTokens) || 0).toLocaleString();
                const outputHtml = thinkPct > 0
                  ? `${escHtml(outputNum)} <span class="calls-sub" title="${escHtml(`${t('callsThinkWord')}: ${thinkTok} tokens`)}">(${escHtml(t('callsThinkWord'))} ${thinkPct}%)</span>`
                  : escHtml(outputNum);

                const rate = Number(a.cacheHitRate);
                const hasPrompt = (Number(a.totalPromptTokens) || 0) > 0;
                const ratePct = Number.isFinite(rate) ? Math.max(0, Math.min(100, rate * 100)) : 0;
                const startPill = a.cacheStart === 'warm'
                  ? `<span class="calls-cache-pill is-warm">${escHtml(t('callsCacheWarm'))}</span>`
                  : a.cacheStart === 'partial'
                    ? `<span class="calls-cache-pill is-partial">${escHtml(t('callsCachePartial'))}</span>`
                    : a.cacheStart === 'cold'
                      ? `<span class="calls-cache-pill is-cold">${escHtml(t('callsCacheCold'))}</span>`
                      : '';
                const switchPill = s.isColdCacheSwitch
                  ? `<span class="calls-cache-pill is-cold">${escHtml(t('callsSwitchCold'))}</span>`
                  : '';
                const cacheHtml = hasPrompt
                  ? `<span class="${rate >= 0.5 ? 'calls-cache-hi' : ''}">${ratePct.toFixed(2)}%</span>${startPill ? ` ${startPill}` : ''}${switchPill ? ` ${switchPill}` : ''}`
                  : `<span class="calls-muted">—</span>`;

                const costStr = fmtCallCost(a.cost);
                const ttftStr = fmtCallLatency(s.ttftMs);
                const totalStr = fmtCallLatency(s.callDurationMs || s.durationMs);

                let speedHtml = `<span class="calls-muted">—</span>`;
                if (Number(s.displayTokensPerSec) > 0) {
                  speedHtml = `${Number(s.displayTokensPerSec).toFixed(1)} tok/s`;
                } else if (s.isShortSample) {
                  const rawStr = Number(s.rawTokensPerSec) > 0 ? Number(s.rawTokensPerSec).toFixed(1) : '0';
                  const tip = t('callsShortSampleTip').replace('{speed}', rawStr);
                  speedHtml = `<span class="calls-short-sample" title="${escHtml(tip)}">${escHtml(t('callsShortSample'))}</span>`;
                }

                let statusCls = 'is-ok';
                let statusText = t('callsStatusOk');
                if (s.callStatus === 'error') {
                  statusCls = 'is-err';
                  statusText = t('callsStatusError');
                } else if (s.callStatus === 'retry' && s.retries > 0) {
                  statusCls = 'is-retry';
                  statusText = `${t('callsStatusRetry')} ×${s.retries}`;
                }
                const statusTitle = s.callStatus === 'error' && s.errorMessage ? ` title="${escHtml(s.errorMessage)}"` : '';

                return `
                  <tr class="calls-row ${s.seq === pinnedSeq ? 'is-pinned' : ''}" data-call-seq="${s.seq}">
                    <td class="calls-muted mono">${escHtml(timeStr)}</td>
                    <td class="calls-model-cell" title="${escHtml(modelTip)}">
                      <span class="calls-model-wrap">
                        <span class="mono">${escHtml(modelName)}</span>${roleBadge}
                      </span>
                    </td>
                    <td class="calls-num mono">${escHtml(inputStr)}</td>
                    <td class="calls-num mono">${deltaHtml}</td>
                    <td class="calls-num mono">${outputHtml}</td>
                    <td class="calls-num mono">${cacheHtml}</td>
                    <td class="calls-num mono">${escHtml(costStr)}</td>
                    <td class="calls-num mono">${escHtml(ttftStr)}</td>
                    <td class="calls-num mono">${escHtml(totalStr)}</td>
                    <td class="calls-num mono">${speedHtml}</td>
                    <td><span class="calls-status ${statusCls}"${statusTitle}><span class="calls-status-dot"></span><span>${escHtml(statusText)}</span></span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="calls-pager">
          <div class="filter-bar">
            <span class="card-subtitle">${escHtml(t('callsPageSize'))}</span>
            <select class="select" id="calls-page-size" style="padding:3px 8px;font-size:11px">
              ${[10, 20, 50].map(sz => `<option value="${sz}" ${pageSize === sz ? 'selected' : ''}>${sz}</option>`).join('')}
            </select>
          </div>
          <div class="filter-bar">
            <button class="btn btn-sm" id="calls-prev" type="button" ${safePage <= 1 ? 'disabled' : ''}>${escHtml(t('callsPrev'))}</button>
            <span class="pill mono">${safePage} / ${totalPages}</span>
            <button class="btn btn-sm" id="calls-next" type="button" ${safePage >= totalPages ? 'disabled' : ''}>${escHtml(t('callsNext'))}</button>
          </div>
        </div>
      `;
    };

    const bindBody = (bodyEl) => {
      if (!bodyEl) return;
      bodyEl.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'calls-page-size') {
          callbacks?.onChangePageSize?.(Number(e.target.value) || 20);
        }
      });
      bodyEl.addEventListener('click', (e) => {
        const prevBtn = e.target?.closest?.('#calls-prev');
        if (prevBtn) {
          if (safePage > 1) callbacks?.onChangePage?.(safePage - 1);
          return;
        }
        const nextBtn = e.target?.closest?.('#calls-next');
        if (nextBtn) {
          if (safePage < totalPages) callbacks?.onChangePage?.(safePage + 1);
          return;
        }
        const row = e.target?.closest?.('[data-call-seq]');
        if (row) {
          const seq = Number(row.getAttribute('data-call-seq'));
          if (Number.isFinite(seq) && seq >= 0) callbacks?.onJumpSeq?.(seq);
        }
      });
    };

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="calls-fold-btn" id="calls-toggle" type="button" aria-expanded="${!isCollapsed}">
              <span class="calls-chevron">${isCollapsed ? '▸' : '▾'}</span>
              <span class="card-title">${escHtml(t('callsTitle'))}</span>
            </button>
            <span class="pill mono">${escHtml(countLabel)}</span>
          </div>
          <div class="filter-bar">
            <span class="calls-filters-wrap filter-bar"${isCollapsed ? ' hidden' : ''}>
              ${filterTabs.map(tb => `
                <button class="pill pill-btn ${filter === tb.key ? 'active' : ''}" data-call-filter="${tb.key}">
                  ${escHtml(tb.label)} (${counts[tb.key] || 0})
                </button>
              `).join('')}
            </span>
            <button class="btn btn-sm" id="calls-fold-action" type="button">${escHtml(isCollapsed ? t('callsExpand') : t('callsCollapse'))}</button>
          </div>
        </div>

        <div class="calls-body"${isCollapsed ? ' hidden' : ''}>
          ${bodyBuilt ? buildBodyHtml() : ''}
        </div>
      </div>
    `;

    const toggleHandler = () => {
      isCollapsed = !isCollapsed;
      const bodyEl = container.querySelector('.calls-body');
      const filtersEl = container.querySelector('.calls-filters-wrap');
      const chevEl = container.querySelector('.calls-chevron');
      const foldBtn = container.querySelector('#calls-toggle');
      const actionBtn = container.querySelector('#calls-fold-action');
      if (!isCollapsed && !bodyBuilt && bodyEl) {
        bodyBuilt = true;
        bodyEl.innerHTML = buildBodyHtml();
        bindBody(bodyEl);
      }
      if (bodyEl) bodyEl.hidden = isCollapsed;
      if (filtersEl) filtersEl.hidden = isCollapsed;
      if (chevEl) chevEl.textContent = isCollapsed ? '▸' : '▾';
      if (foldBtn) foldBtn.setAttribute('aria-expanded', String(!isCollapsed));
      if (actionBtn) actionBtn.textContent = isCollapsed ? t('callsExpand') : t('callsCollapse');
      callbacks?.onToggleCollapse?.(isCollapsed, { silent: true });
    };
    container.querySelector('#calls-toggle')?.addEventListener('click', toggleHandler);
    container.querySelector('#calls-fold-action')?.addEventListener('click', toggleHandler);

    container.querySelectorAll('[data-call-filter]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeFilter?.(btn.getAttribute('data-call-filter') || 'all'));
    });

    if (bodyBuilt) {
      bindBody(container.querySelector('.calls-body'));
    }
  }

  AGY.views = AGY.views || {};
  AGY.views.calls = { render: renderCalls };
})(window);
