(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const CAT_LABELS = {
    system_base: { i18n: 'catSystemBase', color: 'var(--cat-system)' },
    tool_defs: { i18n: 'catToolDefs', color: 'var(--cat-tool-def)' },
    user: { i18n: 'catUser', color: 'var(--cat-user)' },
    injected: { i18n: 'catInjected', color: 'var(--cat-injected)' },
    skills: { i18n: 'catSkills', color: 'var(--cat-skills)' },
    assistant: { i18n: 'catAssistant', color: 'var(--cat-assistant)' },
    tool_results: { i18n: 'catToolResults', color: 'var(--cat-tools)' },
    media: { i18n: 'catMedia', color: 'var(--cat-media)' },
    other: { i18n: 'catOther', color: 'var(--cat-other)' },
  };

  function renderDeltaBadges(cat) {
    const { fmtSignedTokens } = AGY.i18n;
    if (cat.deltaItems === null && cat.deltaTokens === null) return '';
    const parts = [];
    if (cat.deltaItems !== null && cat.deltaItems !== 0) {
      const cls = cat.deltaItems > 0 ? 'delta-pos' : 'delta-neg';
      parts.push(`<span class="${cls}">${cat.deltaItems > 0 ? '+' : ''}${cat.deltaItems}</span>`);
    }
    if (cat.deltaTokens !== null && cat.deltaTokens !== 0) {
      const cls = cat.deltaTokens > 0 ? 'delta-pos' : 'delta-neg';
      parts.push(`<span class="${cls}">${fmtSignedTokens(cat.deltaTokens)}</span>`);
    }
    return parts.join(' ');
  }

  function renderBrowser(container, stepData, state, callbacks) {
    const { t, fmtTokens, fmtDuration, fmtBytes, escHtml, renderSimpleMarkdown } = AGY.i18n;
    const viewMode = state.viewMode || 'categories';
    const baseline = state.baseline || 'prev_turn';
    const assistantKind = state.assistantKind || ''; // '', 'thinking', 'tools', 'answer'
    const openCats = state.openCats || new Set(['user', 'assistant', 'tool_results']);
    const openItems = state.openItems || new Set();
    const rawItems = state.rawItems || new Set();
    const catSort = state.catSort || {};

    if (!stepData) {
      container.innerHTML = `<div class="card"><div class="empty-state">${escHtml(t('loading'))}</div></div>`;
      return;
    }

    const itemById = new Map();
    const categoryByKey = new Map();
    const toolCallCounts = new Map();
    for (const cat of stepData.categories || []) {
      categoryByKey.set(cat.key, cat);
      for (const it of cat.items || []) {
        itemById.set(it.id, { catKey: cat.key, item: it });
        if (cat.key === 'tool_results') {
          const name = it.toolName || it.title;
          if (name) toolCallCounts.set(name, (toolCallCounts.get(name) || 0) + 1);
        }
      }
    }
    for (const d of stepData.dna?.list || []) {
      const targetId = d.itemId || '';
      if (targetId && !itemById.has(targetId)) {
        itemById.set(targetId, { catKey: d.category, item: d });
      }
    }

    function sortItems(items, mode) {
      if (!mode || mode === 'order') return items;
      const arr = items.slice();
      if (mode === 'tokens') {
        arr.sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
      } else if (mode === 'calls') {
        const calls = (x) => toolCallCounts.get(x.toolName || x.title) || 0;
        arr.sort((a, b) => calls(b) - calls(a) || (b.tokens || 0) - (a.tokens || 0));
      } else if (mode === 'title') {
        arr.sort((a, b) => String(a.title || a.toolName || '').localeCompare(
          String(b.title || b.toolName || ''), undefined, { numeric: true, sensitivity: 'base' }
        ));
      } else if (mode === 'step') {
        arr.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
      }
      return arr;
    }

    function renderSortSelect(catKey, isHidden = false) {
      const current = catSort[catKey] || 'order';
      const opts = [
        ['order', t('browserSortOrder')],
        ['tokens', t('browserSortSize')],
        ...(catKey === 'tool_defs' ? [['calls', t('browserSortCalls')]] : []),
        ['title', t('browserSortName')],
        ['step', t('browserSortStep')],
      ];
      return `<select class="select br-cat-sort" data-cat-sort="${escHtml(catKey)}" title="${escHtml(t('browserSortTip'))}" aria-label="${escHtml(t('browserSort'))}"${isHidden ? ' hidden' : ''}>
        ${opts.map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${escHtml(label)}</option>`).join('')}
      </select>`;
    }

    function getCopyText(itemId, field) {
      const detail = callbacks?.getCachedDetail?.(itemId) || null;
      const meta = itemById.get(itemId)?.item || null;
      if (!detail && !meta) return '';
      if (field === 'answer') return detail?.answer || '';
      if (field === 'dna') return detail?.body || detail?.answer || detail?.thinking || '';
      return detail?.body || detail?.rawBody || detail?.answer || detail?.thinking || '';
    }

    function renderItemDetailHtml(catKey, it, detail, isRaw, toggleKey, itemId, isDnaMode = false) {
      if (!detail) {
        return `<div class="browser-item-detail"><span class="card-subtitle">${escHtml(t('loading'))}</span></div>`;
      }

      if (isDnaMode) {
        const cm = CAT_LABELS[it.category || catKey] || { i18n: 'catTools' };
        const copyTxt = detail.body || detail.answer || detail.thinking || '';
        return `
          <div class="browser-item-detail">
            <div class="filter-bar" style="justify-content:space-between">
              <span class="pill">${escHtml(t(cm.i18n))}</span>
              ${copyTxt ? `<button class="btn btn-sm" data-copy-item="${escHtml(itemId)}" data-copy-field="dna">${escHtml(t('copy'))}</button>` : ''}
            </div>
            ${detail.toolArgs ? `<pre class="code-block">${escHtml(JSON.stringify(detail.toolArgs, null, 2))}</pre>` : ''}
            ${detail.toolCalls && detail.toolCalls.length > 0 ? `<pre class="code-block">${escHtml(JSON.stringify(detail.toolCalls, null, 2))}</pre>` : ''}
            ${detail.thinking ? `<pre class="code-block">${escHtml(detail.thinking)}</pre>` : ''}
            ${detail.body ? `<pre class="code-block">${escHtml(detail.body)}</pre>` : ''}
            ${!detail.body && detail.answer ? `<pre class="code-block">${escHtml(detail.answer)}</pre>` : ''}
          </div>
        `;
      }

      if (catKey === 'assistant') {
        const parts = [];
        if (detail.thinking) {
          parts.push(`<div><div class="card-subtitle" style="margin-bottom:4px">Thinking (~${escHtml(fmtTokens(it.thinkingTokens || 0))})</div><pre class="code-block">${escHtml(detail.thinking)}</pre></div>`);
        }
        if (detail.toolCalls && detail.toolCalls.length > 0) {
          parts.push(`<div><div class="card-subtitle" style="margin-bottom:4px">Tool Calls (${detail.toolCalls.length})</div><pre class="code-block">${escHtml(JSON.stringify(detail.toolCalls, null, 2))}</pre></div>`);
        }
        if (detail.answer) {
          parts.push(`
            <div>
              <div class="filter-bar" style="justify-content:space-between;margin-bottom:4px">
                <span class="card-subtitle">Answer (~${escHtml(fmtTokens(it.answerTokens || 0))})</span>
                <div class="filter-bar">
                  <button class="btn btn-sm" data-toggle-raw="${escHtml(toggleKey)}" data-raw-item-id="${escHtml(itemId)}" data-raw-cat="${escHtml(catKey)}">${escHtml(isRaw ? t('mdView') : t('rawView'))}</button>
                  <button class="btn btn-sm" data-copy-item="${escHtml(itemId)}" data-copy-field="answer">${escHtml(t('copy'))}</button>
                </div>
              </div>
              ${isRaw
                ? `<pre class="code-block">${escHtml(detail.answer)}</pre>`
                : `<div class="md-rendered">${renderSimpleMarkdown(detail.answer)}</div>`
              }
            </div>
          `);
        }
        return `<div class="browser-item-detail">${parts.join('') || '<span class="card-subtitle">—</span>'}</div>`;
      }

      if (catKey === 'tool_results' || catKey === 'skills') {
        const bodyText = detail.body || detail.rawBody || '';
        const lineCount = detail.lineCount || it.lineCount || 0;
        const durationMs = detail.durationMs || it.durationMs || 0;
        const exitCode = detail.exitCode !== null && detail.exitCode !== undefined ? detail.exitCode : it.exitCode;
        return `
          <div class="browser-item-detail">
            <div class="filter-bar" style="justify-content:space-between">
              <div class="filter-bar">
                <span class="pill mono">${escHtml(detail.toolName || it.toolName || 'tool')}</span>
                ${lineCount ? `<span class="pill mono">${lineCount} ${escHtml(t('linesUnit'))}</span>` : ''}
                ${durationMs ? `<span class="pill mono">${escHtml(fmtDuration(durationMs))}</span>` : ''}
                ${exitCode !== null && exitCode !== undefined ? `<span class="pill mono">exit ${exitCode}</span>` : ''}
              </div>
              <div class="filter-bar">
                <button class="btn btn-sm" data-toggle-raw="${escHtml(toggleKey)}" data-raw-item-id="${escHtml(itemId)}" data-raw-cat="${escHtml(catKey)}">${escHtml(isRaw ? t('mdView') : t('rawView'))}</button>
                <button class="btn btn-sm" data-copy-item="${escHtml(itemId)}" data-copy-field="body">${escHtml(t('copy'))}</button>
              </div>
            </div>
            ${detail.toolArgs && Object.keys(detail.toolArgs).length > 0 ? `<pre class="code-block" style="max-height:140px">${escHtml(JSON.stringify(detail.toolArgs, null, 2))}</pre>` : ''}
            ${isRaw
              ? `<pre class="code-block">${escHtml(bodyText)}</pre>`
              : `<div class="md-rendered">${renderSimpleMarkdown(bodyText)}</div>`
            }
          </div>
        `;
      }

      const content = detail.body || detail.rawBody || '';
      return `
        <div class="browser-item-detail">
          <div class="filter-bar" style="justify-content:flex-end">
            <button class="btn btn-sm" data-copy-item="${escHtml(itemId)}" data-copy-field="body">${escHtml(t('copy'))}</button>
          </div>
          <pre class="code-block">${escHtml(content)}</pre>
        </div>
      `;
    }

    function bindDetailControls(scope) {
      scope.querySelectorAll('[data-toggle-raw]').forEach(btn => {
        btn.addEventListener('click', () => {
          const toggleKey = btn.getAttribute('data-toggle-raw');
          const itemId = btn.getAttribute('data-raw-item-id') || toggleKey;
          const catKey = btn.getAttribute('data-raw-cat') || 'tool_results';
          const rowEl = btn.closest('.browser-item');
          const isDna = Boolean(rowEl?.hasAttribute('data-dna-row'));
          const nextRaw = !rawItems.has(toggleKey);
          callbacks?.onToggleRaw?.(toggleKey, { silent: true });
          const metaItem = itemById.get(itemId)?.item || {};
          const detail = callbacks?.getCachedDetail?.(itemId) || null;
          if (!rowEl || !detail) return;
          const oldDetail = rowEl.querySelector('.browser-item-detail');
          if (oldDetail) oldDetail.remove();
          rowEl.insertAdjacentHTML('beforeend', renderItemDetailHtml(catKey, metaItem, detail, nextRaw, toggleKey, itemId, isDna));
          const newDetail = rowEl.querySelector('.browser-item-detail');
          if (newDetail) bindDetailControls(newDetail);
        });
      });

      scope.querySelectorAll('[data-copy-item]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.getAttribute('data-copy-item') || '';
          const field = btn.getAttribute('data-copy-field') || 'body';
          const txt = getCopyText(itemId, field);
          const ok = await AGY.bridge.copyText(txt);
          if (ok) {
            const orig = btn.textContent;
            btn.textContent = t('copied');
            setTimeout(() => { btn.textContent = orig; }, 1200);
          }
        });
      });
    }

    async function hydrateItemDetail(rowEl, itemId, catKey, toggleKey, isDna) {
      const detail = await callbacks?.onLoadItemDetail?.(itemId);
      if (!rowEl || !rowEl.isConnected || !openItems.has(toggleKey)) return;
      const metaItem = itemById.get(itemId)?.item || {};
      const oldDetail = rowEl.querySelector('.browser-item-detail');
      if (oldDetail) oldDetail.remove();
      rowEl.insertAdjacentHTML(
        'beforeend',
        detail
          ? renderItemDetailHtml(catKey, metaItem, detail, rawItems.has(toggleKey), toggleKey, itemId, isDna)
          : `<div class="browser-item-detail"><span class="card-subtitle">—</span></div>`
      );
      const newDetail = rowEl.querySelector('.browser-item-detail');
      if (newDetail) bindDetailControls(newDetail);
    }

    function bindItemHeaders(scope) {
      scope.querySelectorAll('[data-toggle-item]').forEach(head => {
        head.addEventListener('click', () => {
          const toggleKey = head.getAttribute('data-toggle-item');
          const itemId = head.getAttribute('data-item-id') || toggleKey;
          const catKey = head.getAttribute('data-cat-key') || 'other';
          const rowEl = head.closest('.browser-item');
          const chev = head.querySelector('[data-item-chev]');
          const isDna = Boolean(rowEl?.hasAttribute('data-dna-row'));
          const willOpen = !openItems.has(toggleKey);

          callbacks?.onToggleItem?.(toggleKey, { silent: true });
          if (chev) chev.textContent = willOpen ? '▾' : '▸';
          if (!rowEl) return;

          const existing = rowEl.querySelector('.browser-item-detail');
          if (!willOpen) {
            if (existing) existing.remove();
            return;
          }

          const cachedDetail = callbacks?.getCachedDetail?.(itemId) || null;
          if (existing) existing.remove();
          const metaItem = itemById.get(itemId)?.item || {};
          rowEl.insertAdjacentHTML(
            'beforeend',
            renderItemDetailHtml(catKey, metaItem, cachedDetail, rawItems.has(toggleKey), toggleKey, itemId, isDna)
          );
          if (cachedDetail) {
            const newDetail = rowEl.querySelector('.browser-item-detail');
            if (newDetail) bindDetailControls(newDetail);
          } else {
            void hydrateItemDetail(rowEl, itemId, catKey, toggleKey, isDna);
          }
        });
      });
    }

    function computeVisibleCatItems(cat) {
      let visibleItems = cat.items || [];
      let kindCounts = null;
      if (cat.key === 'assistant') {
        kindCounts = {
          thinking: visibleItems.filter(x => x.hasThinking).length,
          tools: visibleItems.filter(x => x.hasTools).length,
          answer: visibleItems.filter(x => x.hasAnswer).length,
        };
        if (assistantKind) {
          visibleItems = visibleItems.filter(x =>
            (assistantKind === 'thinking' && x.hasThinking) ||
            (assistantKind === 'tools' && x.hasTools) ||
            (assistantKind === 'answer' && x.hasAnswer)
          );
        }
      }
      visibleItems = sortItems(visibleItems, catSort[cat.key] || 'order');
      return { visibleItems, kindCounts };
    }

    function renderCategoryBodyHtml(cat, visibleItems, kindCounts, pendingHydrations) {
      return `
        <div class="cat-body">
          ${cat.key === 'assistant' && kindCounts ? `
            <div class="filter-bar" style="margin-bottom:2px">
              ${['thinking', 'tools', 'answer'].map(k => {
                const labelKey = k === 'thinking' ? 'filterThinking' : k === 'tools' ? 'filterTools' : 'filterAnswer';
                return `<button class="pill pill-btn ${assistantKind === k ? 'active' : ''}" data-akind="${k}">${escHtml(t(labelKey))} (${kindCounts[k]})</button>`;
              }).join('')}
            </div>
          ` : ''}

          ${cat.key === 'media'
            ? (visibleItems.length > 0
                ? `<div class="media-grid">${visibleItems.map(m => `
                    <div class="media-card">
                      ${m.attachmentUrl ? `<img class="media-thumb" src="${escHtml(m.attachmentUrl)}" alt="${escHtml(m.title)}" loading="lazy"/>` : `<div class="media-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--ink-muted)">${escHtml(m.ext || 'FILE')}</div>`}
                      <div class="media-meta">
                        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(m.title)}">${escHtml(m.title)}</div>
                        <div class="mono" style="color:var(--ink-muted)">${escHtml(fmtBytes(m.fileSize))} · ~${escHtml(fmtTokens(m.tokens))} tok</div>
                      </div>
                    </div>
                  `).join('')}</div>`
                : `<div class="card-subtitle" style="padding:6px">0</div>`)
            : visibleItems.map(it => {
                const isItemOpen = openItems.has(it.id);
                const isRaw = rawItems.has(it.id);
                const cachedDetail = isItemOpen ? (callbacks?.getCachedDetail?.(it.id) || null) : null;
                if (isItemOpen && !cachedDetail && pendingHydrations) {
                  pendingHydrations.push({ toggleKey: it.id, itemId: it.id, catKey: cat.key, isDna: false });
                }
                const statusPill = cat.key === 'tool_results'
                  ? `<span class="pill ${it.isError ? 'pill-danger' : 'pill-good'}" style="font-size:10px">${it.isError ? 'ERR' : 'OK'}</span>`
                  : '';
                return `
                  <div class="browser-item" data-step-idx="${it.stepIndex ?? ''}" data-item-row="${escHtml(it.id)}">
                    <div class="browser-item-head" data-toggle-item="${escHtml(it.id)}" data-item-id="${escHtml(it.id)}" data-cat-key="${escHtml(cat.key)}">
                      <span data-item-chev style="color:var(--ink-muted);font-size:10px">${isItemOpen ? '▾' : '▸'}</span>
                      ${statusPill}
                      <span class="browser-item-title ${cat.key === 'tool_results' || cat.key === 'tool_defs' ? 'mono' : ''}">${escHtml(it.title || it.toolName || 'Item')}</span>
                      ${it.source ? `<span class="pill" style="font-size:10px">${escHtml(it.source)}</span>` : ''}
                      <span class="pill mono" style="font-size:10px">S${it.stepIndex ?? 0}</span>
                      <span class="mono" style="font-size:11px;color:var(--ink-muted)">~${escHtml(fmtTokens(it.tokens))}</span>
                    </div>
                    ${isItemOpen ? renderItemDetailHtml(cat.key, it, cachedDetail, isRaw, it.id, it.id, false) : ''}
                  </div>
                `;
              }).join('') || `<div class="card-subtitle" style="padding:6px">0</div>`
          }
        </div>
      `;
    }

    function bindAssistantKindButtons(scope) {
      scope.querySelectorAll('[data-akind]').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.getAttribute('data-akind');
          callbacks?.onChangeAssistantKind?.(assistantKind === k ? '' : k);
        });
      });
    }

    const headerHtml = `
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="card-title">${escHtml(t('browserTitle'))}</span>
          <span class="pill mono">${stepData.isLatest ? escHtml(t('latestStep')) : `#${stepData.seq + 1}`}</span>
          ${stepData.officialFixed ? `<span class="pill" style="color:var(--good)">${escHtml(t('officialSnapshot'))}</span>` : ''}
          ${stepData.actual ? `<span class="card-subtitle mono">Prompt ${escHtml(fmtTokens(stepData.actual.totalPromptTokens))}</span>` : ''}
        </div>
        <div class="filter-bar">
          <div class="nav-tabs">
            <button class="nav-tab ${viewMode === 'categories' ? 'active' : ''}" data-bview="categories">${escHtml(t('viewCategories'))}</button>
            <button class="nav-tab ${viewMode === 'dna' ? 'active' : ''}" data-bview="dna">${escHtml(t('viewDna'))}</button>
          </div>
          ${viewMode === 'categories' ? `
            <select class="select" id="br-baseline" style="font-size:11px">
              <option value="prev_turn" ${baseline === 'prev_turn' ? 'selected' : ''}>${escHtml(t('baselinePrevTurn'))}</option>
              <option value="prev_step" ${baseline === 'prev_step' ? 'selected' : ''}>${escHtml(t('baselinePrevStep'))}</option>
            </select>
          ` : ''}
        </div>
      </div>
      <div class="filter-bar">
        <input class="input" id="br-search" type="search" style="flex:1;min-width:160px" placeholder="${escHtml(t('searchBrowser'))}" value="${escHtml(state.search || '')}"/>
      </div>
    `;

    const pendingHydrations = [];
    const catBuilt = new Set();
    let bodyHtml = '';

    if (viewMode === 'dna') {
      const dna = stepData.dna || { ribbon: [], list: [], totalTokens: 0 };
      const dnaList = dna.list || [];

      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${AGY.charts.renderDnaRibbonHtml(dna.ribbon, dna.totalTokens)}
          <div class="card-subtitle">${escHtml(t('dnaRibbonHint'))}</div>
        </div>
        <div class="browser-scroll" id="dna-list">
          ${dnaList.map(it => {
            const cm = CAT_LABELS[it.category] || { i18n: 'catTools', color: 'var(--cat-tools)' };
            const toggleKey = `dna-${it.pos}`;
            const itemId = it.itemId || toggleKey;
            const isOpen = openItems.has(toggleKey);
            const cachedDetail = isOpen ? (callbacks?.getCachedDetail?.(itemId) || null) : null;
            if (isOpen && !cachedDetail) {
              pendingHydrations.push({ toggleKey, itemId, catKey: it.category, isDna: true });
            }
            return `
              <div class="browser-item" data-dna-row="${it.pos}" data-item-row="${escHtml(toggleKey)}">
                <div class="browser-item-head" data-toggle-item="${escHtml(toggleKey)}" data-item-id="${escHtml(itemId)}" data-cat-key="${escHtml(it.category)}">
                  <span data-item-chev style="color:var(--ink-muted);font-size:10px">${isOpen ? '▾' : '▸'}</span>
                  <span class="pill mono" style="font-size:10px">#${it.pos}</span>
                  <span class="legend-swatch" style="background:${cm.color}"></span>
                  <span class="browser-item-title">${escHtml(it.title)}</span>
                  <span class="pill mono" style="font-size:10px">S${it.stepIndex}</span>
                  <span class="mono" style="font-size:11px;color:var(--ink-muted)">~${escHtml(fmtTokens(it.tokens))}</span>
                </div>
                ${isOpen ? renderItemDetailHtml(it.category, it, cachedDetail, rawItems.has(toggleKey), toggleKey, itemId, true) : ''}
              </div>
            `;
          }).join('') || `<div class="empty-state">${escHtml(t('noData'))}</div>`}
        </div>
      `;
    } else {
      const categories = stepData.categories || [];
      bodyHtml = `<div class="browser-scroll" id="br-cats">`;

      for (const cat of categories) {
        const cm = CAT_LABELS[cat.key] || { i18n: 'catTools', color: 'var(--cat-tools)' };
        const isOpen = openCats.has(cat.key);
        const { visibleItems, kindCounts } = computeVisibleCatItems(cat);
        if (isOpen) catBuilt.add(cat.key);

        bodyHtml += `
          <div class="cat-group" data-cat-group="${cat.key}">
            <div class="cat-header" data-toggle-cat="${cat.key}">
              <div style="display:flex;align-items:center;gap:7px;min-width:0">
                <span data-cat-chev style="color:var(--ink-muted);font-size:10px">${isOpen ? '▼' : '▶'}</span>
                <span class="legend-swatch" style="background:${cm.color}"></span>
                <span style="font-weight:600;font-size:12px">${escHtml(t(cm.i18n))}</span>
                <span class="pill mono">${visibleItems.length}</span>
                ${renderDeltaBadges(cat)}
              </div>
              <div class="filter-bar" style="gap:8px">
                ${visibleItems.length > 1 ? renderSortSelect(cat.key, !isOpen) : ''}
                <span class="mono" style="font-size:11.5px;color:var(--ink-secondary)">~${escHtml(fmtTokens(cat.tokens))}</span>
              </div>
            </div>
            ${isOpen ? renderCategoryBodyHtml(cat, visibleItems, kindCounts, pendingHydrations) : ''}
          </div>
        `;
      }

      bodyHtml += `</div>`;
    }

    container.innerHTML = `<div class="card">${headerHtml}${bodyHtml}</div>`;

    container.querySelectorAll('[data-bview]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeViewMode?.(btn.getAttribute('data-bview')));
    });

    const baseSel = container.querySelector('#br-baseline');
    if (baseSel) {
      baseSel.addEventListener('change', () => callbacks?.onChangeBaseline?.(baseSel.value));
    }

    const searchInput = container.querySelector('#br-search');
    if (searchInput) {
      let searchTimer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => callbacks?.onSearch?.(searchInput.value), 180);
      });
    }

    container.querySelectorAll('[data-toggle-cat]').forEach(el => {
      el.addEventListener('click', () => {
        const catKey = el.getAttribute('data-toggle-cat');
        const groupEl = el.closest('[data-cat-group]');
        const chev = el.querySelector('[data-cat-chev]');
        const sortSel = groupEl?.querySelector('[data-cat-sort]');
        const willOpen = !openCats.has(catKey);
        callbacks?.onToggleCat?.(catKey, { silent: true });

        if (chev) chev.textContent = willOpen ? '▼' : '▶';
        if (sortSel) sortSel.hidden = !willOpen;
        if (!groupEl) return;

        let bodyEl = groupEl.querySelector('.cat-body');
        if (!willOpen) {
          if (bodyEl) bodyEl.hidden = true;
          return;
        }

        if (bodyEl && catBuilt.has(catKey)) {
          bodyEl.hidden = false;
          return;
        }

        const catObj = categoryByKey.get(catKey);
        if (!catObj) return;
        const { visibleItems, kindCounts } = computeVisibleCatItems(catObj);
        const lazyHydrations = [];
        groupEl.insertAdjacentHTML('beforeend', renderCategoryBodyHtml(catObj, visibleItems, kindCounts, lazyHydrations));
        catBuilt.add(catKey);
        bodyEl = groupEl.querySelector('.cat-body');
        if (bodyEl) {
          bindItemHeaders(bodyEl);
          bindDetailControls(bodyEl);
          bindAssistantKindButtons(bodyEl);
          for (const h of lazyHydrations) {
            const row = bodyEl.querySelector(`[data-item-row="${CSS.escape(h.toggleKey)}"]`);
            if (row) void hydrateItemDetail(row, h.itemId, h.catKey, h.toggleKey, h.isDna);
          }
        }
      });
    });

    container.querySelectorAll('[data-cat-sort]').forEach(sel => {
      sel.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      sel.addEventListener('click', (ev) => ev.stopPropagation());
      sel.addEventListener('change', (ev) => {
        ev.stopPropagation();
        callbacks?.onChangeCatSort?.(sel.getAttribute('data-cat-sort'), sel.value);
      });
    });

    bindItemHeaders(container);
    bindDetailControls(container);
    bindAssistantKindButtons(container);

    for (const h of pendingHydrations) {
      const row = container.querySelector(`[data-item-row="${CSS.escape(h.toggleKey)}"]`);
      if (row) void hydrateItemDetail(row, h.itemId, h.catKey, h.toggleKey, h.isDna);
    }

    // Clicking a DNA ribbon segment opens and scrolls to that item in-place
    container.querySelectorAll('[data-dna-pos]').forEach(seg => {
      seg.addEventListener('click', () => {
        const pos = seg.getAttribute('data-dna-pos');
        const toggleKey = `dna-${pos}`;
        const row = container.querySelector(`[data-dna-row="${pos}"]`);
        if (row) {
          if (!openItems.has(toggleKey)) {
            row.querySelector('[data-toggle-item]')?.click();
          }
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          callbacks?.onOpenDnaPos?.(pos);
        }
      });
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.browser = { render: renderBrowser };
})(window);
