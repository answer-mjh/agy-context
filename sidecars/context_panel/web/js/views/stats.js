(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function renderStats(container, session, callbacks) {
    const { t, fmtTokens, fmtCompactCount, fmtCost, fmtPct, fmtDuration, escHtml, getLang } = AGY.i18n;
    const { stats, meta, commands, timeline } = session;
    const cs = stats.context || {};
    const ts = stats.tokens || {};
    const tm = stats.timing || {};
    const evSum = cs.eventsSummary || {};
    const fileOps = cs.fileOps || { read: 0, written: 0, searched: 0, images: 0 };
    const topTools = cs.topTools || [];
    const cmdProgs = commands?.programs || [];
    const cmdTotal = commands?.summary?.total || 0;
    const p = meta.pricing || {};
    const fam = session.fleet || null;
    const version = document.body.getAttribute('data-version') || '0.1.0';
    const isZh = getLang() === 'zh';

    const pricingTitle = `${t('pricingHint')}\n${meta.modelLabel || meta.model}\nIn: $${p.inputPerM}/1M · Cache: $${p.cacheReadPerM}/1M · Out: $${p.outputPerM}/1M${p.isFallback ? ' (fallback)' : ''}`;
    const speedLines = [
      tm.speedSource === 'streaming' ? t('speedTooltipStreaming') : t('speedTooltipEstimated'),
      tm.avgTtftMs > 0 ? `${t('avgTtftLabel')}: ${fmtDuration(tm.avgTtftMs)}` : '',
      tm.endToEndTokensPerSec > 0 ? `${t('endToEndSpeedLabel')}: ${tm.endToEndTokensPerSec} tok/s` : '',
    ].filter(Boolean);
    const speedTitle = speedLines.join('\n');
    const ioTotal = (cs.userInputs || 0) + (fileOps.read || 0) + (fileOps.written || 0);
    const extraToolsCount = Math.max(0, topTools.length - 2);

    container.innerHTML = `
      <!-- Row 1: Context Stats (Left) + Plugin Info (Right) -->
      <div class="dsh-sess-top">
        <div class="card">
          <div class="card-header">
            <span class="card-title">⛁ ${escHtml(t('contextStats'))}</span>
            <span class="card-subtitle mono">${escHtml(meta.title || '')}</span>
          </div>

          <!-- 5-Tile Top Strip -->
          <div class="dsh-stat-strip">
            <div class="dsh-stat-tile">
              <div class="dsh-stat-num" style="color:var(--good)">${cs.turns || 0}</div>
              <div class="dsh-stat-lbl">${escHtml(t('turns'))}</div>
            </div>
            <div class="dsh-stat-tile">
              <div class="dsh-stat-num" style="color:var(--accent)">${cs.requests || 0}</div>
              <div class="dsh-stat-lbl">${escHtml(t('requests'))}</div>
            </div>
            <div class="dsh-stat-tile">
              <div class="dsh-stat-num" style="color:var(--cat-injected)">${cs.skillsLoaded || 0}</div>
              <div class="dsh-stat-lbl">${escHtml(t('skillsLoadedLabel'))}</div>
            </div>
            <div class="dsh-stat-tile">
              <div class="dsh-stat-num" style="color:#16a34a">${cs.userInputs || 0}</div>
              <div class="dsh-stat-lbl">${escHtml(t('userInputsLabel'))}</div>
            </div>
            <div class="dsh-stat-tile" data-jump="events" style="cursor:pointer">
              <div class="dsh-stat-lbl">${escHtml(t('ctxEventsLabel'))}</div>
              <div class="dsh-ev-inline">
                <span style="color:var(--good)">${escHtml(t('evInjection'))} ${evSum.injection || 0}</span>
                <span style="color:var(--ink-muted)">/</span>
                <span style="color:var(--danger)">${escHtml(t('evCompaction'))} ${evSum.compaction || 0}</span>
                <span style="color:var(--ink-muted)">/</span>
                <span style="color:var(--cat-injected)">${escHtml(t('evError'))} ${evSum.error || 0}</span>
              </div>
            </div>
          </div>

          <!-- 2x2 Detailed Metadata Grid -->
          <div class="dsh-meta-grid">
            <!-- Input / Output -->
            <div class="dsh-meta-block">
              <div class="dsh-meta-head">
                <span>${escHtml(t('ioSummary'))}</span>
                <span class="mono">${ioTotal}</span>
              </div>
              <div class="dsh-meta-pills">
                <button class="dsh-dot-stat" data-jump="user">
                  <span class="legend-swatch" style="background:var(--cat-user)"></span>
                  ${escHtml(t('userInputs'))} <b class="mono">${cs.userInputs || 0}</b>
                </button>
                <button class="dsh-dot-stat" data-jump="file:read">
                  <span class="legend-swatch" style="background:var(--ink-muted)"></span>
                  ${escHtml(t('fRead'))} <b class="mono">${fileOps.read || 0}</b>
                </button>
                <button class="dsh-dot-stat" data-jump="file:written">
                  <span class="legend-swatch" style="background:var(--good)"></span>
                  ${escHtml(t('fWritten'))} <b class="mono">${fileOps.written || 0}</b>
                </button>
                ${(fileOps.searched || 0) > 0 ? `
                  <button class="dsh-dot-stat" data-jump="file:searched">
                    <span class="legend-swatch" style="background:var(--accent)"></span>
                    ${escHtml(t('fSearched'))} <b class="mono">${fileOps.searched}</b>
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- Tool Calls -->
            <div class="dsh-meta-block">
              <div class="dsh-meta-head">
                <span>${escHtml(t('toolCalls'))}</span>
                <span class="mono">${cs.toolCalls || 0}</span>
              </div>
              <div class="dsh-meta-pills">
                ${topTools.length === 0
                  ? `<span class="card-subtitle">${escHtml(t('noRecords'))}</span>`
                  : topTools.slice(0, 2).map((tl, idx) => `
                      <span class="dsh-dot-stat" style="cursor:default">
                        <span class="legend-swatch" style="background:${idx === 0 ? 'var(--cat-tools)' : 'var(--accent)'}"></span>
                        <span class="mono">${escHtml(tl.name)}</span> <b class="mono">${tl.count}</b>
                      </span>
                    `).join('') + (extraToolsCount > 0 ? `<span class="card-subtitle">${escHtml(t('otherTools'))} +${extraToolsCount}</span>` : '')
                }
              </div>
            </div>

            <!-- Command Executions -->
            <div class="dsh-meta-block">
              <div class="dsh-meta-head">
                <span>${escHtml(t('cmdsTitle'))}</span>
                <span class="mono">${cmdTotal}</span>
              </div>
              <div class="dsh-meta-pills">
                ${cmdProgs.length === 0
                  ? `<span class="card-subtitle">${escHtml(t('noRecords'))}</span>`
                  : cmdProgs.slice(0, 3).map(pr => `
                      <button class="dsh-dot-stat" data-jump="commands">
                        <span class="legend-swatch" style="background:var(--cat-tool-def)"></span>
                        <span class="mono">${escHtml(pr.name)}</span> <b class="mono">${pr.count}</b>
                      </button>
                    `).join('')
                }
              </div>
            </div>

            <!-- Model & Billing -->
            <div class="dsh-meta-block">
              <div class="dsh-meta-head">
                <span style="display:inline-flex;align-items:center;gap:5px">
                  ${escHtml(t('modelBilling'))}
                  <span class="hint-badge" title="${escHtml(pricingTitle)}">?</span>
                </span>
                <span class="mono">${escHtml(fmtTokens(ts.billableTotal || 0))} / ${escHtml(fmtCost(cs.cost || 0))}</span>
              </div>
              <div class="dsh-plugin-rows" style="gap:4px">
                <div class="dsh-plugin-row">
                  <span class="dsh-plugin-key">${escHtml(t('currentModel'))}</span>
                  <span class="dsh-plugin-val mono">${escHtml(meta.modelLabel || meta.model)}</span>
                </div>
                <div class="dsh-plugin-row" style="font-size:11px;color:var(--ink-muted)">
                  <span>In ${escHtml(fmtTokens(ts.inputTokens))} · Cache ${escHtml(fmtTokens(ts.cacheReadTokens))}</span>
                  <span class="mono">Out ${escHtml(fmtTokens(ts.outputTokens))}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Plugin Info Card -->
        <div class="card" style="justify-content:space-between">
          <div style="display:flex;flex-direction:column;gap:10px">
            <div class="card-header">
              <span class="card-title">✦ ${escHtml(t('pluginInfo'))}</span>
              <span class="pill" style="font-size:10.5px">Antigravity</span>
            </div>
            <div class="dsh-plugin-rows">
              <div class="dsh-plugin-row">
                <span class="dsh-plugin-key">插件</span>
                <span class="dsh-plugin-val mono">agy-context (v${escHtml(version)})</span>
              </div>
              <div class="dsh-plugin-row">
                <span class="dsh-plugin-key">${isZh ? '工作区' : 'Workspace'}</span>
                <span class="dsh-plugin-val">${escHtml(meta.workspaceName || 'Workspace')}</span>
              </div>
              <div class="dsh-plugin-row">
                <span class="dsh-plugin-key">${escHtml(t('effectiveWindow'))}</span>
                <span class="dsh-plugin-val mono">${escHtml(fmtTokens(meta.contextWindow || 0))}</span>
              </div>
              <div class="dsh-plugin-row">
                <span class="dsh-plugin-key">${escHtml(t('nativeWindow'))}</span>
                <span class="dsh-plugin-val mono">${escHtml(fmtTokens(meta.nativeContextWindow || 0))}</span>
              </div>
              <div class="dsh-plugin-row">
                <span class="dsh-plugin-key">${escHtml(t('pluginSettings'))}</span>
                <button class="btn btn-sm" id="ctx-open-settings" style="font-weight:600">${escHtml(t('openPluginSettings'))}</button>
              </div>
            </div>
            ${fam && fam.agents > 0 ? `
              <button class="dsh-family-cell" data-jump="fleet" title="${escHtml(t('fleetAgentNetworkHint'))}">
                <span class="dsh-family-left">
                  <span class="dsh-family-title">🕸 ${escHtml(t('fleetAgentNetwork'))}</span>
                  <span class="card-subtitle">${fam.agents} ${escHtml(t('fleetAgentCount'))} · ${fam.children} ${escHtml(t('fleetChildCount'))}${fam.running > 0 ? ` · ${fam.running} ${escHtml(t('fleetRunning'))}` : ''}</span>
                </span>
                <span class="dsh-family-val mono">${escHtml(fmtTokens(fam.billableTokens || 0))}<br/>${escHtml(fmtCost(fam.cost || 0))}</span>
              </button>
            ` : ''}
          </div>
          ${callbacks?.onGoInsights ? `
          <div style="border-top:1px solid var(--border);padding-top:9px;display:flex;align-items:center;justify-content:space-between;gap:6px">
            <span class="card-subtitle">${isZh ? '全局跨会话汇总' : 'Cross-session summary'}</span>
            <button class="btn btn-sm" id="ctx-go-insights">${escHtml(t('navInsights'))} →</button>
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Row 2: Token Stats Donut + Timing Stats Donut & Ribbon -->
      <div class="dsh-donut-row">
        <div class="card">
          <div class="card-header">
            <span class="card-title">⛁ ${escHtml(t('tokenStats'))}</span>
            <span class="card-subtitle mono">${escHtml(t('cacheHit'))} ${escHtml(fmtPct(ts.cacheHitRate, 2))}</span>
          </div>
          <div id="ctx-token-donut"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">◷ ${escHtml(t('timingStats'))}</span>
            <span class="card-subtitle mono" style="cursor:help" title="${escHtml(speedTitle)}">${escHtml(t('outputSpeed'))} ${tm.outputTokensPerSec || 0} tok/s</span>
          </div>
          <div id="ctx-timing-donut"></div>
          ${AGY.charts.renderTimingRibbonHtml(timeline?.steps || [], tm.totalActiveMs || 0)}
        </div>
      </div>
    `;

    // Render Token Donut
    const tokHost = container.querySelector('#ctx-token-donut');
    if (tokHost) {
      const b = ts.buckets || {};
      const tokenItems = [
        { label: t('catSystemBase'), color: 'var(--cat-system)', value: b.systemBase || 0, sub: `≈${fmtTokens(b.systemBase || 0)}` },
      { label: t('catToolDefs'), color: 'var(--cat-tool-def)', value: b.toolDefs || 0, sub: `≈${fmtTokens(b.toolDefs || 0)}` },
        { label: t('catTools'), color: 'var(--cat-tools)', value: b.tools || 0, sub: `≈${fmtTokens(b.tools || 0)}` },
        { label: t('catUser'), color: 'var(--cat-user)', value: b.user || 0, sub: `≈${fmtTokens(b.user || 0)}` },
        { label: t('catInjected'), color: 'var(--cat-injected)', value: b.injected || 0, sub: `≈${fmtTokens(b.injected || 0)}` },
        { label: t('catSkills'), color: 'var(--cat-skills)', value: b.skills || 0, sub: `≈${fmtTokens(b.skills || 0)}` },
        { label: t('catThinking'), color: 'var(--cat-thinking)', value: b.thinking || 0, sub: `≈${fmtTokens(b.thinking || 0)}` },
        { label: t('catAssistant'), color: 'var(--cat-assistant)', value: b.assistant || 0, sub: `≈${fmtTokens(b.assistant || 0)}` },
        { label: t('catMedia'), color: 'var(--cat-media)', value: b.media || 0, sub: `≈${fmtTokens(b.media || 0)}` },
        { label: t('catOther'), color: 'var(--cat-other)', value: b.other || 0, sub: `≈${fmtTokens(b.other || 0)}` },
      ];
      AGY.charts.renderDshDonut(tokHost, {
        centerValue: fmtTokens(ts.billableTotal || 0),
        centerLabel: t('totalUsage'),
        items: tokenItems,
      });
    }

    // Render Timing Donut
    const timHost = container.querySelector('#ctx-timing-donut');
    if (timHost) {
      const timesSuffix = isZh ? '次' : ' calls';
      const timingItems = [
        { label: t('modelTime'), color: 'var(--time-model)', value: tm.modelMs || 0, sub: `${fmtDuration(tm.modelMs || 0)} · ${fmtCompactCount(cs.requests || 0)}${timesSuffix}` },
        { label: t('toolTime'), color: 'var(--time-tool)', value: tm.toolMs || 0, sub: `${fmtDuration(tm.toolMs || 0)} · ${fmtCompactCount(cs.toolCalls || 0)}${timesSuffix}` },
        { label: t('overheadTime'), color: 'var(--time-overhead)', value: tm.overheadMs || 0, sub: fmtDuration(tm.overheadMs || 0) },
      ];
      AGY.charts.renderDshDonut(timHost, {
        centerValue: fmtDuration(tm.totalActiveMs || 0),
        centerLabel: t('activeDuration'),
        items: timingItems,
      });
    }

    // Event bindings
    container.querySelectorAll('[data-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-jump');
        callbacks?.onJump?.(target);
      });
    });

    container.querySelector('#ctx-open-settings')?.addEventListener('click', () => {
      callbacks?.onOpenSettings?.();
    });

    container.querySelector('#ctx-go-insights')?.addEventListener('click', () => {
      callbacks?.onGoInsights?.();
    });
  }

  function renderCurrentContext(container, session) {
    const { t, fmtTokens, escHtml } = AGY.i18n;
    const { meta, currentContext } = session;
    const comp = currentContext?.composition || {};
    const usagePct = Number(currentContext?.usagePct || 0);
    const nativeUsagePct = Number(currentContext?.nativeUsagePct || 0);
    const nativeWindow = Number(currentContext?.nativeContextWindow || meta.contextWindow || 0);
    const pctColor = usagePct >= 80 ? 'var(--danger)' : usagePct >= 60 ? 'var(--warn)' : 'var(--ink)';
    const isZh = AGY.i18n.getLang() === 'zh';
    const accessLabel = String(meta.contextSource || '').startsWith('official')
      ? (isZh ? '官方' : 'official')
      : (isZh ? '估算' : 'estimated');

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">◔ ${escHtml(t('currentContext'))}</span>
          <span class="card-subtitle mono">${escHtml(meta.modelLabel || meta.model)}</span>
        </div>
        <div class="dsh-ctx-head-stats">
          <div>
            <span class="dsh-ctx-big">${escHtml(fmtTokens(comp.total || 0))}</span>
            <span class="card-subtitle mono"> / ${escHtml(fmtTokens(currentContext?.contextWindow || 0))} tokens · ${escHtml(t('effectiveWindow'))}</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:5px">
            <span class="dsh-ctx-pct" style="color:${pctColor}">${usagePct.toFixed(1)}%</span>
            <span class="card-subtitle">${escHtml(t('ctxUsedLabel'))}</span>
          </div>
        </div>
        <div class="card-subtitle mono" style="margin-bottom:6px">
          ${escHtml(t('nativeWindow'))} ${escHtml(fmtTokens(nativeWindow))} · ${nativeUsagePct.toFixed(1)}% · ${escHtml(accessLabel)}
        </div>
        ${AGY.charts.renderCompositionBarHtml(comp, {
          contextWindow: currentContext?.contextWindow || 0,
          autocompactReserve: currentContext?.autocompactReserve || 0,
          maxOutput: currentContext?.maxOutput || 0,
        })}
        <div class="legend-row">
          ${AGY.charts.CAT_META.map(c => {
            const val = comp[c.key] || 0;
            const pct = comp.total > 0 ? ((val / comp.total) * 100).toFixed(1) : '0.0';
            return `<span class="legend-item"><span class="legend-swatch" style="background:${c.color}"></span>${escHtml(t(c.i18n))}: <b class="mono">~${escHtml(fmtTokens(val))}</b> <span style="color:var(--ink-muted)">(${pct}%)</span></span>`;
          }).join('')}
          ${(currentContext?.autocompactReserve || 0) > 0 ? `<span class="legend-item"><span class="legend-swatch" style="background:var(--reserve-stripe);border:1px solid var(--border)"></span>${escHtml(t('autocompactReserve'))}: <span class="mono">${escHtml(fmtTokens(currentContext?.autocompactReserve || 0))}</span></span>` : ''}
          <span class="legend-item"><span class="legend-swatch" style="background:var(--output-stripe);border:1px solid var(--border)"></span>${escHtml(t('outputReserve'))}: <span class="mono">${escHtml(fmtTokens(currentContext?.maxOutput || 0))}</span></span>
        </div>
      </div>
    `;
  }

  AGY.views = AGY.views || {};
  AGY.views.stats = { render: renderStats, renderCurrentContext };
})(window);
