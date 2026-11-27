(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function renderSettingsDrawer(container, prefs, isOpen, callbacks) {
    const { t, escHtml } = AGY.i18n;
    container.className = `drawer-backdrop ${isOpen ? 'open' : ''}`;
    if (!isOpen) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="drawer-panel" id="settings-drawer-panel">
        <div class="card-header">
          <span class="card-title">${escHtml(t('settingsTitle'))}</span>
          <button class="btn btn-sm" id="pref-close">${escHtml(t('close'))}</button>
        </div>

        <div class="setting-row">
          <span>${escHtml(t('prefLang'))}</span>
          <select class="select" data-pref="lang">
            <option value="zh" ${prefs.lang === 'zh' ? 'selected' : ''}>简体中文</option>
            <option value="en" ${prefs.lang === 'en' ? 'selected' : ''}>English</option>
          </select>
        </div>

        <div class="setting-row">
          <span>${escHtml(t('prefRange'))}</span>
          <select class="select" data-pref="insightsRange">
            <option value="today" ${prefs.insightsRange === 'today' ? 'selected' : ''}>${escHtml(t('rangeToday'))}</option>
            <option value="weekly_quota" ${prefs.insightsRange === 'weekly_quota' ? 'selected' : ''}>${escHtml(t('rangeWeeklyQuota'))}</option>
            <option value="7d" ${prefs.insightsRange === '7d' ? 'selected' : ''}>${escHtml(t('range7d'))}</option>
            <option value="30d" ${prefs.insightsRange === '30d' ? 'selected' : ''}>${escHtml(t('range30d'))}</option>
            <option value="all" ${prefs.insightsRange === 'all' ? 'selected' : ''}>${escHtml(t('rangeAll'))}</option>
          </select>
        </div>

        <div class="setting-row">
          <span>${escHtml(t('prefGran'))}</span>
          <select class="select" data-pref="timelineGranularity">
            <option value="step" ${prefs.timelineGranularity === 'step' ? 'selected' : ''}>${escHtml(t('granStep'))}</option>
            <option value="turn" ${prefs.timelineGranularity === 'turn' ? 'selected' : ''}>${escHtml(t('granTurn'))}</option>
          </select>
        </div>

        <div class="setting-row">
          <span>${escHtml(t('prefMode'))}</span>
          <select class="select" data-pref="timelineMode">
            <option value="total" ${prefs.timelineMode === 'total' ? 'selected' : ''}>${escHtml(t('modeTotal'))}</option>
            <option value="delta" ${prefs.timelineMode === 'delta' ? 'selected' : ''}>${escHtml(t('modeDelta'))}</option>
            <option value="overview" ${prefs.timelineMode === 'overview' ? 'selected' : ''}>${escHtml(t('modeOverview'))}</option>
          </select>
        </div>

        <div class="setting-row">
          <span>${escHtml(t('prefBaseline'))}</span>
          <select class="select" data-pref="browserBaseline">
            <option value="prev_turn" ${prefs.browserBaseline === 'prev_turn' ? 'selected' : ''}>${escHtml(t('baselinePrevTurn'))}</option>
            <option value="prev_step" ${prefs.browserBaseline === 'prev_step' ? 'selected' : ''}>${escHtml(t('baselinePrevStep'))}</option>
          </select>
        </div>

        <div class="setting-row">
          <span>${escHtml(t('prefFleetTab'))}</span>
          <select class="select" data-pref="fleetTab">
            <option value="show" ${prefs.fleetTab !== 'hide' ? 'selected' : ''}>${escHtml(t('fleetShowTab'))}</option>
            <option value="hide" ${prefs.fleetTab === 'hide' ? 'selected' : ''}>${escHtml(t('fleetHideTab'))}</option>
          </select>
        </div>
      </div>
    `;

    container.onclick = (ev) => {
      if (ev.target === container) callbacks?.onClose?.();
    };
    const closeBtn = container.querySelector('#pref-close');
    if (closeBtn) closeBtn.addEventListener('click', () => callbacks?.onClose?.());

    container.querySelectorAll('[data-pref]').forEach(sel => {
      sel.addEventListener('change', () => {
        callbacks?.onSavePref?.({ [sel.getAttribute('data-pref')]: sel.value });
      });
    });
  }

  AGY.views = AGY.views || {};
  AGY.views.settings = { render: renderSettingsDrawer };
})(window);
