(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function renderFiles(container, fileActivity, state, callbacks) {
    const { t, fmtClock, escHtml } = AGY.i18n;
    const data = fileActivity || { counts: { read: 0, written: 0, searched: 0, images: 0, addedLines: 0, removedLines: 0 }, files: [] };
    const counts = data.counts;
    const activeKind = state.kind || 'all';
    const search = (state.search || '').trim().toLowerCase();
    const sortBy = state.sortBy || 'ops';
    const expanded = state.expanded || new Set();
    const limit = Math.max(50, Number(state?.limit) || 50);
    let isCollapsed = Boolean(state?.collapsed);
    let bodyBuilt = !isCollapsed;

    let list = (data.files || []).filter(f => {
      if (activeKind !== 'all' && !(f[activeKind] > 0)) return false;
      if (search && !f.path.toLowerCase().includes(search)) return false;
      return true;
    });

    list = list.slice().sort((a, b) => {
      if (sortBy === 'changes') return (b.addedLines + b.removedLines) - (a.addedLines + a.removedLines);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return b.totalOps - a.totalOps || a.name.localeCompare(b.name);
    });

    const visible = list.slice(0, limit);
    const remaining = Math.max(0, list.length - visible.length);
    const fileByPath = new Map(list.map(f => [f.path, f]));

    const buildOpsHtml = (f) => `
      <div class="file-ops-wrap" style="display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid var(--border)">
        ${(f.operations || []).map(op => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;padding:3px 6px;border-radius:4px;background:var(--surface)">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="pill mono" style="font-size:10px">${escHtml(op.tool)}</span>
              <span class="card-subtitle">${escHtml(op.kind)}</span>
              ${(op.addedLines || op.removedLines) ? `<span class="mono"><span style="color:var(--good)">+${op.addedLines}</span> <span style="color:var(--danger)">-${op.removedLines}</span></span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="card-subtitle mono">${escHtml(fmtClock(op.createdAt))}</span>
              <button class="btn btn-sm" data-jump-file-step="${op.plannerSeq}:${op.stepIndex}">${escHtml(t('jumpBrowser'))} (S${op.stepIndex})</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    const buildBodyHtml = () => `
      <div class="filter-bar">
        <input class="input" id="fa-search" type="search" style="flex:1;min-width:160px" placeholder="${escHtml(t('searchFiles'))}" value="${escHtml(state.search || '')}"/>
        <select class="select" id="fa-sort" style="font-size:11px">
          <option value="ops" ${sortBy === 'ops' ? 'selected' : ''}>Ops</option>
          <option value="changes" ${sortBy === 'changes' ? 'selected' : ''}>+/- Lines</option>
          <option value="name" ${sortBy === 'name' ? 'selected' : ''}>Name</option>
        </select>
      </div>

      ${list.length === 0
        ? `<div class="empty-state">${escHtml(t('noFiles'))}</div>`
        : `<div class="list-scroll">
            ${visible.map(f => {
              const isOpen = expanded.has(f.path);
              return `
                <div class="row-item">
                  <div class="row-head" style="cursor:pointer" data-toggle-file="${escHtml(f.path)}">
                    <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1">
                      <span data-file-chev style="color:var(--ink-muted);font-size:10px">${isOpen ? '▾' : '▸'}</span>
                      <span style="font-weight:600;font-size:12px" title="${escHtml(f.path)}">${escHtml(f.name)}</span>
                      <span class="card-subtitle mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.path)}</span>
                    </div>
                    <div class="filter-bar">
                      ${f.read > 0 ? `<span class="pill mono">R ${f.read}</span>` : ''}
                      ${f.written > 0 ? `<span class="pill pill-accent mono">W ${f.written}</span>` : ''}
                      ${f.searched > 0 ? `<span class="pill mono">S ${f.searched}</span>` : ''}
                      ${f.images > 0 ? `<span class="pill pill-warn mono">IMG ${f.images}</span>` : ''}
                      ${(f.addedLines || f.removedLines) ? `<span class="pill mono"><span style="color:var(--good)">+${f.addedLines}</span> <span style="color:var(--danger)">-${f.removedLines}</span></span>` : ''}
                    </div>
                  </div>
                  ${isOpen ? buildOpsHtml(f) : ''}
                </div>
              `;
            }).join('')}
          </div>
          ${remaining > 0 ? `
            <div class="list-more-wrap">
              <button class="btn btn-sm" type="button" data-load-more>${escHtml(t('showMoreItems').replace('{count}', String(remaining)))}</button>
            </div>
          ` : ''}`
      }
    `;

    const bindBody = (bodyEl) => {
      if (!bodyEl) return;
      bodyEl.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'fa-search') {
          callbacks?.onSearch?.(e.target.value);
        }
      });
      bodyEl.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'fa-sort') {
          callbacks?.onSort?.(e.target.value);
        }
      });
      bodyEl.addEventListener('click', (e) => {
        const moreBtn = e.target?.closest?.('[data-load-more]');
        if (moreBtn) {
          callbacks?.onLoadMore?.();
          return;
        }
        const jumpBtn = e.target?.closest?.('[data-jump-file-step]');
        if (jumpBtn) {
          e.stopPropagation();
          const [seqStr, stepStr] = (jumpBtn.getAttribute('data-jump-file-step') || '0:0').split(':');
          callbacks?.onJumpToBrowserStep?.(Number(seqStr), Number(stepStr));
          return;
        }
        const toggleEl = e.target?.closest?.('[data-toggle-file]');
        if (toggleEl) {
          const fp = toggleEl.getAttribute('data-toggle-file');
          const rowItem = toggleEl.closest('.row-item');
          const chev = toggleEl.querySelector('[data-file-chev]');
          const willOpen = !expanded.has(fp);
          callbacks?.onToggleFile?.(fp, { silent: true });
          if (chev) chev.textContent = willOpen ? '▾' : '▸';
          if (!rowItem) return;
          const existing = rowItem.querySelector('.file-ops-wrap');
          if (!willOpen) {
            if (existing) existing.remove();
            return;
          }
          const fileObj = fileByPath.get(fp);
          if (!fileObj) return;
          if (!existing) {
            rowItem.insertAdjacentHTML('beforeend', buildOpsHtml(fileObj));
          }
        }
      });
    };

    const tabs = [
      { key: 'all', label: t('fAll'), count: data.totalFiles || 0 },
      { key: 'read', label: t('fRead'), count: counts.read || 0 },
      { key: 'written', label: t('fWritten'), count: counts.written || 0 },
      { key: 'searched', label: t('fSearched'), count: counts.searched || 0 },
      { key: 'images', label: t('fImages'), count: counts.images || 0 },
    ];

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="calls-fold-btn" id="fa-toggle" type="button" aria-expanded="${!isCollapsed}">
              <span class="calls-chevron">${isCollapsed ? '▸' : '▾'}</span>
              <span class="card-title">${escHtml(t('filesTitle'))}</span>
            </button>
            <span class="pill mono">${data.totalFiles || 0}</span>
            ${(counts.addedLines || counts.removedLines)
              ? `<span class="pill mono"><span style="color:var(--good)">+${counts.addedLines}</span> / <span style="color:var(--danger)">-${counts.removedLines}</span></span>`
              : ''}
            <span class="card-subtitle">${escHtml(t('filesScopeHint'))}</span>
          </div>
          <div class="filter-bar">
            <span class="fa-filters-wrap filter-bar"${isCollapsed ? ' hidden' : ''}>
              ${tabs.map(tb => `
                <button class="pill pill-btn ${activeKind === tb.key ? 'active' : ''}" data-fkind="${tb.key}">
                  ${escHtml(tb.label)} (${tb.count})
                </button>
              `).join('')}
            </span>
            <button class="btn btn-sm" id="fa-fold-action" type="button">${escHtml(isCollapsed ? t('callsExpand') : t('callsCollapse'))}</button>
          </div>
        </div>

        <div class="fa-body"${isCollapsed ? ' hidden' : ''} style="display:flex;flex-direction:column;gap:8px">
          ${bodyBuilt ? buildBodyHtml() : ''}
        </div>
      </div>
    `;

    const toggleHandler = () => {
      isCollapsed = !isCollapsed;
      const bodyEl = container.querySelector('.fa-body');
      const filtersEl = container.querySelector('.fa-filters-wrap');
      const chevEl = container.querySelector('#fa-toggle .calls-chevron');
      const foldBtn = container.querySelector('#fa-toggle');
      const actionBtn = container.querySelector('#fa-fold-action');
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
    container.querySelector('#fa-toggle')?.addEventListener('click', toggleHandler);
    container.querySelector('#fa-fold-action')?.addEventListener('click', toggleHandler);

    container.querySelectorAll('[data-fkind]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeKind?.(btn.getAttribute('data-fkind')));
    });

    if (bodyBuilt) {
      bindBody(container.querySelector('.fa-body'));
    }
  }

  AGY.views = AGY.views || {};
  AGY.views.files = { render: renderFiles };
})(window);
