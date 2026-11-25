(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function renderTimeline(container, session, state, callbacks) {
    const { t, fmtTokens, fmtSignedTokens, fmtPct, fmtDuration, escHtml } = AGY.i18n;
    const gran = state.granularity || 'step';
    const mode = state.mode || 'total';
    const items = gran === 'turn' ? (session.timeline.turns || []) : (session.timeline.steps || []);
    const steps = session.timeline.steps || [];

    const activeSeq =
      state.hoveredSeq >= 0
        ? state.hoveredSeq
        : state.pinnedSeq >= 0
          ? state.pinnedSeq
          : steps.length - 1;
    const activeSnap = activeSeq >= 0 && activeSeq < steps.length ? steps[activeSeq] : null;
    const isPinned = state.pinnedSeq >= 0 && state.pinnedSeq < steps.length - 1;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="card-title">${escHtml(t('timelineTitle'))}</span>
            ${isPinned
              ? `<span class="pill pill-accent mono">${escHtml(t('pinnedStep'))} #${state.pinnedSeq + 1}</span>
                 <button class="btn btn-sm" id="tl-unpin">${escHtml(t('unpin'))}</button>`
              : `<span class="pill mono">${escHtml(t('latestStep'))} #${Math.max(1, steps.length)}</span>`
            }
          </div>
          <div class="filter-bar">
            <div class="nav-tabs">
              <button class="nav-tab ${gran === 'step' ? 'active' : ''}" data-gran="step">${escHtml(t('granStep'))}</button>
              <button class="nav-tab ${gran === 'turn' ? 'active' : ''}" data-gran="turn">${escHtml(t('granTurn'))}</button>
            </div>
            <div class="nav-tabs">
              <button class="nav-tab ${mode === 'total' ? 'active' : ''}" data-mode="total">${escHtml(t('modeTotal'))}</button>
              <button class="nav-tab ${mode === 'delta' ? 'active' : ''}" data-mode="delta">${escHtml(t('modeDelta'))}</button>
              <button class="nav-tab ${mode === 'overview' ? 'active' : ''}" data-mode="overview">${escHtml(t('modeOverview'))}</button>
            </div>
          </div>
        </div>

        <div class="chart-wrap" id="tl-chart-host"></div>

        <!-- Actual Provider Telemetry Strip for active/pinned step -->
        ${activeSnap ? `
          <div class="filter-bar" style="font-size:11px;justify-content:space-between;padding-top:4px;border-top:1px solid var(--border)">
            <div class="filter-bar">
              <span class="pill mono">#${activeSnap.seq + 1} · T${activeSnap.turnIndex}</span>
              <span class="pill mono">Prompt ${escHtml(fmtTokens(activeSnap.actual.totalPromptTokens))} (${escHtml(fmtSignedTokens(activeSnap.delta.total))})</span>
              <span class="pill mono">Cache ${escHtml(fmtTokens(activeSnap.actual.cacheReadTokens))} (${escHtml(fmtPct(activeSnap.actual.cacheHitRate))})</span>
              <span class="pill mono">Out ${escHtml(fmtTokens(activeSnap.actual.outputTokens))}</span>
              <span class="pill mono">${escHtml(fmtDuration(activeSnap.durationMs))}</span>
            </div>
            ${(activeSnap.flags || []).length > 0 ? `
              <div class="filter-bar">
                ${activeSnap.flags.map(f => {
                  const fm = AGY.charts.FLAG_ICONS[f];
                  return fm ? `<span class="pill" style="color:${fm.color};border-color:${fm.color}">${fm.symbol} ${escHtml(t(fm.i18n))}</span>` : '';
                }).join('')}
              </div>
            ` : ''}
          </div>

          <!-- 3-Row Step Brief -->
          <div class="step-brief">
            <div class="brief-row" data-brief-cat="user">
              <span class="brief-tag">${escHtml(t('stepBriefUser'))}</span>
              <span class="brief-text">${escHtml(activeSnap.brief?.user || '—')}</span>
            </div>
            <div class="brief-row" data-brief-cat="tool_results">
              <span class="brief-tag">${escHtml(t('stepBriefIn'))}</span>
              <span class="brief-text">${
                (activeSnap.brief?.inItems || []).length > 0
                  ? escHtml(activeSnap.brief.inItems.map(x => x.label).join(' · '))
                  : '—'
              }</span>
            </div>
            <div class="brief-row" data-brief-cat="assistant">
              <span class="brief-tag">${escHtml(t('stepBriefResp'))}</span>
              <span class="brief-text">${
                escHtml(
                  [
                    activeSnap.brief?.responseTools?.length ? `[${activeSnap.brief.responseTools.join(', ')}]` : '',
                    activeSnap.brief?.responseText || '',
                  ].filter(Boolean).join(' ') || '—'
                )
              }</span>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    const chartHost = container.querySelector('#tl-chart-host');
    if (chartHost) {
      AGY.charts.renderTimelineChart(chartHost, items, {
        mode,
        granularity: gran,
        pinnedSeq: state.pinnedSeq >= 0 ? state.pinnedSeq : steps.length - 1,
        onHover: (seq) => {
          if (callbacks?.onHoverSeq) callbacks.onHoverSeq(seq);
        },
        onPin: (seq) => {
          if (callbacks?.onPinSeq) callbacks.onPinSeq(seq);
        },
      });
    }

    container.querySelectorAll('[data-gran]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeGranularity?.(btn.getAttribute('data-gran')));
    });
    container.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeMode?.(btn.getAttribute('data-mode')));
    });
    const unpinBtn = container.querySelector('#tl-unpin');
    if (unpinBtn) {
      unpinBtn.addEventListener('click', () => callbacks?.onPinSeq?.(-1));
    }
    container.querySelectorAll('[data-brief-cat]').forEach(row => {
      row.addEventListener('click', () => callbacks?.onFocusCategory?.(row.getAttribute('data-brief-cat')));
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.timeline = { render: renderTimeline };
})(window);
