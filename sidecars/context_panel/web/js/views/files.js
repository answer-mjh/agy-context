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
            <span class="card-title">${escHtml(t('filesTitle'))} <span class="pill mono">${data.totalFiles || 0}</span></span>
            ${(counts.addedLines || counts.removedLines)
              ? `<span class="pill mono"><span style="color:var(--good)">+${counts.addedLines}</span> / <span style="color:var(--danger)">-${counts.removedLines}</span></span>`
              : ''}
            <span class="card-subtitle">${escHtml(t('filesScopeHint'))}</span>
          </div>
          <div class="filter-bar">
            ${tabs.map(tb => `
              <button class="pill pill-btn ${activeKind === tb.key ? 'active' : ''}" data-fkind="${tb.key}">
                ${escHtml(tb.label)} (${tb.count})
              </button>
            `).join('')}
          </div>
        </div>

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
              ${list.map(f => {
                const isOpen = expanded.has(f.path);
                return `
                  <div class="row-item">
                    <div class="row-head" style="cursor:pointer" data-toggle-file="${escHtml(f.path)}">
                      <div style="display:flex;align-items:center;gap:7px;min-width:0;flex:1">
                        <span style="color:var(--ink-muted);font-size:10px">${isOpen ? '▾' : '▸'}</span>
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
                    ${isOpen ? `
                      <div style="display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid var(--border)">
                        ${f.operations.map(op => `
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
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>`
        }
      </div>
    `;

    container.querySelectorAll('[data-fkind]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeKind?.(btn.getAttribute('data-fkind')));
    });
    const searchEl = container.querySelector('#fa-search');
    if (searchEl) searchEl.addEventListener('input', () => callbacks?.onSearch?.(searchEl.value));
    const sortEl = container.querySelector('#fa-sort');
    if (sortEl) sortEl.addEventListener('change', () => callbacks?.onSort?.(sortEl.value));
    container.querySelectorAll('[data-toggle-file]').forEach(el => {
      el.addEventListener('click', () => callbacks?.onToggleFile?.(el.getAttribute('data-toggle-file')));
    });
    container.querySelectorAll('[data-jump-file-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [seqStr, stepStr] = (btn.getAttribute('data-jump-file-step') || '0:0').split(':');
        callbacks?.onJumpToBrowserStep?.(Number(seqStr), Number(stepStr));
      });
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.files = { render: renderFiles };
})(window);
