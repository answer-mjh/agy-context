(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const EV_META = {
    injection: { i18n: 'evInjection', cls: 'pill-warn' },
    compaction: { i18n: 'evCompaction', cls: 'pill-good' },
    skill: { i18n: 'evSkill', cls: 'pill-accent' },
    model_switch: { i18n: 'evModel', cls: 'pill-accent' },
    error: { i18n: 'evError', cls: 'pill-danger' },
  };

  function renderEvents(container, events, state, callbacks) {
    const { t, fmtSignedTokens, fmtClock, escHtml } = AGY.i18n;
    const all = events || [];
    const activeType = state.type || 'all';

    const counts = { all: all.length, injection: 0, compaction: 0, skill: 0, model_switch: 0, error: 0 };
    for (const ev of all) {
      if (counts[ev.type] !== undefined) counts[ev.type]++;
    }

    const filtered = activeType === 'all' ? all : all.filter(ev => ev.type === activeType);

    const tabs = [
      { key: 'all', label: t('evAll') },
      { key: 'injection', label: t('evInjection') },
      { key: 'compaction', label: t('evCompaction') },
      { key: 'skill', label: t('evSkill') },
      { key: 'model_switch', label: t('evModel') },
      { key: 'error', label: t('evError') },
    ];

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escHtml(t('eventsTitle'))} <span class="pill mono">${all.length}</span></span>
          <div class="filter-bar">
            ${tabs.map(tb => `
              <button class="pill pill-btn ${activeType === tb.key ? 'active' : ''}" data-evtype="${tb.key}">
                ${escHtml(tb.label)} (${counts[tb.key] || 0})
              </button>
            `).join('')}
          </div>
        </div>
        ${filtered.length === 0
          ? `<div class="empty-state">${escHtml(t('noEvents'))}</div>`
          : `<div class="list-scroll">
              ${filtered.map(ev => {
                const em = EV_META[ev.type] || { i18n: 'evInjection', cls: '' };
                const deltaCls = ev.tokenDelta < 0 ? 'delta-neg' : ev.tokenDelta > 0 ? 'delta-pos' : 'delta-zero';
                return `
                  <div class="row-item" style="cursor:pointer" data-ev-seq="${ev.plannerSeq}">
                    <div class="row-head">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <span class="pill ${em.cls}">${escHtml(t(em.i18n))}</span>
                        <span style="font-weight:600;font-size:12px">${escHtml(ev.label)}</span>
                        <span class="pill mono" style="font-size:10px">${escHtml(ev.source)}</span>
                      </div>
                      <div style="display:flex;align-items:center;gap:8px">
                        ${ev.tokenDelta ? `<span class="${deltaCls} mono">${escHtml(fmtSignedTokens(ev.tokenDelta))} tok</span>` : ''}
                        <span class="pill mono" style="font-size:10px">T${ev.turnIndex} · S${ev.stepIndex}</span>
                        <span class="card-subtitle mono">${escHtml(fmtClock(ev.createdAt))}</span>
                      </div>
                    </div>
                    ${ev.detail ? `<div class="card-subtitle mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ev.detail)}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>`
        }
      </div>
    `;

    container.querySelectorAll('[data-evtype]').forEach(btn => {
      btn.addEventListener('click', () => callbacks?.onChangeType?.(btn.getAttribute('data-evtype')));
    });
    container.querySelectorAll('[data-ev-seq]').forEach(row => {
      row.addEventListener('click', () => callbacks?.onJumpSeq?.(Number(row.getAttribute('data-ev-seq'))));
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.events = { render: renderEvents };
})(window);
