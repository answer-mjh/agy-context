(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function renderCommands(container, commandsData, state, callbacks) {
    const { t, fmtDuration, fmtClock, escHtml } = AGY.i18n;
    const data = commandsData || { summary: { total: 0, succeeded: 0, failed: 0, totalDurationMs: 0, avgDurationMs: 0 }, notable: {}, programs: [], items: [] };
    const statusFilter = state.status || 'all';
    const search = (state.search || '').trim();
    const searchLower = search.toLowerCase();
    const activeProgram = state.program || '';
    const limit = Math.max(50, Number(state?.limit) || 50);
    let isCollapsed = Boolean(state?.collapsed);
    let bodyBuilt = !isCollapsed;

    const filtered = (data.items || []).filter(cmd => {
      if (statusFilter === 'ok' && cmd.isError) return false;
      if (statusFilter === 'err' && !cmd.isError) return false;
      if (searchLower) {
        const hay = `${cmd.program} ${cmd.commandLine} ${cmd.summary}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }
      return true;
    });

    const visible = filtered.slice(0, limit);
    const remaining = Math.max(0, filtered.length - visible.length);
    const maxProgCount = Math.max(1, ...(data.programs || []).map(p => p.count));

    const buildBodyHtml = () => {
      if (data.summary.total === 0) {
        return `<div class="empty-state">${escHtml(t('noCmds'))}</div>`;
      }
      return `
        <div class="split-panel">
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;flex-direction:column;gap:5px">
              <div class="card-subtitle" style="font-weight:600">${escHtml(t('cmdNotable'))}</div>
              ${data.notable?.slowest ? `
                <button class="btn btn-sm" style="justify-content:space-between" id="cmd-jump-slowest">
                  <span>${escHtml(t('cmdSlowest'))}: <b class="mono">${escHtml(data.notable.slowest.program)}</b></span>
                  <span class="mono">${escHtml(fmtDuration(data.notable.slowest.durationMs))}</span>
                </button>
              ` : ''}
              ${data.summary.failed > 0 ? `
                <button class="btn btn-sm" style="justify-content:space-between;color:var(--danger)" id="cmd-filter-failed">
                  <span>${escHtml(t('cmdFailed'))}</span>
                  <span class="mono">${data.summary.failed}</span>
                </button>
              ` : ''}
            </div>

            <div style="display:flex;flex-direction:column;gap:5px">
              <div class="card-subtitle" style="font-weight:600">${escHtml(t('cmdPrograms'))}</div>
              <div class="rank-list">
                ${(data.programs || []).map(p => {
                  const pct = Math.max(6, (p.count / maxProgCount) * 100);
                  const isAct = activeProgram === p.name && search === p.name;
                  return `
                    <div class="rank-row ${isAct ? 'active' : ''}" data-cprog="${escHtml(p.name)}">
                      <div class="rank-fill" style="width:${pct.toFixed(1)}%"></div>
                      <span class="rank-name mono">${escHtml(p.name)}</span>
                      <span class="rank-count">${p.count}${p.failed ? ` · <span style="color:var(--danger)">${p.failed}!</span>` : ''}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;min-width:0">
            <input class="input" id="cmd-search" type="search" placeholder="${escHtml(t('searchCmds'))}" value="${escHtml(search)}"/>
            <div class="list-scroll">
              ${visible.map(cmd => `
                <div class="row-item">
                  <div class="row-head">
                    <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1">
                      <span class="pill ${cmd.isError ? 'pill-danger' : 'pill-good'}" style="font-size:10px">${cmd.exitCode !== null ? `exit ${cmd.exitCode}` : (cmd.isError ? 'ERR' : 'OK')}</span>
                      <span class="pill mono" style="font-size:10px">${escHtml(cmd.program)}</span>
                      ${cmd.summary ? `<span style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(cmd.summary)}</span>` : ''}
                    </div>
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="card-subtitle mono">${escHtml(fmtDuration(cmd.durationMs))}</span>
                      <span class="card-subtitle mono">${escHtml(fmtClock(cmd.createdAt))}</span>
                      <button class="btn btn-sm" data-jump-cmd="${cmd.plannerSeq}:${cmd.stepIndex}">S${cmd.stepIndex}</button>
                    </div>
                  </div>
                  <pre class="code-block" style="max-height:90px;padding:6px 8px">${escHtml(cmd.commandLine)}</pre>
                </div>
              `).join('') || `<div class="empty-state">${escHtml(t('noCmds'))}</div>`}
            </div>
            ${remaining > 0 ? `
              <div class="list-more-wrap">
                <button class="btn btn-sm" type="button" data-load-more>${escHtml(t('showMoreItems').replace('{count}', String(remaining)))}</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    };

    const bindBody = (bodyEl) => {
      if (!bodyEl) return;
      bodyEl.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'cmd-search') {
          callbacks?.onSearch?.(e.target.value);
        }
      });
      bodyEl.addEventListener('click', (e) => {
        const moreBtn = e.target?.closest?.('[data-load-more]');
        if (moreBtn) {
          callbacks?.onLoadMore?.();
          return;
        }
        const jumpBtn = e.target?.closest?.('[data-jump-cmd]');
        if (jumpBtn) {
          const [seqStr, stepStr] = (jumpBtn.getAttribute('data-jump-cmd') || '0:0').split(':');
          callbacks?.onJumpToBrowserStep?.(Number(seqStr), Number(stepStr));
          return;
        }
        const progRow = e.target?.closest?.('[data-cprog]');
        if (progRow) {
          const prog = progRow.getAttribute('data-cprog');
          if (activeProgram === prog && search === prog) callbacks?.onSelectProgram?.('', '');
          else callbacks?.onSelectProgram?.(prog, prog);
          return;
        }
        if (e.target?.closest?.('#cmd-jump-slowest') && data.notable?.slowest) {
          callbacks?.onJumpToBrowserStep?.(data.notable.slowest.plannerSeq, data.notable.slowest.stepIndex);
          return;
        }
        if (e.target?.closest?.('#cmd-filter-failed')) {
          callbacks?.onChangeStatus?.(statusFilter === 'err' ? 'all' : 'err');
        }
      });
    };

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="calls-fold-btn" id="cmd-toggle" type="button" aria-expanded="${!isCollapsed}">
              <span class="calls-chevron">${isCollapsed ? '▸' : '▾'}</span>
              <span class="card-title">${escHtml(t('cmdsTitle'))}</span>
            </button>
            <span class="pill mono">${data.summary.total}</span>
            <span class="pill pill-good mono">${escHtml(t('cmdOk'))} ${data.summary.succeeded}</span>
            ${data.summary.failed > 0 ? `<span class="pill pill-danger mono">${escHtml(t('cmdErr'))} ${data.summary.failed}</span>` : ''}
            <span class="card-subtitle mono">${escHtml(fmtDuration(data.summary.totalDurationMs))}</span>
          </div>
          <div class="filter-bar">
            <span class="cmd-filters-wrap filter-bar"${isCollapsed ? ' hidden' : ''}>
              <button class="pill pill-btn ${statusFilter === 'all' ? 'active' : ''}" data-cstatus="all">${escHtml(t('cmdAll'))}</button>
              <button class="pill pill-btn ${statusFilter === 'ok' ? 'active' : ''}" data-cstatus="ok">${escHtml(t('cmdOk'))}</button>
              <button class="pill pill-btn ${statusFilter === 'err' ? 'active' : ''}" data-cstatus="err">${escHtml(t('cmdErr'))}</button>
            </span>
            <button class="btn btn-sm" id="cmd-fold-action" type="button">${escHtml(isCollapsed ? t('callsExpand') : t('callsCollapse'))}</button>
          </div>
        </div>

        <div class="cmd-body"${isCollapsed ? ' hidden' : ''}>
          ${bodyBuilt ? buildBodyHtml() : ''}
        </div>
      </div>
    `;

    const toggleHandler = () => {
      isCollapsed = !isCollapsed;
      const bodyEl = container.querySelector('.cmd-body');
      const filtersEl = container.querySelector('.cmd-filters-wrap');
      const chevEl = container.querySelector('#cmd-toggle .calls-chevron');
      const foldBtn = container.querySelector('#cmd-toggle');
      const actionBtn = container.querySelector('#cmd-fold-action');
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
    container.querySelector('#cmd-toggle')?.addEventListener('click', toggleHandler);
    container.querySelector('#cmd-fold-action')?.addEventListener('click', toggleHandler);

    container.querySelectorAll('[data-cstatus]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeStatus?.(btn.getAttribute('data-cstatus')));
    });

    if (bodyBuilt) {
      bindBody(container.querySelector('.cmd-body'));
    }
  }

  AGY.views = AGY.views || {};
  AGY.views.commands = { render: renderCommands };
})(window);
