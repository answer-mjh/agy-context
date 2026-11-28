(function (global) {
  const AGY = (global.AGY_CTX = global.AGY_CTX || {});

  const CAT_META = [
    { key: 'systemBase', i18n: 'catSystemBase', color: 'var(--cat-system)' },
    { key: 'toolDefs', i18n: 'catToolDefs', color: 'var(--cat-tool-def)' },
    { key: 'user', i18n: 'catUser', color: 'var(--cat-user)' },
    { key: 'injected', i18n: 'catInjected', color: 'var(--cat-injected)' },
    { key: 'skills', i18n: 'catSkills', color: 'var(--cat-skills)' },
    { key: 'assistant', i18n: 'catAssistant', color: 'var(--cat-assistant)' },
    { key: 'tools', i18n: 'catTools', color: 'var(--cat-tools)' },
    { key: 'media', i18n: 'catMedia', color: 'var(--cat-media)' },
    { key: 'other', i18n: 'catOther', color: 'var(--cat-other)' },
  ];

  const FLAG_ICONS = {
    compaction: { symbol: '⚡', color: '#34d399', i18n: 'flagCompaction' },
    skill: { symbol: '◆', color: '#a78bfa', i18n: 'flagSkill' },
    model_switch: { symbol: '⇄', color: '#38bdf8', i18n: 'flagModel' },
    error: { symbol: '!', color: '#f87171', i18n: 'flagError' },
    slowest: { symbol: '◷', color: '#fbbf24', i18n: 'flagSlowest' },
    largest_growth: { symbol: '▲', color: '#fb923c', i18n: 'flagGrowth' },
  };

  function renderCompositionBarHtml(comp, options = {}) {
    const { contextWindow = 0, autocompactReserve = 0, maxOutput = 0, mini = false } = options;
    const total = comp?.total || 0;
    const denom = contextWindow > 0 ? Math.max(contextWindow, total) : Math.max(1, total);

    const segs = [];
    for (const c of CAT_META) {
      const val = Math.max(0, comp?.[c.key] || 0);
      if (val <= 0) continue;
      const pct = (val / denom) * 100;
      segs.push(
        `<div class="comp-seg" style="width:${pct.toFixed(3)}%;background:${c.color}" title="${AGY.i18n.t(c.i18n)}: ~${AGY.i18n.fmtTokens(val)}"></div>`
      );
    }

    if (!mini && contextWindow > 0) {
      const reserveTotal = Math.min(contextWindow, autocompactReserve + maxOutput);
      const usedPct = (total / denom) * 100;
      const freePct = Math.max(0, 100 - usedPct - (reserveTotal / denom) * 100);
      const acPct = (Math.max(0, autocompactReserve) / denom) * 100;
      const outPct = (Math.max(0, maxOutput) / denom) * 100;
      if (freePct > 0.1) {
        segs.push(`<div class="comp-seg" style="width:${freePct.toFixed(3)}%;background:transparent"></div>`);
      }
      if (acPct > 0.1) {
        segs.push(`<div class="comp-seg reserve" style="width:${acPct.toFixed(3)}%" title="${AGY.i18n.t('autocompactReserve')}: ${AGY.i18n.fmtTokens(autocompactReserve)}"></div>`);
      }
      if (outPct > 0.1) {
        segs.push(`<div class="comp-seg output-reserve" style="width:${outPct.toFixed(3)}%" title="${AGY.i18n.t('outputReserve')}: ${AGY.i18n.fmtTokens(maxOutput)}"></div>`);
      }
    }

    return `<div class="comp-bar-track ${mini ? 'mini' : ''}">${segs.join('')}</div>`;
  }

  /**
   * 7-Day Paired Bar Chart (DSH style: Tokens blue + Est. Cost green)
   */
  function renderSevenDayChart(container, days) {
    const { fmtTokens, fmtCost, escHtml } = AGY.i18n;
    const W = 420;
    const H = 200;
    const padL = 44;
    const padR = 14;
    const padT = 16;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxTok = Math.max(1, ...days.map(d => d.tokens || 0));
    const maxCost = Math.max(0.0001, ...days.map(d => d.cost || 0));
    const hasCost = days.some(d => (d.cost || 0) > 0);
    const slotW = plotW / Math.max(1, days.length);
    const barW = hasCost ? Math.min(13, Math.max(7, slotW * 0.26)) : Math.min(18, Math.max(10, slotW * 0.36));

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block">`;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      const val = maxTok * (1 - i / 4);
      const tokLabel = i === 4 ? '0' : fmtTokens(val);
      svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="${i === 4 ? '0' : '2,3'}"/>`;
      svg += `<text x="${padL - 7}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)">${escHtml(tokLabel)}</text>`;
    }

    days.forEach((d, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const tokH = Math.max(d.tokens > 0 ? 3 : 0, (d.tokens / maxTok) * plotH);
      const costH = Math.max(d.cost > 0 ? 3 : 0, (d.cost / maxCost) * plotH);
      const label = d.date.slice(5);
      svg += `<g class="c7-group" data-idx="${idx}" style="cursor:pointer">`;
      if (hasCost) {
        svg += `<rect x="${cx - barW - 1.5}" y="${padT + plotH - tokH}" width="${barW}" height="${tokH}" rx="4" fill="var(--bar-token)"/>`;
        svg += `<rect x="${cx + 1.5}" y="${padT + plotH - costH}" width="${barW}" height="${costH}" rx="4" fill="var(--bar-cost)"/>`;
      } else {
        svg += `<rect x="${cx - barW / 2}" y="${padT + plotH - tokH}" width="${barW}" height="${tokH}" rx="4" fill="var(--bar-token)"/>`;
      }
      svg += `<rect x="${cx - slotW / 2}" y="${padT}" width="${slotW}" height="${plotH}" fill="transparent"/>`;
      if (days.length <= 7 || idx % 2 === 0) {
        svg += `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">${escHtml(label)}</text>`;
      }
      svg += `</g>`;
    });
    svg += `</svg>`;
    container.innerHTML = svg;

    container.querySelectorAll('.c7-group').forEach(g => {
      const idx = Number(g.getAttribute('data-idx'));
      const d = days[idx];
      g.addEventListener('mousemove', (ev) => {
        AGY.bridge.showTooltip(
          ev,
          `<div style="font-weight:600;margin-bottom:3px">${escHtml(d.date)}</div>` +
          `<div>Tokens: <b>${escHtml(fmtTokens(d.tokens))}</b></div>` +
          `<div>Cost: <b>${escHtml(fmtCost(d.cost))}</b></div>` +
          `<div>Requests: <b>${d.requests}</b></div>`
        );
      });
      g.addEventListener('mouseleave', () => AGY.bridge.hideTooltip());
    });
  }

  /**
   * 8-Week (56-day) Activity Heatmap (DSH style: supports 'tokens' | 'sessions' metric)
   */
  function renderHeatmap56(container, cells, selectedDay, onSelectDay, metric = 'tokens') {
    const { fmtTokens, fmtCost, getLang, escHtml } = AGY.i18n;
    const isSessions = metric === 'sessions';
    const valOf = (c) => (isSessions ? (c.sessions || 0) : (c.tokens || 0));
    const maxVal = Math.max(1, ...cells.map(valOf));
    const cols = 8;
    const rows = 7;
    const cellSize = 20;
    const gap = 5;
    const padL = 8;
    const padT = 20;
    const W = padL + cols * (cellSize + gap) + 6;
    const H = padT + rows * (cellSize + gap) + 4;

    const levelColor = (v) => {
      if (!v || v <= 0) return 'var(--heat-0)';
      const r = v / maxVal;
      if (r < 0.25) return 'var(--heat-1)';
      if (r < 0.5) return 'var(--heat-2)';
      if (r < 0.75) return 'var(--heat-3)';
      return 'var(--heat-4)';
    };

    const fmtMonth = (dateStr) => {
      const m = Number(String(dateStr || '').slice(5, 7));
      if (!m) return '';
      if (getLang() === 'zh') return `${m}月`;
      return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || '';
    };

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:255px;margin:0 auto;display:block">`;
    let lastMonth = '';
    cells.forEach((c, idx) => {
      const col = Math.floor(idx / 7);
      const row = idx % 7;
      const x = padL + col * (cellSize + gap);
      const y = padT + row * (cellSize + gap);
      if (row === 0) {
        const mLabel = fmtMonth(c.date);
        if (mLabel && mLabel !== lastMonth) {
          svg += `<text x="${x}" y="12" font-size="10.5" fill="var(--ink-muted)">${escHtml(mLabel)}</text>`;
          lastMonth = mLabel;
        }
      }
      const isSelected = selectedDay && selectedDay === c.date;
      const stroke = isSelected ? 'var(--ink)' : 'transparent';
      const sw = isSelected ? 2 : 0;
      svg += `<rect class="hm-cell" data-idx="${idx}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="4" fill="${levelColor(valOf(c))}" stroke="${stroke}" stroke-width="${sw}" style="cursor:pointer"/>`;
    });
    svg += `</svg>`;
    container.innerHTML = svg;

    container.querySelectorAll('.hm-cell').forEach(rect => {
      const idx = Number(rect.getAttribute('data-idx'));
      const c = cells[idx];
      rect.addEventListener('mousemove', (ev) => {
        AGY.bridge.showTooltip(
          ev,
          `<div style="font-weight:600;margin-bottom:3px">${escHtml(c.date)}</div>` +
          `<div>Tokens: <b>${escHtml(fmtTokens(c.tokens))}</b></div>` +
          `<div>Cost: <b>${escHtml(fmtCost(c.cost))}</b></div>` +
          `<div>Sessions: <b>${c.sessions}</b> · Req: <b>${c.requests}</b></div>`
        );
      });
      rect.addEventListener('mouseleave', () => AGY.bridge.hideTooltip());
      rect.addEventListener('click', () => {
        if (onSelectDay) onSelectDay(selectedDay === c.date ? '' : c.date);
      });
    });
  }

  /**
   * DSH-Style Rich Donut Chart (thick ring + 2-column dot/subtext/percentage legend)
   */
  function renderDshDonut(container, { centerValue, centerLabel, items, total }) {
    const { escHtml, t } = AGY.i18n;
    const list = items || [];
    const sum = total > 0 ? total : list.reduce((s, it) => s + Math.max(0, it.value || 0), 0);
    const size = 128;
    const r = 46;
    const cx = size / 2;
    const cy = size / 2;
    const circ = 2 * Math.PI * r;
    let offset = 0;

    let arcs = '';
    if (sum > 0) {
      for (const it of list) {
        const val = Math.max(0, it.value || 0);
        if (val <= 0) continue;
        const frac = val / sum;
        const dash = Math.max(1.2, frac * circ);
        arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="15" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${escHtml(it.label)}: ${escHtml(it.sub || '')} (${(frac * 100).toFixed(1)}%)</title></circle>`;
        offset += dash;
      }
    }

    const legendHtml = list.map(it => {
      const pctNum = sum > 0 ? (Math.max(0, it.value || 0) / sum) * 100 : 0;
      const pctText = pctNum > 0 && pctNum < 0.1 ? '<0.1%' : `${pctNum.toFixed(1)}%`;
      return `
        <div class="dsh-dl-item">
          <div class="dsh-dl-left">
            <span class="dsh-dl-dot" style="background:${it.color}"></span>
            <div class="dsh-dl-text">
              <span class="dsh-dl-name">${escHtml(it.label)}</span>
              <span class="dsh-dl-sub">${escHtml(it.sub || '—')}</span>
            </div>
          </div>
          <span class="dsh-dl-pct">${escHtml(pctText)}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="dsh-donut-body">
        <div class="dsh-donut-svg-wrap">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-well)" stroke-width="15"/>
            ${arcs}
            <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--ink)">${escHtml(centerValue || '0')}</text>
            <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10.5" fill="var(--ink-muted)">${escHtml(centerLabel || '')}</text>
          </svg>
        </div>
        <div class="dsh-donut-legend">${legendHtml || `<div class="empty-state" style="padding:12px">${escHtml(t('noData'))}</div>`}</div>
      </div>
    `;
  }

  /**
   * DSH-Style Horizontal Step-Timing Ribbon beneath Session Timing Donut
   */
  function renderTimingRibbonHtml(steps, totalActiveMs) {
    const { fmtDuration, escHtml } = AGY.i18n;
    const list = steps || [];
    let segments = [];
    if (list.length > 120) {
      const bucketCount = 120;
      for (let b = 0; b < bucketCount; b++) {
        const start = Math.floor((b * list.length) / bucketCount);
        const end = Math.floor(((b + 1) * list.length) / bucketCount);
        if (end <= start) continue;
        let dur = 0;
        for (let k = start; k < end; k++) {
          dur += Math.max(1, list[k].durationMs || 0);
        }
        const firstSeq = list[start].seq + 1;
        const lastSeq = list[end - 1].seq + 1;
        segments.push({
          label: firstSeq === lastSeq ? `#${firstSeq}` : `#${firstSeq}–#${lastSeq}`,
          durationMs: dur,
        });
      }
    } else {
      segments = list.map(s => ({ label: `#${s.seq + 1}`, durationMs: s.durationMs || 0 }));
    }
    const totalDur = Math.max(1, segments.reduce((s, x) => s + Math.max(1, x.durationMs || 0), 0));
    const palette = ['var(--time-model)', 'var(--time-thinking)', 'var(--time-tool)', 'var(--time-tool-arg)', 'var(--time-reply)'];
    const segs = segments.length > 0
      ? segments.map((s, idx) => {
          const w = Math.max(0.6, ((s.durationMs || 1) / totalDur) * 100);
          const col = palette[idx % palette.length];
          return `<div style="width:${w.toFixed(2)}%;height:100%;background:${col}" title="${escHtml(s.label)}: ${escHtml(fmtDuration(s.durationMs || 0))}"></div>`;
        }).join('')
      : `<div style="width:100%;height:100%;background:var(--surface-well)"></div>`;

    const span = Math.max(0, totalActiveMs || 0);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f, i) =>
      `<span>${i === 0 ? '0' : escHtml(fmtDuration(span * f))}</span>`
    ).join('');

    return `
      <div class="dsh-timing-ribbon-wrap">
        <div class="dsh-timing-ribbon">${segs}</div>
        <div class="dsh-timing-ticks">${ticks}</div>
      </div>
    `;
  }

  /**
   * Composition Donut Chart
   */
  function renderDonutChart(container, buckets) {
    const { fmtTokens, t, escHtml } = AGY.i18n;
    const entries = [
      { key: 'systemBase', label: t('catSystemBase'), color: 'var(--cat-system)', val: buckets?.systemBase || 0 },
      { key: 'toolDefs', label: t('catToolDefs'), color: 'var(--cat-tool-def)', val: buckets?.toolDefs || 0 },
      { key: 'tools', label: t('catTools'), color: 'var(--cat-tools)', val: buckets?.tools || 0 },
      { key: 'thinking', label: t('catThinking'), color: 'var(--cat-thinking)', val: buckets?.thinking || 0 },
      { key: 'assistant', label: t('catAssistant'), color: 'var(--cat-assistant)', val: buckets?.assistant || 0 },
      { key: 'user', label: t('catUser'), color: 'var(--cat-user)', val: buckets?.user || 0 },
      { key: 'skills', label: t('catSkills'), color: 'var(--cat-skills)', val: buckets?.skills || 0 },
      { key: 'injected', label: t('catInjected'), color: 'var(--cat-injected)', val: buckets?.injected || 0 },
      { key: 'media', label: t('catMedia'), color: 'var(--cat-media)', val: buckets?.media || 0 },
      { key: 'other', label: t('catOther'), color: 'var(--cat-other)', val: buckets?.other || 0 },
    ].filter(e => e.val > 0);

    const total = entries.reduce((s, e) => s + e.val, 0);
    if (total <= 0) {
      container.innerHTML = `<div class="empty-state">${escHtml(t('noData'))}</div>`;
      return;
    }

    const size = 148;
    const r = 52;
    const cx = size / 2;
    const cy = size / 2;
    const circ = 2 * Math.PI * r;
    let offset = 0;

    let arcs = '';
    for (const e of entries) {
      const frac = e.val / total;
      const dash = frac * circ;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${e.color}" stroke-width="18" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${escHtml(e.label)}: ${escHtml(fmtTokens(e.val))} (${(frac * 100).toFixed(1)}%)</title></circle>`;
      offset += dash;
    }

    const legend = entries
      .sort((a, b) => b.val - a.val)
      .map(e => {
        const pct = ((e.val / total) * 100).toFixed(1);
        return `<div class="legend-item" style="justify-content:space-between;width:100%">` +
          `<span style="display:inline-flex;align-items:center;gap:6px"><span class="legend-swatch" style="background:${e.color}"></span>${escHtml(e.label)}</span>` +
          `<span class="mono" style="color:var(--ink-muted)">${escHtml(fmtTokens(e.val))} (${pct}%)</span></div>`;
      })
      .join('');

    container.innerHTML =
      `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">` +
      `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-well)" stroke-width="18"/>` +
      arcs +
      `<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)">${escHtml(fmtTokens(total))}</text>` +
      `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="10" fill="var(--ink-muted)">tokens</text>` +
      `</svg>` +
      `<div style="flex:1;min-width:160px;display:flex;flex-direction:column;gap:5px">${legend}</div>` +
      `</div>`;
  }

  /**
   * Context Timeline Chart: supports Total (stacked bars), Delta (signed +/- bars),
   * and Overview (continuous stacked band across entire session) + Event Flags.
   */
  function renderTimelineChart(container, items, options) {
    const {
      mode = 'total',
      granularity = 'step',
      pinnedSeq = -1,
      onHover,
      onPin,
    } = options || {};
    const { fmtTokens, fmtSignedTokens, fmtDuration, t, escHtml } = AGY.i18n;

    if (!items || items.length === 0) {
      container.innerHTML = `<div class="empty-state">${escHtml(t('noData'))}</div>`;
      return;
    }

    const H = 216;
    const padL = 44;
    const padR = 14;
    const padT = 26;
    const padB = 26;
    const plotH = H - padT - padB;

    const getSeq = (it) => (granularity === 'turn' ? it.lastSeq : it.seq);
    const getLabel = (it) => (granularity === 'turn' ? `T${it.turnIndex}` : `#${it.seq + 1}`);

    const buildTooltipHtml = (it) => {
      const act = it.actual || {};
      const fl = (it.flags || []).map(f => FLAG_ICONS[f] ? `${FLAG_ICONS[f].symbol} ${t(FLAG_ICONS[f].i18n)}` : f).join(' · ');
      return (
        `<div style="font-weight:600;margin-bottom:4px">${escHtml(getLabel(it))} · ${escHtml(it.modelLabel || it.model || '')}</div>` +
        `<div>Total Prompt: <b>${escHtml(fmtTokens(it.composition.total))}</b> (${escHtml(fmtSignedTokens(it.delta.total))})</div>` +
        `<div>Actual: In <b>${escHtml(fmtTokens(act.inputTokens))}</b> · Cache <b>${escHtml(fmtTokens(act.cacheReadTokens))}</b> · Out <b>${escHtml(fmtTokens(act.outputTokens))}</b></div>` +
        `<div>Duration: <b>${escHtml(fmtDuration(it.durationMs))}</b></div>` +
        (fl ? `<div style="margin-top:4px;color:var(--warn)">${escHtml(fl)}</div>` : '')
      );
    };

    if (mode === 'overview') {
      const W = Math.max(460, container.clientWidth || 560);
      const plotW = W - padL - padR;
      const maxVal = Math.max(1, ...items.map(it => it.composition?.total || 0));
      const xFor = (i) =>
        items.length === 1 ? padL + plotW / 2 : padL + (i / (items.length - 1)) * plotW;

      let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block">`;
      for (let g = 0; g <= 3; g++) {
        const y = padT + (plotH * g) / 3;
        svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="2,3"/>`;
        svg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)">${escHtml(fmtTokens(maxVal * (1 - g / 3)))}</text>`;
      }

      // Compute cumulative upper/lower bounds per category
      const baseAcc = new Array(items.length).fill(0);
      for (const cat of CAT_META) {
        const topPts = [];
        const botPts = [];
        for (let i = 0; i < items.length; i++) {
          const val = Math.max(0, items[i].composition?.[cat.key] || 0);
          const bot = baseAcc[i];
          const top = bot + val;
          baseAcc[i] = top;
          const x = xFor(i);
          topPts.push(`${x.toFixed(1)},${(padT + plotH - (top / maxVal) * plotH).toFixed(1)}`);
          botPts.unshift(`${x.toFixed(1)},${(padT + plotH - (bot / maxVal) * plotH).toFixed(1)}`);
        }
        svg += `<polygon class="ov-band" data-cat="${cat.key}" points="${topPts.concat(botPts).join(' ')}" fill="${cat.color}" fill-opacity="0.78" stroke="${cat.color}" stroke-width="0.6" style="transition:fill-opacity 0.12s"/>`;
      }

      // Interactive vertical hover slices & flags
      const sliceW = plotW / Math.max(1, items.length);
      items.forEach((it, idx) => {
        const x = xFor(idx);
        const seq = getSeq(it);
        const isPinned = seq === pinnedSeq;
        if (isPinned) {
          svg += `<line x1="${x}" y1="${padT - 4}" x2="${x}" y2="${padT + plotH}" stroke="var(--ink)" stroke-width="1.5"/>`;
        }
        if (it.flags && it.flags.length > 0) {
          const f = FLAG_ICONS[it.flags[0]];
          if (f) {
            svg += `<line x1="${x}" y1="${padT - 8}" x2="${x}" y2="${padT + plotH}" stroke="${f.color}" stroke-dasharray="2,2" stroke-opacity="0.55"/>`;
            svg += `<text x="${x}" y="${padT - 11}" text-anchor="middle" font-size="11" fill="${f.color}">${f.symbol}</text>`;
          }
        }
        svg += `<rect class="tl-hit" data-idx="${idx}" x="${Math.max(padL, x - sliceW / 2)}" y="${padT - 14}" width="${Math.max(6, sliceW)}" height="${plotH + 18}" fill="transparent" style="cursor:pointer"/>`;
      });

      // Quartile X-axis labels
      const qIdxs = [...new Set([0, Math.floor((items.length - 1) * 0.25), Math.floor((items.length - 1) * 0.5), Math.floor((items.length - 1) * 0.75), items.length - 1])];
      for (const qi of qIdxs) {
        svg += `<text x="${xFor(qi)}" y="${H - 7}" text-anchor="middle" font-size="9.5" fill="var(--ink-muted)">${escHtml(getLabel(items[qi]))}</text>`;
      }
      svg += `</svg>`;
      container.innerHTML = svg;

      // Category hover highlight
      const bands = container.querySelectorAll('.ov-band');
      bands.forEach(b => {
        b.addEventListener('mouseenter', () => {
          bands.forEach(o => { o.style.fillOpacity = o === b ? '0.96' : '0.25'; });
        });
        b.addEventListener('mouseleave', () => {
          bands.forEach(o => { o.style.fillOpacity = '0.78'; });
        });
      });

      bindTimelineEvents(container, items, getSeq, buildTooltipHtml, onHover, onPin);
      return;
    }

    // Bar chart (Total or Delta)
    const barSlot = items.length > 24 ? 22 : Math.max(24, Math.min(42, Math.floor(520 / Math.max(1, items.length))));
    const W = Math.max(container.clientWidth || 500, padL + padR + items.length * barSlot);
    const barW = Math.max(10, Math.min(26, barSlot - 6));

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">`;

    if (mode === 'delta') {
      let maxPos = 1000;
      let maxNeg = 1000;
      for (const it of items) {
        let posSum = 0;
        let negSum = 0;
        for (const c of CAT_META) {
          const v = it.delta?.[c.key] || 0;
          if (v > 0) posSum += v;
          else negSum += Math.abs(v);
        }
        if (posSum > maxPos) maxPos = posSum;
        if (negSum > maxNeg) maxNeg = negSum;
      }
      const totalRange = maxPos + maxNeg;
      const zeroY = padT + (maxPos / totalRange) * plotH;

      svg += `<line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--border)" stroke-dasharray="2,3"/>`;
      svg += `<text x="${padL - 5}" y="${padT + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)">+${escHtml(fmtTokens(maxPos))}</text>`;
      svg += `<line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border-strong)" stroke-width="1.2"/>`;
      svg += `<text x="${padL - 5}" y="${zeroY + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)">0</text>`;
      svg += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border)" stroke-dasharray="2,3"/>`;
      svg += `<text x="${padL - 5}" y="${padT + plotH + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)">-${escHtml(fmtTokens(maxNeg))}</text>`;

      items.forEach((it, idx) => {
        const cx = padL + idx * barSlot + barSlot / 2;
        const x = cx - barW / 2;
        const seq = getSeq(it);
        const isPinned = seq === pinnedSeq;

        if (isPinned) {
          svg += `<rect x="${cx - barSlot / 2 + 1}" y="${padT - 4}" width="${barSlot - 2}" height="${plotH + 8}" rx="4" fill="var(--accent-soft)"/>`;
        }

        const nonZeroDeltaCats = CAT_META.filter(c => (it.delta?.[c.key] || 0) !== 0);
        const singleSeg = nonZeroDeltaCats.length <= 1;
        let posAcc = 0;
        let negAcc = 0;
        for (const c of nonZeroDeltaCats) {
          const v = it.delta?.[c.key] || 0;
          if (v > 0) {
            const h = (v / totalRange) * plotH;
            const y = zeroY - ((posAcc + v) / totalRange) * plotH;
            posAcc += v;
            if (h < 0.5 && !singleSeg) continue;
            svg += `<rect x="${x}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(1, h).toFixed(1)}" fill="${c.color}"/>`;
          } else if (v < 0) {
            const av = Math.abs(v);
            const h = (av / totalRange) * plotH;
            const y = zeroY + (negAcc / totalRange) * plotH;
            negAcc += av;
            if (h < 0.5 && !singleSeg) continue;
            svg += `<rect x="${x}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(1, h).toFixed(1)}" fill="${c.color}" fill-opacity="0.72"/>`;
          }
        }

        if (it.flags && it.flags.length > 0) {
          const f = FLAG_ICONS[it.flags[0]];
          if (f) {
            svg += `<line x1="${cx}" y1="${padT - 8}" x2="${cx}" y2="${padT + plotH}" stroke="${f.color}" stroke-dasharray="2,2" stroke-opacity="0.5"/>`;
            svg += `<text x="${cx}" y="${padT - 11}" text-anchor="middle" font-size="11" fill="${f.color}">${f.symbol}</text>`;
          }
        }

        svg += `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="9.5" fill="${isPinned ? 'var(--accent)' : 'var(--ink-muted)'}" font-weight="${isPinned ? '700' : '400'}">${escHtml(getLabel(it))}</text>`;
        svg += `<rect class="tl-hit" data-idx="${idx}" x="${cx - barSlot / 2}" y="${padT - 16}" width="${barSlot}" height="${plotH + 22}" fill="transparent" style="cursor:pointer"/>`;
      });
    } else {
      // Total mode stacked bars
      const maxVal = Math.max(1, ...items.map(it => it.composition?.total || 0));
      for (let g = 0; g <= 3; g++) {
        const y = padT + (plotH * g) / 3;
        svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="2,3"/>`;
        svg += `<text x="${padL - 5}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)">${escHtml(fmtTokens(maxVal * (1 - g / 3)))}</text>`;
      }

      items.forEach((it, idx) => {
        const cx = padL + idx * barSlot + barSlot / 2;
        const x = cx - barW / 2;
        const seq = getSeq(it);
        const isPinned = seq === pinnedSeq;

        if (isPinned) {
          svg += `<rect x="${cx - barSlot / 2 + 1}" y="${padT - 4}" width="${barSlot - 2}" height="${plotH + 8}" rx="4" fill="var(--accent-soft)"/>`;
        }

        const nonZeroCats = CAT_META.filter(c => Math.max(0, it.composition?.[c.key] || 0) > 0);
        const singleSeg = nonZeroCats.length <= 1;
        let acc = 0;
        for (const c of nonZeroCats) {
          const val = Math.max(0, it.composition?.[c.key] || 0);
          const h = (val / maxVal) * plotH;
          const y = padT + plotH - ((acc + val) / maxVal) * plotH;
          acc += val;
          if (h < 0.5 && !singleSeg) continue;
          svg += `<rect x="${x}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(1, h).toFixed(1)}" fill="${c.color}"/>`;
        }

        if (it.flags && it.flags.length > 0) {
          const f = FLAG_ICONS[it.flags[0]];
          if (f) {
            svg += `<line x1="${cx}" y1="${padT - 8}" x2="${cx}" y2="${padT + plotH}" stroke="${f.color}" stroke-dasharray="2,2" stroke-opacity="0.5"/>`;
            svg += `<text x="${cx}" y="${padT - 11}" text-anchor="middle" font-size="11" fill="${f.color}">${f.symbol}</text>`;
          }
        }

        svg += `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="9.5" fill="${isPinned ? 'var(--accent)' : 'var(--ink-muted)'}" font-weight="${isPinned ? '700' : '400'}">${escHtml(getLabel(it))}</text>`;
        svg += `<rect class="tl-hit" data-idx="${idx}" x="${cx - barSlot / 2}" y="${padT - 16}" width="${barSlot}" height="${plotH + 22}" fill="transparent" style="cursor:pointer"/>`;
      });
    }

    svg += `</svg>`;
    container.innerHTML = svg;
    bindTimelineEvents(container, items, getSeq, buildTooltipHtml, onHover, onPin);
  }

  function bindTimelineEvents(container, items, getSeq, buildTooltipHtml, onHover, onPin) {
    const svg = container.querySelector('svg');
    if (!svg) return;
    let lastHoveredIdx = -1;

    const findIdx = (ev) => {
      const hit = ev.target && ev.target.closest ? ev.target.closest('.tl-hit') : null;
      if (!hit) return -1;
      const idx = Number(hit.getAttribute('data-idx'));
      return Number.isInteger(idx) && idx >= 0 && idx < items.length ? idx : -1;
    };

    svg.addEventListener('mousemove', (ev) => {
      const idx = findIdx(ev);
      if (idx < 0) {
        if (lastHoveredIdx !== -1) {
          lastHoveredIdx = -1;
          AGY.bridge.hideTooltip();
          if (onHover) onHover(-1, null);
        }
        return;
      }
      const it = items[idx];
      AGY.bridge.showTooltip(ev, buildTooltipHtml(it));
      if (idx !== lastHoveredIdx) {
        lastHoveredIdx = idx;
        if (onHover) onHover(getSeq(it), it);
      }
    });

    svg.addEventListener('click', (ev) => {
      const idx = findIdx(ev);
      if (idx < 0) return;
      const it = items[idx];
      if (onPin) onPin(getSeq(it), it);
    });

    svg.addEventListener('mouseleave', () => {
      AGY.bridge.hideTooltip();
      if (lastHoveredIdx !== -1) {
        lastHoveredIdx = -1;
        if (onHover) onHover(-1, null);
      }
    });
  }

  function renderDnaRibbonHtml(ribbon, totalTokens) {
    if (!ribbon || ribbon.length === 0) return '';
    const denom = Math.max(1, totalTokens || ribbon.reduce((s, x) => s + (x.tokens || 0), 0));
    const colorMap = {
      system_base: 'var(--cat-system)',
      tool_defs: 'var(--cat-tool-def)',
      user: 'var(--cat-user)',
      injected: 'var(--cat-injected)',
      skills: 'var(--cat-skills)',
      assistant: 'var(--cat-assistant)',
      tool_results: 'var(--cat-tools)',
      media: 'var(--cat-media)',
      other: 'var(--cat-other)',
    };
    const segs = ribbon
      .map(seg => {
        const w = Math.max(0.4, ((seg.tokens || 1) / denom) * 100);
        const col = colorMap[seg.category] || 'var(--cat-tools)';
        return `<div class="comp-seg" data-dna-pos="${seg.pos}" style="width:${w.toFixed(3)}%;background:${col};border-right:1px solid rgba(0,0,0,0.18);cursor:pointer" title="#${seg.pos} · ${AGY.i18n.escHtml(seg.title)} (~${AGY.i18n.fmtTokens(seg.tokens)})"></div>`;
      })
      .join('');
    return `<div class="comp-bar-track" style="height:22px">${segs}</div>`;
  }

  AGY.charts = {
    CAT_META,
    FLAG_ICONS,
    renderCompositionBarHtml,
    renderSevenDayChart,
    renderHeatmap56,
    renderDonutChart,
    renderDshDonut,
    renderTimingRibbonHtml,
    renderTimelineChart,
    renderDnaRibbonHtml,
  };
})(window);
