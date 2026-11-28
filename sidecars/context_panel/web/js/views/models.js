(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function fmtCacheRatePct(rate) {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—';
    return `${Math.max(0, Math.min(100, rate * 100)).toFixed(1)}%`;
  }

  function poolLabel(pool, t) {
    if (pool === 'gemini') return t('poolGemini');
    if (pool === 'premium') return t('poolPremium');
    return '';
  }

  function renderModels(container, modelUsage, state, callbacks) {
    const { t, fmtTokens, fmtCost, escHtml, getLang } = AGY.i18n;
    const isZh = getLang() === 'zh';
    const split = modelUsage?.orchestratorSplit || null;
    const byModel = Array.isArray(modelUsage?.byModel) ? modelUsage.byModel : [];
    const compaction = modelUsage?.compaction || null;

    if (!split && byModel.length === 0 && !compaction) {
      container.innerHTML = '';
      return;
    }

    let isCollapsed = Boolean(state?.collapsed);
    let bodyBuilt = !isCollapsed;
    const branchIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 11 15.5"/><path d="M15.5 7.5 13 15.5"/></svg>`;

    let titleHtml = '';
    let metaPillsHtml = '';
    let buildBodyHtml = () => '';

    const renderCompactionRow = (comp, prefixLabel) => {
      if (!comp || !(comp.calls > 0)) return '';
      const labels = isZh ? comp.labelsZh : comp.labelsEn;
      const modelHint = Array.isArray(labels) && labels.length > 0 ? ` · ${labels.join(' / ')}` : '';
      const titleText = `${t('orchRoleCompactionName')}${modelHint}`;
      return `
        <div class="orch-split-row">
          <div class="orch-split-row-main">
            <span class="orch-role-badge is-compaction">${escHtml(prefixLabel)}</span>
            <span class="orch-split-model" title="${escHtml(titleText)}">${escHtml(titleText)}</span>
          </div>
          <div class="orch-split-row-metrics">
            <span class="orch-split-metric">${Number(comp.calls) || 0} ${escHtml(t('modelCallsUnit'))}</span>
            <span class="orch-split-metric">${escHtml(fmtTokens(comp.totalTokens || 0))} tok</span>
            <span class="orch-split-metric">${escHtml(t('modelCacheShort'))} ${escHtml(fmtCacheRatePct(comp.cacheHitRate))}</span>
            <span class="orch-split-metric is-cost">${escHtml(fmtCost(comp.cost || 0))}</span>
          </div>
        </div>
      `;
    };

    if (split) {
      const orch = split.orchestrator || {};
      const exec = split.executor || {};
      const direct = split.direct?.calls > 0 ? split.direct : null;
      const comp = split.compaction?.calls > 0 ? split.compaction : compaction;

      const pills = [];
      if (split.isSameModelOrchestrated) {
        pills.push(`<span class="orch-split-meta-pill">${escHtml(t('orchSameModel'))}</span>`);
      }
      if (split.hasMidConversationReconfig) {
        pills.push(`<span class="orch-split-meta-pill">${escHtml(t('orchReconfigured'))}</span>`);
      }
      if (split.isCrossPool) {
        pills.push(`<span class="orch-split-meta-pill">${escHtml(t('orchCrossPool'))}</span>`);
      }
      pills.push(`<span class="orch-split-meta-pill is-total">${escHtml(fmtCost(split.totalCost))}</span>`);

      titleHtml = `${branchIcon}<span class="card-title">${escHtml(t('orchVsExecTitle'))}</span>`;
      metaPillsHtml = pills.join('');
      buildBodyHtml = () => {
        const barEntries = [
          { cls: 'orch-split-bar-orch', cost: orch.cost || 0, tok: orch.totalTokens || 0 },
          { cls: 'orch-split-bar-exec', cost: exec.cost || 0, tok: exec.totalTokens || 0 },
          ...(direct ? [{ cls: 'orch-split-bar-direct', cost: direct.cost || 0, tok: direct.totalTokens || 0 }] : []),
          ...(comp ? [{ cls: 'orch-split-bar-compaction', cost: comp.cost || 0, tok: comp.totalTokens || 0 }] : []),
        ];
        const useCostWeight = barEntries.some(e => e.cost > 0);
        const totalWeight = barEntries.reduce((acc, e) => acc + (useCostWeight ? e.cost : e.tok), 0);

        const renderRoleRow = (roleKey, badgeText, metrics) => {
          const labels = isZh ? metrics.labelsZh : metrics.labelsEn;
          const primary = isZh ? metrics.primaryLabelZh : metrics.primaryLabelEn;
          const modelLabel = Array.isArray(labels) && labels.length > 1
            ? labels.join(' / ')
            : (primary || '—');
          return `
            <div class="orch-split-row">
              <div class="orch-split-row-main">
                <span class="orch-role-badge is-${roleKey}">${escHtml(badgeText)}</span>
                <span class="orch-split-model" title="${escHtml(modelLabel)}">${escHtml(modelLabel)}</span>
              </div>
              <div class="orch-split-row-metrics">
                <span class="orch-split-metric">${Number(metrics.calls) || 0} ${escHtml(t('modelCallsUnit'))}</span>
                <span class="orch-split-metric">${escHtml(fmtTokens(metrics.totalTokens || 0))} tok</span>
                <span class="orch-split-metric">${escHtml(t('modelCacheShort'))} ${escHtml(fmtCacheRatePct(metrics.cacheHitRate))}</span>
                <span class="orch-split-metric is-cost">${escHtml(fmtCost(metrics.cost || 0))}</span>
              </div>
            </div>
          `;
        };

        const coldBannerHtml = split.coldCacheSwitchCount > 0
          ? `
            <div class="orch-cold-note">
              <span class="orch-cold-switch-pill">${escHtml(t('callsSwitchCold'))} ×${split.coldCacheSwitchCount}</span>
              <span>${escHtml(t('orchColdSwitchDesc').replace('{tokens}', fmtTokens(split.coldCacheSwitchInputTokens || 0)))}</span>
            </div>
          `
          : '';

        return `
          <div class="orch-split-bar" aria-hidden="true">
            ${barEntries.map((e) => {
              const w = totalWeight > 0 ? ((useCostWeight ? e.cost : e.tok) / totalWeight) * 100 : 0;
              return w > 0 ? `<span class="${e.cls}" style="width:${Math.max(1.5, w).toFixed(2)}%"></span>` : '';
            }).join('')}
          </div>
          <div class="orch-split-rows">
            ${renderRoleRow('orchestrator', t('orchRolePlanner'), orch)}
            ${renderRoleRow('executor', t('orchRoleExecutor'), exec)}
            ${direct ? renderRoleRow('direct', t('orchRoleDirect'), direct) : ''}
            ${comp ? renderCompactionRow(comp, t('orchRoleCompaction')) : ''}
          </div>
          ${coldBannerHtml}
        `;
      };
    } else {
      const byModelCost = byModel.reduce((acc, row) => acc + (Number(row.cost) || 0), 0) + (compaction?.cost || 0);
      const totalCost = Number.isFinite(modelUsage?.totalCost) ? modelUsage.totalCost : byModelCost;

      titleHtml = `<span class="card-title">◈ ${escHtml(t('modelUsageTitle'))}</span><span class="pill mono">${byModel.length}</span>`;
      metaPillsHtml = `<span class="orch-split-meta-pill is-total">${escHtml(fmtCost(totalCost))}</span>`;
      buildBodyHtml = () => {
        const barItems = [
          ...byModel.map(r => ({ cost: Number(r.cost) || 0, tok: Number(r.totalTokens) || 0, isCompaction: false })),
          ...(compaction?.calls > 0 ? [{ cost: Number(compaction.cost) || 0, tok: Number(compaction.totalTokens) || 0, isCompaction: true }] : []),
        ];
        const totalWeight = barItems.reduce((acc, r) => acc + (totalCost > 0 ? r.cost : r.tok), 0);
        const barColors = ['var(--accent)', 'var(--good)', 'var(--cat-tool-def)', 'var(--cat-injected)', 'var(--cat-skills)'];

        const barHtml = barItems.length > 1 && totalWeight > 0
          ? `<div class="orch-split-bar" aria-hidden="true">${barItems.map((item, idx) => {
              const w = ((totalCost > 0 ? item.cost : item.tok) / totalWeight) * 100;
              const bg = item.isCompaction ? 'var(--warn)' : barColors[idx % barColors.length];
              return w > 0 ? `<span style="width:${Math.max(1.5, w).toFixed(2)}%;background:${bg};height:100%"></span>` : '';
            }).join('')}</div>`
          : '';

        return `
          ${barHtml}
          <div class="orch-split-rows">
            ${byModel.map((row) => {
              const name = (isZh ? row.labelZh : row.labelEn) || row.model || '—';
              const poolText = poolLabel(row.quotaPool, t);
              return `
                <div class="orch-split-row">
                  <div class="orch-split-row-main">
                    ${poolText ? `<span class="orch-pool-tag">${escHtml(poolText)}</span>` : ''}
                    <span class="orch-split-model" title="${escHtml(`${name} (${row.model})`) }">${escHtml(name)}</span>
                  </div>
                  <div class="orch-split-row-metrics">
                    <span class="orch-split-metric">${Number(row.calls) || 0} ${escHtml(t('modelCallsUnit'))}</span>
                    <span class="orch-split-metric">${escHtml(fmtTokens(row.totalTokens || 0))} tok</span>
                    <span class="orch-split-metric">${escHtml(t('modelCacheShort'))} ${escHtml(fmtCacheRatePct(row.cacheHitRate))}</span>
                    <span class="orch-split-metric is-cost">${escHtml(fmtCost(row.cost || 0))}</span>
                  </div>
                </div>
              `;
            }).join('')}
            ${compaction?.calls > 0 ? renderCompactionRow(compaction, t('orchRoleCompaction')) : ''}
          </div>
        `;
      };
    }

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="calls-fold-btn" id="models-toggle" type="button" aria-expanded="${!isCollapsed}">
              <span class="calls-chevron">${isCollapsed ? '▸' : '▾'}</span>
              ${titleHtml}
            </button>
          </div>
          <div class="orch-split-meta">
            ${metaPillsHtml}
            <button class="btn btn-sm" id="models-fold-action" type="button">${escHtml(isCollapsed ? t('callsExpand') : t('callsCollapse'))}</button>
          </div>
        </div>
        <div class="models-body"${isCollapsed ? ' hidden' : ''}>
          ${bodyBuilt ? buildBodyHtml() : ''}
        </div>
      </div>
    `;

    const toggleHandler = () => {
      isCollapsed = !isCollapsed;
      const bodyEl = container.querySelector('.models-body');
      const chevEl = container.querySelector('#models-toggle .calls-chevron');
      const foldBtn = container.querySelector('#models-toggle');
      const actionBtn = container.querySelector('#models-fold-action');
      if (!isCollapsed && !bodyBuilt && bodyEl) {
        bodyBuilt = true;
        bodyEl.innerHTML = buildBodyHtml();
      }
      if (bodyEl) bodyEl.hidden = isCollapsed;
      if (chevEl) chevEl.textContent = isCollapsed ? '▸' : '▾';
      if (foldBtn) foldBtn.setAttribute('aria-expanded', String(!isCollapsed));
      if (actionBtn) actionBtn.textContent = isCollapsed ? t('callsExpand') : t('callsCollapse');
      callbacks?.onToggleCollapse?.(isCollapsed, { silent: true });
    };
    container.querySelector('#models-toggle')?.addEventListener('click', toggleHandler);
    container.querySelector('#models-fold-action')?.addEventListener('click', toggleHandler);
  }

  AGY.views = AGY.views || {};
  AGY.views.models = { render: renderModels };
})(window);
