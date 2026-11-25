(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  function getSidecarApi() {
    return (typeof window.sidecar === 'object' && window.sidecar !== null)
      ? window.sidecar
      : null;
  }

  function parseColorRgb(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim().toLowerCase();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex) {
      const h = hex[1];
      if (h.length === 3) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
      }
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const rgb = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)/);
    if (rgb) return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
    return null;
  }

  function luminance(rgb) {
    if (!rgb) return null;
    const [r, g, b] = rgb.map(v => {
      const n = Math.max(0, Math.min(255, v)) / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function detectTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches) {
      return 'hc';
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const hostBg = rootStyle.getPropertyValue('--background').trim();
    const lum = luminance(parseColorRgb(hostBg));
    if (lum !== null) {
      return lum > 0.45 ? 'light' : 'dark';
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function applyTheme(explicit) {
    const mode = explicit === 'light' || explicit === 'dark' || explicit === 'hc'
      ? explicit
      : detectTheme();
    document.body.setAttribute('data-theme', mode);
  }

  let pushedConversationId = '';
  const conversationListeners = new Set();

  function notifyConversationChange(nextId) {
    const clean = typeof nextId === 'string' ? nextId.trim() : '';
    if (!clean || clean === pushedConversationId) return;
    pushedConversationId = clean;
    for (const fn of conversationListeners) {
      try { fn(clean); } catch { /* ignore */ }
    }
  }

  function initThemeSync() {
    applyTheme();
    window.addEventListener('message', (ev) => {
      const data = ev && ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'theme-change' || data.command === 'theme-change') {
        const vars = (data.payload && data.payload.cssVariables) || data.vars;
        if (vars && typeof vars === 'object') {
          for (const [k, v] of Object.entries(vars)) {
            if (typeof k === 'string' && k.startsWith('--') && typeof v === 'string') {
              document.documentElement.style.setProperty(k, v);
            }
          }
        }
        const explicit = data.theme === 'light' || data.theme === 'dark' || data.theme === 'hc'
          ? data.theme
          : undefined;
        setTimeout(() => applyTheme(explicit), 15);
      } else if (
        data.type === 'conversation-change' ||
        data.type === 'active-conversation' ||
        data.command === 'conversation-change'
      ) {
        const nextId =
          data.conversationId ||
          data.cascadeId ||
          data.payload?.conversationId ||
          data.payload?.cascadeId ||
          '';
        if (nextId) notifyConversationChange(nextId);
      }
    });

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      if (mq.addEventListener) mq.addEventListener('change', () => applyTheme());
    }
  }

  function getHostConversationId() {
    const params = new URLSearchParams(window.location.search || '');
    const urlConversationId =
      params.get('conversationId') ||
      params.get('conversation_id') ||
      params.get('cascadeId') ||
      '';
    if (urlConversationId && urlConversationId.trim()) {
      return urlConversationId.trim();
    }
    const sidecarApi = getSidecarApi();
    if (sidecarApi && typeof sidecarApi.conversationId === 'string' && sidecarApi.conversationId.trim()) {
      return sidecarApi.conversationId.trim();
    }
    if (pushedConversationId) {
      return pushedConversationId;
    }
    return '';
  }

  function onConversationChange(listener) {
    if (typeof listener !== 'function') return () => {};
    conversationListeners.add(listener);
    return () => conversationListeners.delete(listener);
  }

  async function apiFetch(url, options) {
    const opts = options || {};
    const sidecarApi = getSidecarApi();
    if (sidecarApi && typeof sidecarApi.fetch === 'function') {
      const res = await sidecarApi.fetch(url, opts);
      if (res && typeof res.json === 'function') {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }
      return res;
    }
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await window.fetch(url, Object.assign({}, opts, { headers }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function copyText(text) {
    const value = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  // Global floating tooltip helper
  let tooltipEl = null;
  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chart-tooltip';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function showTooltip(event, html) {
    const el = ensureTooltip();
    el.innerHTML = html;
    el.style.display = 'block';
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    let x = (event.clientX || 0) + pad;
    let y = (event.clientY || 0) + pad;
    if (x + rect.width > vw - 8) x = Math.max(8, (event.clientX || 0) - rect.width - pad);
    if (y + rect.height > vh - 8) y = Math.max(8, (event.clientY || 0) - rect.height - pad);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  AGY.bridge = {
    initThemeSync,
    applyTheme,
    getHostConversationId,
    onConversationChange,
    apiFetch,
    copyText,
    showTooltip,
    hideTooltip,
  };
})(window);
