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
    const search = (state.search || '').trim().toLowerCase();
    const assistantKind = state.assistantKind || ''; // '', 'thinking', 'tools', 'answer'
    const openCats = state.openCats || new Set(['user', 'assistant', 'tool_results']);
    const openItems = state.openItems || new Set();
    const rawItems = state.rawItems || new Set();
    const catSort = state.catSort || {};

    const toolCallCounts = new Map();
    const toolResultsCat = (stepData?.categories || []).find(c => c.key === 'tool_results');
    for (const item of toolResultsCat?.items || []) {
      const name = item.toolName || item.title;
      if (name) toolCallCounts.set(name, (toolCallCounts.get(name) || 0) + 1);
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

    function renderSortSelect(catKey) {
      const current = catSort[catKey] || 'order';
      const opts = [
        ['order', t('browserSortOrder')],
        ['tokens', t('browserSortSize')],
        ...(catKey === 'tool_defs' ? [['calls', t('browserSortCalls')]] : []),
        ['title', t('browserSortName')],
        ['step', t('browserSortStep')],
      ];
      return `<select class="select br-cat-sort" data-cat-sort="${escHtml(catKey)}" title="${escHtml(t('browserSortTip'))}" aria-label="${escHtml(t('browserSort'))}">
        ${opts.map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${escHtml(label)}</option>`).join('')}
      </select>`;
    }

    if (!stepData) {
      container.innerHTML = `<div class="card"><div class="empty-state">${escHtml(t('loading'))}</div></div>`;
      return;
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

    let bodyHtml = '';

    if (viewMode === 'dna') {
      const dna = stepData.dna || { ribbon: [], list: [], totalTokens: 0 };
      const filteredDna = dna.list.filter(it => {
        if (!search) return true;
        const hay = `${it.title} ${it.category} ${it.toolName || ''} ${it.body || ''}`.toLowerCase();
        return hay.includes(search);
      });

      bodyHtml = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${AGY.charts.renderDnaRibbonHtml(dna.ribbon, dna.totalTokens)}
          <div class="card-subtitle">${escHtml(t('dnaRibbonHint'))}</div>
        </div>
        <div class="browser-scroll" id="dna-list">
          ${filteredDna.map(it => {
            const cm = CAT_LABELS[it.category] || { i18n: 'catTools', color: 'var(--cat-tools)' };
            const itemKey = `dna-${it.pos}`;
            const isOpen = openItems.has(itemKey);
            return `
              <div class="browser-item" data-dna-row="${it.pos}">
                <div class="browser-item-head" data-toggle-item="${itemKey}">
                  <span class="pill mono" style="font-size:10px">#${it.pos}</span>
                  <span class="legend-swatch" style="background:${cm.color}"></span>
                  <span class="browser-item-title">${escHtml(it.title)}</span>
                  <span class="pill mono" style="font-size:10px">S${it.stepIndex}</span>
                  <span class="mono" style="font-size:11px;color:var(--ink-muted)">~${escHtml(fmtTokens(it.tokens))}</span>
                </div>
                ${isOpen ? `
                  <div class="browser-item-detail">
                    <div class="filter-bar" style="justify-content:space-between">
                      <span class="pill">${escHtml(t(cm.i18n))}</span>
                      <button class="btn btn-sm" data-copy-text="${escHtml(encodeURIComponent(it.body || it.thinking || ''))}">${escHtml(t('copy'))}</button>
                    </div>
                    ${it.toolArgs ? `<pre class="code-block">${escHtml(JSON.stringify(it.toolArgs, null, 2))}</pre>` : ''}
                    ${it.thinking ? `<pre class="code-block">${escHtml(it.thinking)}</pre>` : ''}
                    ${it.body ? `<pre class="code-block">${escHtml(it.body)}</pre>` : ''}
                  </div>
                ` : ''}
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

        // Filter items by search & assistant kind
        const searchMatched = (cat.items || []).filter(it => {
          if (!search) return true;
          const hay = `${it.title || ''} ${it.toolName || ''} ${it.skillName || ''} ${it.body || ''} ${it.answer || ''} ${it.thinking || ''}`.toLowerCase();
          return hay.includes(search);
        });

        let kindCounts = null;
        let visibleItems = searchMatched;
        if (cat.key === 'assistant') {
          kindCounts = {
            thinking: searchMatched.filter(x => x.hasThinking).length,
            tools: searchMatched.filter(x => x.hasTools).length,
            answer: searchMatched.filter(x => x.hasAnswer).length,
          };
          if (assistantKind) {
            visibleItems = searchMatched.filter(x =>
              (assistantKind === 'thinking' && x.hasThinking) ||
              (assistantKind === 'tools' && x.hasTools) ||
              (assistantKind === 'answer' && x.hasAnswer)
            );
          }
        }
        visibleItems = sortItems(visibleItems, catSort[cat.key] || 'order');

        bodyHtml += `
          <div class="cat-group" data-cat-group="${cat.key}">
            <div class="cat-header" data-toggle-cat="${cat.key}">
              <div style="display:flex;align-items:center;gap:7px;min-width:0">
                <span style="color:var(--ink-muted);font-size:10px">${isOpen ? '▼' : '▶'}</span>
                <span class="legend-swatch" style="background:${cm.color}"></span>
                <span style="font-weight:600;font-size:12px">${escHtml(t(cm.i18n))}</span>
                <span class="pill mono">${visibleItems.length}</span>
                ${renderDeltaBadges(cat)}
              </div>
              <div class="filter-bar" style="gap:8px">
                ${isOpen && visibleItems.length > 1 ? renderSortSelect(cat.key) : ''}
                <span class="mono" style="font-size:11.5px;color:var(--ink-secondary)">~${escHtml(fmtTokens(cat.tokens))}</span>
              </div>
            </div>
            ${isOpen ? `
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
                      const statusPill = cat.key === 'tool_results'
                        ? `<span class="pill ${it.isError ? 'pill-danger' : 'pill-good'}" style="font-size:10px">${it.isError ? 'ERR' : 'OK'}</span>`
                        : '';
                      return `
                        <div class="browser-item" data-step-idx="${it.stepIndex ?? ''}">
                          <div class="browser-item-head" data-toggle-item="${escHtml(it.id)}">
                            <span style="color:var(--ink-muted);font-size:10px">${isItemOpen ? '▾' : '▸'}</span>
                            ${statusPill}
                            <span class="browser-item-title ${cat.key === 'tool_results' || cat.key === 'tool_defs' ? 'mono' : ''}">${escHtml(it.title || it.toolName || 'Item')}</span>
                            ${it.source ? `<span class="pill" style="font-size:10px">${escHtml(it.source)}</span>` : ''}
                            <span class="pill mono" style="font-size:10px">S${it.stepIndex ?? 0}</span>
                            <span class="mono" style="font-size:11px;color:var(--ink-muted)">~${escHtml(fmtTokens(it.tokens))}</span>
                          </div>
                          ${isItemOpen ? renderItemDetail(cat.key, it, isRaw) : ''}
                        </div>
                      `;
                    }).join('') || `<div class="card-subtitle" style="padding:6px">0</div>`
                }
              </div>
            ` : ''}
          </div>
        `;
      }

      bodyHtml += `</div>`;
    }

    container.innerHTML = `<div class="card">${headerHtml}${bodyHtml}</div>`;

    // Bind interactive controls
    container.querySelectorAll('[data-bview]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeViewMode?.(btn.getAttribute('data-bview')));
    });

    const baseSel = container.querySelector('#br-baseline');
    if (baseSel) {
      baseSel.addEventListener('change', () => callbacks?.onChangeBaseline?.(baseSel.value));
    }

    const searchInput = container.querySelector('#br-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => callbacks?.onSearch?.(searchInput.value));
    }

    container.querySelectorAll('[data-toggle-cat]').forEach(el => {
      el.addEventListener('click', () => callbacks?.onToggleCat?.(el.getAttribute('data-toggle-cat')));
    });

    container.querySelectorAll('[data-cat-sort]').forEach(sel => {
      sel.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      sel.addEventListener('click', (ev) => ev.stopPropagation());
      sel.addEventListener('change', (ev) => {
        ev.stopPropagation();
        callbacks?.onChangeCatSort?.(sel.getAttribute('data-cat-sort'), sel.value);
      });
    });

    container.querySelectorAll('[data-toggle-item]').forEach(el => {
      el.addEventListener('click', () => callbacks?.onToggleItem?.(el.getAttribute('data-toggle-item')));
    });

    container.querySelectorAll('[data-akind]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-akind');
        callbacks?.onChangeAssistantKind?.(assistantKind === k ? '' : k);
      });
    });

    container.querySelectorAll('[data-toggle-raw]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onToggleRaw?.(btn.getAttribute('data-toggle-raw')));
    });

    container.querySelectorAll('[data-copy-text]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const decoded = decodeURIComponent(btn.getAttribute('data-copy-text') || '');
        const ok = await AGY.bridge.copyText(decoded);
        if (ok) {
          const orig = btn.textContent;
          btn.textContent = t('copied');
          setTimeout(() => { btn.textContent = orig; }, 1200);
        }
      });
    });

    // Clicking a DNA ribbon segment jumps to and opens that item in the DNA list
    container.querySelectorAll('[data-dna-pos]').forEach(seg => {
      seg.addEventListener('click', () => {
        const pos = seg.getAttribute('data-dna-pos');
        callbacks?.onOpenDnaPos?.(pos);
      });
    });

    function renderItemDetail(catKey, it, isRaw) {
      if (catKey === 'assistant') {
        const parts = [];
        if (it.thinking) {
          parts.push(`<div><div class="card-subtitle" style="margin-bottom:4px">Thinking (~${escHtml(fmtTokens(it.thinkingTokens))})</div><pre class="code-block">${escHtml(it.thinking)}</pre></div>`);
        }
        if (it.toolCalls && it.toolCalls.length > 0) {
          parts.push(`<div><div class="card-subtitle" style="margin-bottom:4px">Tool Calls (${it.toolCalls.length})</div><pre class="code-block">${escHtml(JSON.stringify(it.toolCalls, null, 2))}</pre></div>`);
        }
        if (it.answer) {
          parts.push(`
            <div>
              <div class="filter-bar" style="justify-content:space-between;margin-bottom:4px">
                <span class="card-subtitle">Answer (~${escHtml(fmtTokens(it.answerTokens))})</span>
                <div class="filter-bar">
                  <button class="btn btn-sm" data-toggle-raw="${escHtml(it.id)}">${escHtml(isRaw ? t('mdView') : t('rawView'))}</button>
                  <button class="btn btn-sm" data-copy-text="${escHtml(encodeURIComponent(it.answer))}">${escHtml(t('copy'))}</button>
                </div>
              </div>
              ${isRaw
                ? `<pre class="code-block">${escHtml(it.answer)}</pre>`
                : `<div class="md-rendered">${renderSimpleMarkdown(it.answer)}</div>`
              }
            </div>
          `);
        }
        return `<div class="browser-item-detail">${parts.join('') || '<span class="card-subtitle">—</span>'}</div>`;
      }

      if (catKey === 'tool_results' || catKey === 'skills') {
        const bodyText = it.body || it.rawBody || '';
        return `
          <div class="browser-item-detail">
            <div class="filter-bar" style="justify-content:space-between">
              <div class="filter-bar">
                <span class="pill mono">${escHtml(it.toolName || 'tool')}</span>
                ${it.lineCount ? `<span class="pill mono">${it.lineCount} ${escHtml(t('linesUnit'))}</span>` : ''}
                ${it.durationMs ? `<span class="pill mono">${escHtml(fmtDuration(it.durationMs))}</span>` : ''}
                ${it.exitCode !== null && it.exitCode !== undefined ? `<span class="pill mono">exit ${it.exitCode}</span>` : ''}
              </div>
              <div class="filter-bar">
                <button class="btn btn-sm" data-toggle-raw="${escHtml(it.id)}">${escHtml(isRaw ? t('mdView') : t('rawView'))}</button>
                <button class="btn btn-sm" data-copy-text="${escHtml(encodeURIComponent(bodyText))}">${escHtml(t('copy'))}</button>
              </div>
            </div>
            ${it.toolArgs && Object.keys(it.toolArgs).length > 0 ? `<pre class="code-block" style="max-height:140px">${escHtml(JSON.stringify(it.toolArgs, null, 2))}</pre>` : ''}
            ${isRaw
              ? `<pre class="code-block">${escHtml(bodyText)}</pre>`
              : `<div class="md-rendered">${renderSimpleMarkdown(bodyText)}</div>`
            }
          </div>
        `;
      }

      const content = it.body || it.rawBody || '';
      return `
        <div class="browser-item-detail">
          <div class="filter-bar" style="justify-content:flex-end">
            <button class="btn btn-sm" data-copy-text="${escHtml(encodeURIComponent(content))}">${escHtml(t('copy'))}</button>
          </div>
          <pre class="code-block">${escHtml(content)}</pre>
        </div>
      `;
    }
  }

  AGY.views = AGY.views || {};
  AGY.views.browser = { render: renderBrowser };
})(window);
