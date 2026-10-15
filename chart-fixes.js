'use strict';
/*
 * FoodLab Studio v0.10.9 — histogram + scatter + KDE + SCI heatmap redesign
 *
 * Histogram principles in this patch:
 * - X is always a true continuous linear numeric axis.
 * - The left/right domain boundaries are explicitly ticked; truncated X axes show a break mark.
 * - Histogram bars always occupy the full bin interval and remain touching.
 * - Apparent bar width is controlled only through binning (auto/manual bin count), never by shrinking SVG rectangles.
 * - Multi-variable facets reserve space for tick labels, so panel spacing does not overlap labels.
 * - Legend swatches scale with legend font size and use one row whenever the canvas is wide enough.
 * Scatter principles in this patch:
 * - Scatter legends use the actual point marker, never bar-chart color blocks.
 * - Regression line style and width are independent controls.
 * - Correlation statistics are a draggable annotation block with automatic empty-corner placement.
 * - Regression lines remain limited to each group's observed X range.
 */
(() => {
  const originalGallerySpecificPropertyHtml = gallerySpecificPropertyHtml;
  const originalGalleryMethodNoteText = galleryMethodNoteText;
  const originalGallerySeriesPropertyHtml = gallerySeriesPropertyHtml;
  const originalAnalyzeXY = analyzeXY;
  const originalGalleryDragSnapshot = galleryDragSnapshot;
  const originalGalleryApplyDrag = galleryApplyDrag;
  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const clampLocal = (v, a, b) => Math.max(a, Math.min(b, v));
  const finiteValues = arr => arr.map(Number).filter(Number.isFinite);
  function ensureFixSettings() {
    const s = state.gallery.settings;
    if (typeof s.histAutoBins !== 'boolean') s.histAutoBins = true;
    if (!['frequency', 'density'].includes(s.histogramScale)) s.histogramScale = 'frequency';
    if (!['facet', 'overlay'].includes(s.histDisplayMode)) s.histDisplayMode = 'facet';
    if (!['auto', 'independent', 'shared'].includes(s.histAxisMode)) s.histAxisMode = 'auto';
    if (!['group', 'overall'].includes(s.scatterFitMode)) s.scatterFitMode = 'group';
    if (!['solid', 'dashed', 'dotted', 'dashdot'].includes(s.scatterRegressionLineStyle)) s.scatterRegressionLineStyle = 'solid';
    if (!Number.isFinite(Number(s.scatterRegressionLineWidth))) s.scatterRegressionLineWidth = 1.35;
    if (!['auto', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'manual'].includes(s.scatterStatsPosition)) s.scatterStatsPosition = 'auto';
    if (!Number.isFinite(Number(s.scatterStatsX))) s.scatterStatsX = 120;
    if (!Number.isFinite(Number(s.scatterStatsY))) s.scatterStatsY = 90;
    if (!['neutral', 'series'].includes(s.scatterStatsColorMode)) s.scatterStatsColorMode = 'neutral';
    if (typeof s.scatterStatsFrame !== 'boolean') s.scatterStatsFrame = false;
    if (!['r-r2', 'equation-r2'].includes(s.scatterStatsContent)) s.scatterStatsContent = 'r-r2';
    if (!Number.isFinite(Number(s.histFacetGap))) s.histFacetGap = 14;
    if (!['compact', 'standard', 'relaxed', 'manual'].includes(s.histXRangePreset)) s.histXRangePreset = 'standard';
    if (!Number.isFinite(Number(s.histXPaddingPct))) s.histXPaddingPct = 6;
    if (s.histManualXMin === undefined) s.histManualXMin = null;
    if (s.histManualXMax === undefined) s.histManualXMax = null;
    if (typeof s.histShowAxisBreak !== 'boolean') s.histShowAxisBreak = true;
    // KDE uses dedicated styling so line thickness and fill opacity no longer
    // collide with generic series opacity / lineWidth settings.
    if (!['curve', 'hist-kde', 'ridge'].includes(s.kdeDisplayMode)) s.kdeDisplayMode = 'curve';
    if (!['auto', 'manual'].includes(s.kdeBandwidthMode)) s.kdeBandwidthMode = 'auto';
    if (!Number.isFinite(Number(s.kdeBandwidthScale))) s.kdeBandwidthScale = 1;
    if (!Number.isFinite(Number(s.kdeLineWidth))) s.kdeLineWidth = 1.5;
    if (!Number.isFinite(Number(s.kdeLineOpacity))) s.kdeLineOpacity = 1;
    // v0.19.0: outline only by default. Overlapping translucent fills turn
    // muddy with three or more groups, which is the usual case.
    if (typeof s.kdeFillEnabled !== 'boolean') s.kdeFillEnabled = false;
    if (!Number.isFinite(Number(s.kdeFillOpacity))) s.kdeFillOpacity = 0.14;
    if (!['solid', 'dashed', 'dotted', 'dashdot'].includes(s.kdeLineStyle)) s.kdeLineStyle = 'solid';
    if (typeof s.kdeShowRug !== 'boolean') s.kdeShowRug = false;
    if (!Number.isFinite(Number(s.kdeRugHeight))) s.kdeRugHeight = 8;
    if (typeof s.kdeHistAutoBins !== 'boolean') s.kdeHistAutoBins = true;
    if (!Number.isFinite(Number(s.kdeHistBins))) s.kdeHistBins = 8;
    if (!Number.isFinite(Number(s.kdeHistOpacity))) s.kdeHistOpacity = 0.24;
    if (!Number.isFinite(Number(s.kdeFacetGap))) s.kdeFacetGap = 22;
    if (!Number.isFinite(Number(s.kdeRidgeOverlap))) s.kdeRidgeOverlap = 0.55;
    if (!Number.isFinite(Number(s.kdeRidgeHeight))) s.kdeRidgeHeight = 0.78;
    // v0.10.0 exposed a visual rectangle-width scale. It is intentionally ignored now:
    // histogram bar width must equal the numerical bin interval.
    return s;
  }
  function niceStepLocal(raw) {
    const value = Math.abs(Number(raw) || 0);
    if (!(value > 0)) return 1;
    const power = Math.floor(Math.log10(value));
    const scale = Math.pow(10, power);
    const unit = value / scale;
    const niceUnit = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
    return niceUnit * scale;
  }
  function prettyNumber(v, step = null) {
    const value = Number(v);
    if (!Number.isFinite(value)) return '';
    const ref = Math.abs(Number(step) || 0);
    let digits = 0;
    if (ref > 0) {
      // Preserve fractional nice steps such as 2.5 (do not round 47.5 -> 48).
      const fixed = ref.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
      const dot = fixed.indexOf('.');
      digits = dot >= 0 ? clampLocal(fixed.length - dot - 1, 0, 6) : 0;
    }
    let text = value.toFixed(digits);
    if (digits > 0) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return text === '-0' ? '0' : text;
  }
  function autoHistogramBinCount(values) {
    const a = finiteValues(values).sort((x, y) => x - y);
    const n = a.length;
    if (n <= 1) return 1;
    const min = a[0], max = a[n - 1], range = max - min;
    if (!(range > 0)) return 1;
    const q1 = quantileByMethod(a, 0.25, 'linear7');
    const q3 = quantileByMethod(a, 0.75, 'linear7');
    const iqr = q3 - q1;
    const fdWidth = iqr > 0 ? 2 * iqr * Math.pow(n, -1 / 3) : 0;
    const fdBins = fdWidth > 0 ? Math.ceil(range / fdWidth) : NaN;
    const sturges = Math.ceil(Math.log2(n) + 1);
    let suggested = Number.isFinite(fdBins) && fdBins >= 3 ? fdBins : sturges;
    return clampLocal(Math.round(suggested), 2, Math.min(40, Math.max(2, n)));
  }
  function resolvedHistogramBinCount(values, requested, auto) {
    const n = finiteValues(values).length;
    if (!n) return 1;
    if (auto) return autoHistogramBinCount(values);
    return clampLocal(Math.round(Number(requested) || 10), 2, 40);
  }

  function resolvedHistogramGeometry(values, requested, auto) {
    const arr = finiteValues(values).sort((a, b) => a - b);
    if (!arr.length) return { domainMin: 0, domainMax: 1, binWidth: 1, bins: 1 };
    let dataMin = arr[0], dataMax = arr[arr.length - 1];
    if (!(dataMax > dataMin)) {
      const pad = Math.abs(dataMin || 1) * 0.05 || 0.5;
      dataMin -= pad;
      dataMax += pad;
    }

    const target = resolvedHistogramBinCount(arr, requested, auto);
    const range = dataMax - dataMin;
    if (!auto) {
      // Manual bin count means exactly that many touching bins. We still pad the
      // domain to simple boundaries, then divide that continuous domain exactly.
      const edgeStep = niceStepLocal(range / Math.max(4, Math.min(8, target)));
      let domainMin = Math.floor(dataMin / edgeStep) * edgeStep;
      let domainMax = Math.ceil(dataMax / edgeStep) * edgeStep;
      if (!(domainMax > domainMin)) domainMax = domainMin + edgeStep;
      const binWidth = (domainMax - domainMin) / target;
      return {
        domainMin: Number(domainMin.toFixed(12)),
        domainMax: Number(domainMax.toFixed(12)),
        binWidth: Number(binWidth.toFixed(12)),
        bins: target
      };
    }
    // Automatic mode prefers a readable numerical bin width, so edges and ticks
    // naturally land on values such as 5.5, 5.6... or 20, 25, 30....
    let width = niceStepLocal(range / Math.max(1, target));
    let domainMin = Math.floor(dataMin / width) * width;
    let domainMax = Math.ceil(dataMax / width) * width;
    let bins = Math.round((domainMax - domainMin) / width);
    let guard = 0;
    while ((bins > 30 || bins < 2) && guard++ < 10) {
      width = bins > 30 ? niceStepLocal(width * 1.6) : niceStepLocal(width / 2);
      domainMin = Math.floor(dataMin / width) * width;
      domainMax = Math.ceil(dataMax / width) * width;
      bins = Math.round((domainMax - domainMin) / width);
    }
    bins = clampLocal(bins, 2, 40);
    domainMax = domainMin + bins * width;
    return {
      domainMin: Number(domainMin.toFixed(12)),
      domainMax: Number(domainMax.toFixed(12)),
      binWidth: Number(width.toFixed(12)),
      bins
    };
  }
  function histogramXTicks(geometry, maxTicks = 8) {
    const edges = Array.from({ length: geometry.bins + 1 }, (_, i) =>
      Number((geometry.domainMin + i * geometry.binWidth).toFixed(12))
    );
    if (edges.length <= maxTicks) return edges;
    const stride = Math.ceil(geometry.bins / Math.max(2, maxTicks - 1));
    const ticks = edges.filter((_, i) => i % stride === 0);
    const last = edges[edges.length - 1];
    if (Math.abs(ticks[ticks.length - 1] - last) > Math.abs(geometry.binWidth) * 1e-8) ticks.push(last);
    return ticks;
  }
  function histogramFrequencyTicks(maxValue) {
    const maxV = Math.max(1, Number(maxValue) || 1);
    const step = Math.max(1, niceStepLocal(maxV / 5));
    const end = Math.ceil(maxV / step) * step;
    const ticks = [];
    for (let v = 0; v <= end + step * 0.25; v += step) {
      ticks.push(Number(v.toFixed(10)));
      if (ticks.length > 50) break;
    }
    return ticks;
  }
  function densityTicks(maxValue) {
    const maxV = Math.max(Number(maxValue) || 0, 1e-12);
    const step = niceStepLocal(maxV / 5);
    const end = Math.ceil(maxV / step) * step;
    const ticks = [];
    for (let v = 0; v <= end + step * 0.25; v += step) {
      ticks.push(Number(v.toFixed(12)));
      if (ticks.length > 50) break;
    }
    return ticks;
  }
  function isDefaultHistogramAxisTitle(value) {
    return ['', 'Value', 'Frequency', 'Density', '频数', '密度'].includes(String(value ?? '').trim());
  }

  function mapLinear(a, b, c, d) {
    const den = b - a || 1;
    return v => c + (v - a) / den * (d - c);
  }


  function hasFiniteSetting(v) {
    return v !== null && v !== '' && Number.isFinite(Number(v));
  }
  function histogramPaddingAmount(geometry, s) {
    const preset = s.histXRangePreset || 'standard';
    const bin = Math.abs(Number(geometry.binWidth) || 0);
    if (preset === 'compact') return 0;
    if (preset === 'relaxed') return bin * 2;
    if (preset === 'manual') {
      const range = Math.max(bin || 1, geometry.domainMax - geometry.domainMin);
      return range * clampLocal(num(s.histXPaddingPct, 6), 0, 50) / 100;
    }
    return bin;
  }
  function histogramDisplayDomain(geometry, s, allowManual = false) {
    const naturalMin = geometry.domainMin;
    const naturalMax = geometry.domainMax;
    if (allowManual && s.histXRangePreset === 'manual') {
      const hasMin = hasFiniteSetting(s.histManualXMin);
      const hasMax = hasFiniteSetting(s.histManualXMax);
      const min = hasMin ? Number(s.histManualXMin) : naturalMin;
      const max = hasMax ? Number(s.histManualXMax) : naturalMax;
      if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        return {
          domainMin: min,
          domainMax: max,
          manual: true,
          cropsLeft: min > naturalMin + Math.abs(geometry.binWidth) * 1e-9,
          cropsRight: max < naturalMax - Math.abs(geometry.binWidth) * 1e-9
        };
      }
    }
    const pad = histogramPaddingAmount(geometry, s);
    return {
      domainMin: naturalMin - pad,
      domainMax: naturalMax + pad,
      manual: false,
      cropsLeft: false,
      cropsRight: false
    };
  }
  function histogramDisplayTicks(display, geometry, maxTicks = 8) {
    const min = display.domainMin, max = display.domainMax;
    if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) return [geometry.domainMin, geometry.domainMax];
    const target = Math.max(3, maxTicks - 1);
    const step = niceStepLocal((max - min) / target);
    const innerStart = Math.ceil((min - step * 1e-9) / step) * step;
    const ticks = [Number(min.toFixed(12))];
    for (let v = innerStart; v <= max + step * 1e-9; v += step) {
      const vv = Number(v.toFixed(12));
      if (Math.abs(vv - min) < step * 0.22 || Math.abs(vv - max) < step * 0.22) continue;
      ticks.push(vv);
      if (ticks.length > 40) break;
    }
    ticks.push(Number(max.toFixed(12)));
    return [...new Set(ticks)].sort((a, b) => a - b);
  }
  function histogramManualRangeHtml(s) {
    const min = hasFiniteSetting(s.histManualXMin) ? String(s.histManualXMin) : '';
    const max = hasFiniteSetting(s.histManualXMax) ? String(s.histManualXMax) : '';
    const active = s.histXRangePreset === 'manual';
    return `<div class="field" style="margin-top:8px;${active ? '' : 'opacity:.58'}">
      <label>手动 X 轴范围（单图 / 共享 X 轴）</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
        <input type="number" step="any" data-hist-manual-axis="histManualXMin" placeholder="Min（自动）" value="${esc(min)}">
        <input type="number" step="any" data-hist-manual-axis="histManualXMax" placeholder="Max（自动）" value="${esc(max)}">
      </div>
      <small>仅改变显示范围，不改变分箱和频数。独立多变量分面使用“紧凑度”分别扩展各自 X 轴。</small>
    </div>`;
  }
  function histogramCounts(rows, groups, geometry, densityMode) {
    const counts = groups.map(() => Array(geometry.bins).fill(0));
    const sizes = groups.map(g => rows.filter(r => String(r.Group || 'All') === g).length);
    rows.forEach(r => {
      const group = String(r.Group || 'All');
      const gi = groups.indexOf(group);
      const value = Number(r.Value);
      if (gi < 0 || !Number.isFinite(value)) return;
      let bi = Math.floor((value - geometry.domainMin) / geometry.binWidth);
      if (value >= geometry.domainMax) bi = geometry.bins - 1;
      bi = clampLocal(bi, 0, geometry.bins - 1);
      counts[gi][bi] += 1;
    });
    return counts.map((arr, gi) => arr.map(c =>
      densityMode ? c / (Math.max(1, sizes[gi]) * geometry.binWidth) : c
    ));
  }
  function histogramSeriesValues(rows, group) {
    return rows
      .filter(r => String(r.Group || 'All') === group)
      .map(r => Number(r.Value))
      .filter(Number.isFinite);
  }
  function histogramNeedsIndependentAxes(groups, rows) {
    if (groups.length <= 1) return false;
    const stats = groups.map(g => {
      const v = histogramSeriesValues(rows, g).sort((a, b) => a - b);
      if (!v.length) return null;
      const min = v[0], max = v[v.length - 1], median = v[Math.floor((v.length - 1) / 2)];
      const range = Math.max(max - min, Math.abs(median) * 0.02, 1e-9);
      return { min, max, median, range };
    }).filter(Boolean);
    if (stats.length <= 1) return false;
    const medAbs = stats.map(x => Math.abs(x.median)).filter(x => x > 1e-12);
    if (medAbs.length >= 2 && Math.max(...medAbs) / Math.min(...medAbs) > 4) return true;
    const globalMin = Math.min(...stats.map(x => x.min));
    const globalMax = Math.max(...stats.map(x => x.max));
    const meanLocal = stats.reduce((sum, x) => sum + x.range, 0) / stats.length;
    return globalMax - globalMin > meanLocal * 4.5;
  }
  function drawXAxisBreak(panel, geometry, s) {
    if (s.histShowAxisBreak === false) return '';
    // A truncated continuous X axis is valid for a histogram, but the break mark
    // prevents the left Y-axis intersection from being misread as x = 0.
    if (geometry.domainMin <= 0 && geometry.domainMax >= 0) return '';
    const axis = s.axisColor || '#20262b';
    const y = panel.t + panel.h;
    const x = panel.l + 11;
    return `<g data-gobject="axis-x" class="chart-object" pointer-events="none">
      <rect x="${x - 5}" y="${y - 4}" width="23" height="9" fill="${s.background || '#fff'}"/>
      <line x1="${x}" y1="${y + 4}" x2="${x + 7}" y2="${y - 4}" stroke="${axis}" stroke-width="${num(s.axisWidth, 1.35)}"/>
      <line x1="${x + 8}" y1="${y + 4}" x2="${x + 15}" y2="${y - 4}" stroke="${axis}" stroke-width="${num(s.axisWidth, 1.35)}"/>
    </g>`;
  }
  function drawNumericAxes(panel, { s, xMap, yMap, xTicks, yTicks, xStep, yStep, geometry, showXLabels = true, showYLabels = true, boxMode = true }) {
    const axis = s.axisColor || '#20262b';
    const sw = num(s.axisWidth, 1.35);
    const tick = num(s.tickLength, 6);
    const xSize = num(s.xTickSize, 12);
    const ySize = num(s.yTickSize, 12);
    const xWeight = num(s.xTickWeight, 400);
    const yWeight = num(s.yTickWeight, 400);
    let out = '';
    if (boxMode) {
      out += `<rect x="${panel.l}" y="${panel.t}" width="${panel.w}" height="${panel.h}" fill="none" stroke="${axis}" stroke-width="${num(s.frameWidth, 1.15)}"/>`;
    } else {
      out += `<line x1="${panel.l}" y1="${panel.t + panel.h}" x2="${panel.l + panel.w}" y2="${panel.t + panel.h}" stroke="${axis}" stroke-width="${sw}"/>`;
      out += `<line x1="${panel.l}" y1="${panel.t}" x2="${panel.l}" y2="${panel.t + panel.h}" stroke="${axis}" stroke-width="${sw}"/>`;
    }
    if (showYLabels) {
      yTicks.forEach(v => {
        const y = yMap(v);
        out += `<line x1="${panel.l}" x2="${panel.l - tick}" y1="${y}" y2="${y}" stroke="${axis}" stroke-width="${sw}"/>`;
        out += `<text x="${panel.l - tick - 5}" y="${y + ySize * 0.34}" text-anchor="end" font-size="${ySize}" font-weight="${yWeight}" fill="${s.yTickColor || axis}">${esc(prettyNumber(v, yStep))}</text>`;
      });
    }
    if (showXLabels) {
      xTicks.forEach((v, i) => {
        const x = xMap(v);
        const first = i === 0, last = i === xTicks.length - 1;
        const anchor = first ? 'start' : last ? 'end' : 'middle';
        const dx = first ? 2 : last ? -2 : 0;
        out += `<line x1="${x}" x2="${x}" y1="${panel.t + panel.h}" y2="${panel.t + panel.h + tick}" stroke="${axis}" stroke-width="${sw}"/>`;
        out += `<text x="${x + dx}" y="${panel.t + panel.h + tick + xSize + 4}" text-anchor="${anchor}" font-size="${xSize}" font-weight="${xWeight}" fill="${s.xTickColor || axis}">${esc(prettyNumber(v, xStep))}</text>`;
      });
      out += drawXAxisBreak(panel, geometry, s);
    }
    return out;
  }
  function drawHistogramBars(panel, heights, gi, xMap, yMap, geometry, s, overlay = false) {
    const st = getGallerySeriesStyle(gi);
    const opacity = overlay ? Math.min(0.32, num(s.opacity, 0.72)) : Math.min(0.9, Math.max(0.45, num(s.opacity, 0.72)));
    const lw = Math.max(0.45, num(st.lineWidth, s.lineWidth));
    let body = '';
    heights.forEach((height, i) => {
      const left = geometry.domainMin + i * geometry.binWidth;
      const right = left + geometry.binWidth;
      let x1 = xMap(left), x2 = xMap(right);
      if (x2 < panel.l || x1 > panel.l + panel.w) return;
      x1 = clampLocal(x1, panel.l, panel.l + panel.w);
      x2 = clampLocal(x2, panel.l, panel.l + panel.w);
      const y = yMap(height);
      // No visual shrink/gap: histogram rectangle width is exactly the numerical bin interval.
      // A wider display domain creates only outer whitespace; it never inserts gaps between bins.
      body += `<rect x="${x1}" y="${y}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, panel.t + panel.h - y)}" fill="${st.color}" fill-opacity="${opacity}" stroke="${st.color}" stroke-width="${lw}"/>`;
    });
    return `<g data-gobject="series" data-gseries="${gi}" class="chart-object">${body}</g>`;
  }
  function estimateLegendTextWidth(text, fontSize) {
    let em = 0;
    for (const ch of String(text)) em += ch.charCodeAt(0) > 255 ? 0.98 : 0.60;
    return Math.max(fontSize * 1.5, em * fontSize);
  }
  function histogramLegendLayout(groups, W, base, s) {
    const fontSize = Math.max(8, num(s.legendFontSize, 12));
    const marker = clampLocal(fontSize * 0.78, 8, 30);
    const markerGap = Math.max(5, fontSize * 0.35);
    const itemGap = Math.max(12, fontSize * 0.85);
    const rowGap = Math.max(4, fontSize * 0.28);
    const rowHeight = Math.max(marker, fontSize) + rowGap;
    const x0 = num(s.legendX, base.l + 8);
    const y0 = num(s.legendY, Math.max(34, base.t - 28));
    const usableWidth = Math.max(100, W - base.l - 24);
    const widths = groups.map(g => marker + markerGap + estimateLegendTextWidth(g, fontSize) + itemGap);
    const totalWidth = widths.reduce((a, b) => a + b, 0) - itemGap;
    const forceOneRow = totalWidth <= usableWidth;
    const rows = [];
    let current = [], used = 0;
    groups.forEach((g, gi) => {
      const w = widths[gi];
      if (!forceOneRow && current.length && used + w > usableWidth) {
        rows.push(current);
        current = [];
        used = 0;
      }
      current.push({ g, gi, w });
      used += w;
    });
    if (current.length) rows.push(current);
    let items = '';
    rows.forEach((row, ri) => {
      let x = x0;
      const baseline = y0 + ri * rowHeight;
      row.forEach(item => {
        const st = getGallerySeriesStyle(item.gi);
        const markerY = baseline - fontSize * 0.78;
        items += `<rect x="${x}" y="${markerY}" width="${marker}" height="${marker}" fill="${st.color}"/>`;
        items += `<text x="${x + marker + markerGap}" y="${baseline}" font-size="${fontSize}" font-weight="${num(s.legendWeight, 400)}" fill="${s.axisColor || '#20262b'}">${esc(item.g)}</text>`;
        x += item.w;
      });
    });
    const height = rows.length * rowHeight + 6;
    return {
      rows: rows.length,
      height,
      svg: `<g data-gobject="legend" data-gdrag="legend" class="chart-object draggable">${items}</g>`
    };
  }
  function histogramDraggableAxisTitles(W, H, p, s) {
    let out = '';
    const xTitle = String(s.xTitle || '').trim();
    const yTitle = String(s.yTitle || '').trim();
    const x = s.xTitleX ?? (p.l + p.w / 2);
    const y = s.xTitleY ?? (H - 8);
    const yx = s.yTitleX ?? 28;
    const yy = s.yTitleY ?? (p.t + p.h / 2);
    if (s.xTitleVisible !== false && xTitle) {
      out += `<text data-gobject="axis-x" data-gdrag="xTitle" class="chart-object draggable" x="${x}" y="${y}" text-anchor="middle" font-size="${num(s.xTitleSize, 15)}" font-weight="${num(s.xTitleWeight, 400)}" fill="${s.xTitleColor || '#20262b'}">${esc(xTitle)}</text>`;
    }
    if (s.yTitleVisible !== false && yTitle) {
      out += `<text data-gobject="axis-y" data-gdrag="yTitle" class="chart-object draggable" transform="translate(${yx} ${yy}) rotate(-90)" text-anchor="middle" font-size="${num(s.yTitleSize, 15)}" font-weight="${num(s.yTitleWeight, 400)}" fill="${s.yTitleColor || '#20262b'}">${esc(yTitle)}</text>`;
    }
    return out;
  }
  function scatterRegressionDash(style) {
    return ({ solid: '', dashed: '7 5', dotted: '1.6 4', dashdot: '8 4 2 4' })[style] ?? '';
  }
  function scatterLegend(groups, W, p, s) {
    if (!s.legend || !groups.length) return '';
    const font = Math.max(8, num(s.legendFontSize, 12));
    const radius = Math.max(3.2, font * 0.34);
    const markerBox = radius * 2 + 4;
    const padX = Math.max(8, font * 0.65);
    const padY = Math.max(6, font * 0.5);
    const gap = Math.max(16, font * 1.25);
    const rowH = Math.max(font * 1.6, markerBox + 4);
    const maxWidth = Math.max(120, W - 60);
    const horizontal = (s.legendOrientation || 'horizontal') !== 'vertical';
    const configuredCols = Math.max(1, Number(s.legendColumns) || groups.length);
    const itemWidths = groups.map(g => markerBox + 7 + Math.max(font * 2, String(g).length * font * 0.64));
    let cols = horizontal ? Math.min(groups.length, configuredCols || groups.length) : 1;
    if (horizontal) {
      while (cols > 1) {
        let widestRow = 0;
        for (let start = 0; start < groups.length; start += cols) {
          const row = itemWidths.slice(start, start + cols);
          widestRow = Math.max(widestRow, row.reduce((a, b) => a + b, 0) + gap * Math.max(0, row.length - 1));
        }
        if (widestRow + padX * 2 <= maxWidth) break;
        cols -= 1;
      }
    }
    const rows = Math.ceil(groups.length / cols);
    const rowWidths = [];
    for (let r = 0; r < rows; r++) {
      const items = itemWidths.slice(r * cols, (r + 1) * cols);
      rowWidths[r] = items.reduce((a, b) => a + b, 0) + gap * Math.max(0, items.length - 1);
    }
    const width = Math.max(...rowWidths, 40) + padX * 2;
    const height = rows * rowH + padY * 2;
    let itemsSvg = '';
    for (let r = 0; r < rows; r++) {
      let x = padX;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i >= groups.length) break;
        const st = getGallerySeriesStyle(i);
        const cy = padY + r * rowH + rowH / 2;
        const fill = st.markerFill === 'white' ? 'white' : st.color;
        const marker = markerShapeSvg(st.markerShape, x + radius, cy, radius, `fill="${fill}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="1.1"`);
        itemsSvg += `<g data-gobject="series" data-gseries="${i}" class="chart-object">${marker}<text x="${x + markerBox + 7}" y="${cy + font * 0.35}" font-size="${font}" font-weight="${num(s.legendWeight, 400)}" fill="#263238">${esc(groups[i])}</text></g>`;
        x += itemWidths[i] + gap;
      }
    }
    const lx = s.legendX ?? Math.max(24, p.l);
    const ly = s.legendY ?? 38;
    let frame = '';
    const frameStyle = s.legendFrameStyle || 'none';
    if (frameStyle !== 'none') {
      const fx = s.legendFrameX ?? lx - 8, fy = s.legendFrameY ?? ly - 8;
      const fw = s.legendFrameAutoSize ? width : num(s.legendFrameWidthBox, width);
      const fh = s.legendFrameAutoSize ? height : num(s.legendFrameHeightBox, height);
      const dash = frameStyle === 'dashed' ? '8 5' : frameStyle === 'dotted' ? '2 4' : '';
      frame = `<g data-gobject="legend-frame" data-gdrag="legendFrame" class="chart-object draggable" transform="translate(${fx} ${fy})"><rect width="${fw}" height="${fh}" rx="${num(s.legendFrameRadius, 3)}" fill="${s.legendFrameFill || '#ffffff'}" stroke="${s.legendFrameColor || '#7d898f'}" stroke-width="${num(s.legendFrameWidth, 1)}" ${dash ? `stroke-dasharray="${dash}"` : ''}/></g>`;
    }
    return `${frame}<g data-gobject="legend" data-gdrag="legend" class="chart-object draggable" transform="translate(${lx} ${ly})">${itemsSvg}</g>`;
  }
  function scatterStatsText(model, symbol, content) {
    if (content === 'equation-r2') {
      const slope = formatNumber(model.Slope ?? model.slope, 3);
      const intercept = formatNumber(model.Intercept ?? model.intercept, 3);
      const sign = Number(model.Intercept ?? model.intercept) >= 0 ? '+' : '−';
      return `y = ${slope}x ${sign} ${String(intercept).replace('-', '')}, R² = ${formatNumber(model.R2 ?? model.r2, 3)}`;
    }
    return `${symbol} = ${formatNumber(model.Correlation ?? model.association, 3)}, R² = ${formatNumber(model.R2 ?? model.r2, 3)}`;
  }
  function scatterStatsCorner(rows, p, xMap, yMap, boxW, boxH) {
    const margin = 12;
    const candidates = [
      { key: 'top-left', x: p.l + margin, y: p.t + margin },
      { key: 'top-right', x: p.l + p.w - boxW - margin, y: p.t + margin },
      { key: 'bottom-left', x: p.l + margin, y: p.t + p.h - boxH - margin },
      { key: 'bottom-right', x: p.l + p.w - boxW - margin, y: p.t + p.h - boxH - margin }
    ];
    let best = candidates[0], bestScore = Infinity;
    candidates.forEach(c => {
      const x1 = c.x - 8, x2 = c.x + boxW + 8, y1 = c.y - 8, y2 = c.y + boxH + 8;
      let score = 0;
      rows.forEach(r => {
        const x = xMap(r.X), y = yMap(r.Y);
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) score += 4;
        const dx = Math.max(x1 - x, 0, x - x2), dy = Math.max(y1 - y, 0, y - y2);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 24) score += (24 - d) / 24;
      });
      if (score < bestScore) { bestScore = score; best = c; }
    });
    return best;
  }
  function scatterStatsPosition(rows, p, xMap, yMap, boxW, boxH, s) {
    const margin = 12;
    if (s.scatterStatsPosition === 'manual' && Number.isFinite(Number(s.scatterStatsX)) && Number.isFinite(Number(s.scatterStatsY))) {
      return { x: Number(s.scatterStatsX), y: Number(s.scatterStatsY) };
    }
    const fixed = {
      'top-left': { x: p.l + margin, y: p.t + margin },
      'top-right': { x: p.l + p.w - boxW - margin, y: p.t + margin },
      'bottom-left': { x: p.l + margin, y: p.t + p.h - boxH - margin },
      'bottom-right': { x: p.l + p.w - boxW - margin, y: p.t + p.h - boxH - margin }
    };
    return fixed[s.scatterStatsPosition] || scatterStatsCorner(rows, p, xMap, yMap, boxW, boxH);
  }
  function scatterStatsSvg(rows, groups, models, p, xMap, yMap, s, overall = false) {
    if (!s.showCorrelation || !models.length) return '';
    const font = Math.max(8, num(s.annotationSize, 12));
    const lineH = Math.max(18, font * 1.55);
    const markerR = Math.max(2.8, font * 0.25);
    const symbol = s.correlationMethod === 'spearman' ? 'ρ' : 'r';
    const labels = models.map((m, i) => {
      const name = overall ? 'Overall' : String(m.Group ?? groups[i] ?? `Group ${i + 1}`);
      return `${name}: ${scatterStatsText(m, symbol, s.scatterStatsContent)}`;
    });
    const widest = Math.max(...labels.map(v => v.length), 12);
    const boxW = Math.min(p.w * 0.58, Math.max(170, widest * font * 0.58 + 42));
    const boxH = labels.length * lineH + 12;
    const pos = scatterStatsPosition(rows, p, xMap, yMap, boxW, boxH, s);
    let content = '';
    labels.forEach((label, i) => {
      const st = overall ? { color: '#333333', markerShape: 'circle', markerFill: 'white', opacity: 1 } : getGallerySeriesStyle(groups.indexOf(String(models[i].Group ?? groups[i])) >= 0 ? groups.indexOf(String(models[i].Group ?? groups[i])) : i);
      const cy = 7 + i * lineH + lineH / 2;
      const fill = st.markerFill === 'white' ? 'white' : st.color;
      const marker = markerShapeSvg(st.markerShape || 'circle', 10, cy, markerR, `fill="${fill}" fill-opacity="${st.opacity ?? 1}" stroke="${st.color}" stroke-width="1"`);
      const color = s.scatterStatsColorMode === 'series' ? st.color : '#263238';
      content += `${marker}<text x="${20 + markerR}" y="${cy + font * 0.34}" font-size="${font}" font-weight="${num(s.globalFontWeight, 400)}" fill="${color}">${esc(label)}</text>`;
    });
    const frame = s.scatterStatsFrame ? `<rect x="0" y="0" width="${boxW}" height="${boxH}" rx="3" fill="#ffffff" fill-opacity="0.9" stroke="#c9d0d4" stroke-width="0.8"/>` : '';
    return `<g data-gobject="regression" data-gdrag="regression" data-gdrag-x="${pos.x}" data-gdrag-y="${pos.y}" class="chart-object draggable" transform="translate(${pos.x} ${pos.y})">${frame}${content}</g>`;
  }
  gallerySeriesPropertyHtml = function patchedGallerySeriesPropertyHtml(type, index = 0) {
    if (type !== 'kde') return originalGallerySeriesPropertyHtml(type, index);
    const names = galleryStudioSeriesNames();
    const name = names[index] || `Series ${index + 1}`;
    let html = `<div class="series-picker">${names.map((n, i) => `<button class="${i === index ? 'active' : ''}" data-gseries-select="${i}">${esc(n)}</button>`).join('')}</div>`;
    html += gallerySection(`KDE 系列颜色 · ${name}`, [gSeriesColor(index, '颜色')]);
    html += gallerySection('全部系列配色', [galleryPaletteBlock()]);
    html += '<div class="method-badge"><b>KDE 样式规则：</b>曲线粗细、线透明度和填充透明度统一在“核密度曲线”对象中控制，避免系列透明度与填充透明度互相覆盖。</div>';
    return html;
  };
  gallerySpecificPropertyHtml = function patchedGallerySpecificPropertyHtml(type, id) {
    const s = ensureFixSettings();
    if (id === 'histogram') {
      return gallerySection('直方图', [
        gCheck('histAutoBins', '自动分箱（推荐：Freedman–Diaconis / Sturges）'),
        gRange('bins', '手动分箱数量（关闭自动后；越少柱越宽，柱体始终相连）', 2, 40, 1),
        gSelect('histDisplayMode', '多列显示方式', [
          ['facet', '分面显示（推荐）'],
          ['overlay', '半透明叠加']
        ]),
        gSelect('histAxisMode', '分面 X 轴范围', [
          ['auto', '自动判断（推荐）'],
          ['independent', '每列独立 X 轴'],
          ['shared', '所有列共享 X 轴']
        ]),
        gSelect('histXRangePreset', 'X 轴显示紧凑度', [
          ['compact', '紧凑（不额外扩展）'],
          ['standard', '标准（两侧各约 1 个 bin）'],
          ['relaxed', '宽松（两侧各约 2 个 bin）'],
          ['manual', '手动范围 / 自定义外边距']
        ]),
        gRange('histXPaddingPct', '手动模式外边距 %（独立分面使用）', 0, 50, 1),
        histogramManualRangeHtml(s),
        gSelect('histogramScale', '纵轴含义', [
          ['frequency', '频数 Frequency'],
          ['density', '概率密度 Density']
        ]),
        gRange('histFacetGap', '分面额外间距（刻度文字之外）', 0, 60, 2),
        gCheck('histShowAxisBreak', '非零起点显示 X 轴截断标记'),
        gRange('opacity', '柱透明度', 0.15, 1, 0.05),
        gRange('lineWidth', '柱边框粗细', 0, 4, 0.1)
      ]) + '<div class="method-badge"><b>绘图规则：</b>分箱决定统计柱宽；X 轴范围只改变柱子的视觉粗细和两侧留白，不改变频数。柱体始终按真实 bin 区间紧密相连，不会因为调坐标范围而在柱间产生空隙。</div>';
    }
    if (id === 'density' && type === 'kde') {
      // v0.19.0: 只显示当前图形形式真正生效的设置。以前三种形式的控件全部堆在一起，
      // 其中一半在当前模式下不生效，看起来就像“调了没反应”。
      const mode = ['curve', 'hist-kde', 'ridge'].includes(s.kdeDisplayMode) ? s.kdeDisplayMode : 'curve';
      const manualBandwidth = s.kdeBandwidthMode === 'manual';
      const fillOn = s.kdeFillEnabled === true;
      const rugOn = s.kdeShowRug === true;
      const autoBins = s.kdeHistAutoBins !== false;

      const shape = [
        gSelect('kdeDisplayMode', '图形形式', [
          ['curve', '多条曲线叠在一起比较（最常用）'],
          ['hist-kde', '每组一个小图：直方图 + 曲线'],
          ['ridge', '山脊图：每组一排层层叠起']
        ]),
        gSelect('kdeBandwidthMode', '曲线平滑程度', [
          ['auto', '自动（按数据自动决定，推荐）'],
          ['manual', '手动指定']
        ]),
        manualBandwidth
          ? gNumber('bandwidth', '手动平滑程度（越大越平滑，即带宽）', 0.000001, 1000000, 0.01)
          : gRange('kdeBandwidthScale', '自动平滑程度的倍率（越大越平滑）', 0.4, 2.5, 0.05)
      ];

      const style = [
        gSelect('kdeLineStyle', '线条样式', [
          ['solid', '实线（推荐）'],
          ['dashed', '虚线'],
          ['dotted', '点线'],
          ['dashdot', '点划线']
        ]),
        gRange('kdeLineWidth', '曲线粗细', 0.5, 5, 0.1),
        gRange('kdeLineOpacity', '曲线深浅', 0.2, 1, 0.05),
        gSelect('kdeFillEnabled', '曲线下方填充', [
          ['false', '不填充：只保留轮廓线（推荐）'],
          ['true', '半透明填充']
        ])
      ];
      if (fillOn) style.push(gRange('kdeFillOpacity', '填充深浅', 0, 0.5, 0.01));
      style.push(gCheck('kdeShowRug', '底部画出每个数据点的小短线'));
      if (rugOn) style.push(gRange('kdeRugHeight', '小短线高度', 3, 18, 1));

      const extra = [];
      if (mode === 'hist-kde') {
        extra.push(gallerySection('直方图部分（仅“直方图 + 曲线”形式）', [
          gCheck('kdeHistAutoBins', '自动分组'),
          ...(autoBins ? [] : [gRange('kdeHistBins', '手动组数', 3, 30, 1)]),
          gRange('kdeHistOpacity', '直方柱透明度', 0.05, 0.55, 0.01),
          gRange('kdeFacetGap', '小图之间的间距', 8, 60, 2)
        ]));
      }
      if (mode === 'ridge') {
        extra.push(gallerySection('山脊图（仅“山脊图”形式）', [
          gRange('kdeRidgeHeight', '每排的高度', 0.35, 1.2, 0.05),
          gRange('kdeRidgeOverlap', '上下重叠程度', 0, 0.85, 0.05)
        ]));
      }

      return gallerySection('画成什么样', shape)
        + gallerySection('曲线样式', style)
        + extra.join('')
        + '<div class="method-badge"><b>怎么选：</b>组数少（2–4 组）用“多条曲线叠在一起”，并且不填充最清楚；想看每组原始分布用“直方图 + 曲线”；组数多（5 组以上）用“山脊图”，避免多条填充曲线互相遮挡。论文写法：Kernel density estimation；带宽自动时写 bandwidth selected by Silverman\'s rule，手动时写 bandwidth = 数值。</div>';
    }
    if (id === 'regression' && ['scatter', 'bubble'].includes(type)) {
      return gallerySection('关系分析方法', [
        gSelect('correlationMethod', '相关方法', [
          ['pearson', 'Pearson 线性相关'],
          ['spearman', 'Spearman 秩相关']
        ]),
        gSelect('scatterFitMode', '回归拟合范围', [
          ['group', '按组分别拟合（推荐）'],
          ['overall', '全部样本整体拟合']
        ]),
        gCheck('showRegression', '显示线性拟合'),
        gSelect('scatterRegressionLineStyle', '拟合线型', [
          ['solid', '实线（推荐）'],
          ['dashed', '虚线'],
          ['dotted', '点线'],
          ['dashdot', '点划线']
        ]),
        gRange('scatterRegressionLineWidth', '拟合线粗细', 0.5, 4, 0.1)
      ]) + gallerySection('统计标注', [
        gCheck('showCorrelation', '显示相关 / 回归统计'),
        gSelect('scatterStatsContent', '显示内容', [
          ['r-r2', 'r / ρ + R²'],
          ['equation-r2', '回归方程 + R²']
        ]),
        gRange('annotationSize', '统计文字字号', 8, 28, 1),
        gSelect('scatterStatsPosition', '位置', [
          ['auto', '自动避让数据（推荐）'],
          ['top-left', '左上角'],
          ['top-right', '右上角'],
          ['bottom-left', '左下角'],
          ['bottom-right', '右下角'],
          ['manual', '手动坐标 / 拖动']
        ]),
        gNumber('scatterStatsX', '手动 X', 0, 1800, 1),
        gNumber('scatterStatsY', '手动 Y', 0, 1200, 1),
        gSelect('scatterStatsColorMode', '文字颜色', [
          ['neutral', '统一深色（推荐）'],
          ['series', '跟随系列颜色']
        ]),
        gCheck('scatterStatsFrame', '显示白底边框')
      ]) + `<div class="method-badge"><b>当前方法：</b>${esc(correlationMethodLabel())}；${s.scatterFitMode === 'group' ? '每个 Group 独立进行普通最小二乘线性回归' : '全部样本合并进行普通最小二乘线性回归'}。统计标注可以直接在图中拖动。</div>` + galleryDragHint('统计标注');
    }
    return originalGallerySpecificPropertyHtml(type, id);
  };
  galleryMethodNoteText = function patchedGalleryMethodNoteText() {
    const s = ensureFixSettings();
    const type = state.gallery.type;
    if (type === 'hist') {
      const rangeLabel = ({compact:'紧凑',standard:'标准',relaxed:'宽松',manual:'手动'})[s.histXRangePreset] || '标准';
      return `分箱：${s.histAutoBins ? '自动' : `${Math.round(Number(s.bins) || 10)} 个`}；纵轴：${s.histogramScale === 'density' ? 'Density' : 'Frequency'}；X 轴：${s.histAxisMode === 'shared' ? '共享' : s.histAxisMode === 'independent' ? '独立' : '自动判断'}；显示范围：${rangeLabel}`;
    }
    if (type === 'kde') {
      const mode = ({curve:'KDE 曲线','hist-kde':'Histogram + KDE',ridge:'Ridgeline'})[s.kdeDisplayMode] || 'KDE 曲线';
      const bw = s.kdeBandwidthMode === 'manual' ? `手动 ${Number(s.bandwidth) || '—'}` : `自动 × ${Number(s.kdeBandwidthScale).toFixed(2)}`;
      return `${mode}；带宽：${bw}`;
    }
    if (['scatter', 'bubble'].includes(type)) {
      return `相关：${correlationMethodLabel(s.correlationMethod)}；拟合：${s.scatterFitMode === 'group' ? '按组分别' : '全部样本整体'}普通最小二乘线性回归`;
    }
    return originalGalleryMethodNoteText();
  };
  analyzeXY = function patchedAnalyzeXY(rows) {
    const result = originalAnalyzeXY(rows);
    const s = ensureFixSettings();
    if (s.scatterFitMode === 'group' && result?.table?.length > 1) {
      result.summary = [
        ['有效样本', rows.length],
        ['组别数', result.table.length],
        ['相关方法', result.overall?.label || correlationMethodLabel()],
        ['回归拟合', '按组分别']
      ];
      // v1.5.1：旧版直接覆盖 result.text，会把 app.js analyzeXY 已生成的
      // 显著性/效应量解读整体抹掉。改为在保留原解读的基础上补充分组拟合说明。
      result.text = `检测到 ${result.table.length} 个组。散点图默认对每个 Group 分别计算相关系数并分别进行普通最小二乘线性回归；初步分析表中的每一行对应一个组，不会用一条整体回归线同时代表多个处理组。以下为全部观测合并后的总体参考：${result.text || ''}`;
    }
    return result;
  };
  galleryHistogram = function patchedGalleryHistogram(W, H) {
    const s = ensureFixSettings();
    const base = galleryPlotBox(W, H);
    const rows = state.gallery.rows.filter(r => Number.isFinite(r.Value));
    if (!rows.length) return '';
    const groups = [...new Set(rows.map(r => String(r.Group || 'All')))];
    const densityMode = s.histogramScale === 'density';
    if (!String(s.xTitle || '').trim()) s.xTitle = 'Value';
    if (isDefaultHistogramAxisTitle(s.yTitle)) s.yTitle = densityMode ? 'Density' : 'Frequency';
    const autoIndependent = histogramNeedsIndependentAxes(groups, rows);
    const independent = s.histAxisMode === 'independent' || (s.histAxisMode === 'auto' && autoIndependent);
    const useFacet = groups.length > 1 && s.histDisplayMode === 'facet';
    const legend = s.legend && groups.length > 1 ? histogramLegendLayout(groups, W, base, s) : { svg: '', rows: 0, height: 0 };
    if (useFacet && independent) {
      // Gap = room for the previous panel's X tick labels + user-controlled extra whitespace.
      const labelBand = num(s.tickLength, 6) + num(s.xTickSize, 12) + 8;
      const panelGap = labelBand + clampLocal(num(s.histFacetGap, 14), 0, 60);
      const legendReserve = legend.rows ? legend.height + 8 : 0;
      const top = base.t + legendReserve;
      const bottomReserve = labelBand + (s.xTitleVisible !== false ? num(s.xTitleSize, 15) + 30 : 12);
      const availableHeight = Math.max(180, H - top - bottomReserve);
      const panelHeight = Math.max(58, (availableHeight - panelGap * (groups.length - 1)) / groups.length);
      let out = legend.svg;
      groups.forEach((group, gi) => {
        const vals = histogramSeriesValues(rows, group);
        const geometry = resolvedHistogramGeometry(vals, s.bins, s.histAutoBins);
        const display = histogramDisplayDomain(geometry, s, false);
        const groupRows = rows.filter(r => String(r.Group || 'All') === group);
        const heights = histogramCounts(groupRows, [group], geometry, densityMode)[0];
        const rawMax = Math.max(0, ...heights);
        const yTicks = densityMode ? densityTicks((rawMax || 1) * 1.08) : histogramFrequencyTicks((rawMax || 1) * 1.08);
        const yMax = yTicks[yTicks.length - 1] || 1;
        const xTicks = histogramDisplayTicks(display, geometry, 10);
        const xStep = xTicks.length > 1 ? Math.min(...xTicks.slice(1).map((v, i) => Math.abs(v - xTicks[i])).filter(v => v > 0)) : geometry.binWidth;
        const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
        const panel = { l: base.l, t: top + gi * (panelHeight + panelGap), w: base.w, h: panelHeight };
        const xMap = mapLinear(display.domainMin, display.domainMax, panel.l, panel.l + panel.w);
        const yMap = mapLinear(0, yMax, panel.t + panel.h, panel.t + 6);
        out += drawHistogramBars(panel, heights, gi, xMap, yMap, geometry, s, false);
        // Axes are deliberately appended after bars so bars can never cover the X/Y axes.
        out += drawNumericAxes(panel, {
          s, xMap, yMap, xTicks, yTicks, xStep, yStep, geometry: display,
          showXLabels: true,
          showYLabels: true,
          boxMode: String(s.frameMode || 'box') === 'box'
        });
      });
      out += histogramDraggableAxisTitles(W, H, { ...base, t: top, h: availableHeight }, s);
      return out;
    }
    // One metric / shared-axis comparison. Every group uses exactly the same bin edges.
    const values = rows.map(r => Number(r.Value));
    const geometry = resolvedHistogramGeometry(values, s.bins, s.histAutoBins);
    const display = histogramDisplayDomain(geometry, s, true);
    const allHeights = histogramCounts(rows, groups, geometry, densityMode);
    const rawMax = Math.max(0, ...allHeights.flat());
    const yTicks = densityMode ? densityTicks((rawMax || 1) * 1.08) : histogramFrequencyTicks((rawMax || 1) * 1.08);
    const yMax = yTicks[yTicks.length - 1] || 1;
    const xTicks = histogramDisplayTicks(display, geometry, 10);
    const xStep = xTicks.length > 1 ? Math.min(...xTicks.slice(1).map((v, i) => Math.abs(v - xTicks[i])).filter(v => v > 0)) : geometry.binWidth;
    const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
    const legendReserve = legend.rows ? legend.height + 8 : 0;
    const panel = { ...base, t: base.t + legendReserve, h: Math.max(80, base.h - legendReserve) };
    const xMap = mapLinear(display.domainMin, display.domainMax, panel.l, panel.l + panel.w);
    const yMap = mapLinear(0, yMax, panel.t + panel.h, panel.t + 6);
    let out = legend.svg;
    groups.forEach((group, gi) => {
      out += drawHistogramBars(panel, allHeights[gi], gi, xMap, yMap, geometry, s, groups.length > 1);
    });
    out += drawNumericAxes(panel, {
      s, xMap, yMap, xTicks, yTicks, xStep, yStep, geometry: display,
      showXLabels: true,
      showYLabels: true,
      boxMode: String(s.frameMode || 'box') === 'box'
    });
    out += histogramDraggableAxisTitles(W, H, panel, s);
    return out;
  };
  function kdeDash(style) {
    return ({ dashed: '7 5', dotted: '1.8 4', dashdot: '8 4 2 4' })[style] || '';
  }
  function kdeRobustBandwidth(values, scale = 1) {
    const a = finiteValues(values).sort((x, y) => x - y);
    const n = a.length;
    if (n < 2) return Math.max(1e-6, Math.abs(a[0] || 1) * 0.05);
    const sd = sampleSd(a);
    const q1 = quantileByMethod(a, 0.25, 'linear7');
    const q3 = quantileByMethod(a, 0.75, 'linear7');
    const robust = (q3 - q1) / 1.34;
    let sigma = Math.min(Number.isFinite(sd) && sd > 0 ? sd : Infinity, robust > 0 ? robust : Infinity);
    if (!Number.isFinite(sigma) || !(sigma > 0)) sigma = Number.isFinite(sd) && sd > 0 ? sd : ((a[n - 1] - a[0]) / 6 || 1);
    return Math.max(1e-9, 0.9 * sigma * Math.pow(n, -0.2) * clampLocal(num(scale, 1), 0.1, 5));
  }
  function kdeBandwidthFor(values, s) {
    if (s.kdeBandwidthMode === 'manual') {
      const manual = Number(s.bandwidth);
      if (Number.isFinite(manual) && manual > 0) return manual;
    }
    return kdeRobustBandwidth(values, s.kdeBandwidthScale);
  }
  function kdeCurveFor(values, min, max, bandwidth, points = 180) {
    const vals = finiteValues(values);
    const n = vals.length;
    if (!n) return [];
    const h = Math.max(1e-12, Number(bandwidth) || 1e-9);
    const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
    const arr = [];
    for (let i = 0; i < points; i++) {
      const x = min + (max - min) * i / Math.max(1, points - 1);
      let sum = 0;
      for (let j = 0; j < vals.length; j++) {
        const z = (x - vals[j]) / h;
        sum += Math.exp(-0.5 * z * z);
      }
      arr.push([x, sum * norm]);
    }
    return arr;
  }
  function kdeDomain(rows, groups, s) {
    const all = finiteValues(rows.map(r => r.Value));
    if (!all.length) return { min: 0, max: 1, bandwidths: groups.map(() => 1) };
    const bandwidths = groups.map(g => kdeBandwidthFor(rows.filter(r => String(r.Group || 'All') === g).map(r => r.Value), s));
    const maxH = Math.max(...bandwidths.filter(Number.isFinite), 1e-9);
    const dataMin = Math.min(...all), dataMax = Math.max(...all);
    const rawRange = dataMax - dataMin || Math.max(Math.abs(dataMin), 1) * 0.1 || 1;
    const tail = Math.max(maxH * 3, rawRange * 0.05);
    return { min: dataMin - tail, max: dataMax + tail, bandwidths };
  }
  function kdePath(curve, xMap, yMap) {
    return curve.map((q, i) => `${i ? 'L' : 'M'}${xMap(q[0]).toFixed(2)},${yMap(q[1]).toFixed(2)}`).join(' ');
  }
  function kdeLegend(groups, W, p, s) {
    if (!s.legend || !groups.length) return '';
    const font = clampLocal(num(s.legendFontSize, 12), 8, 40);
    const lineW = clampLocal(num(s.kdeLineWidth, 1.5), 0.5, 5);
    const symbol = Math.max(28, font * 2.3);
    const gap = Math.max(18, font * 1.45);
    const itemWidths = groups.map(g => symbol + 9 + (typeof measureLegendText === 'function' ? measureLegendText(g, font, s.legendWeight) : String(g).length * font * 0.62) + gap);
    const total = itemWidths.reduce((a, b) => a + b, 0);
    const available = Math.max(120, W - (s.legendX ?? p.l) - 24);
    // v0.20.0: honour the legend 排列方向 control. Before this, the one-row
    // shortcut always won, so 纵向 could never be applied to the KDE legend —
    // it stayed horizontal no matter what the panel said.
    const vertical = s.legendOrientation === 'vertical';
    const oneRow = !vertical && total <= available;
    const cols = vertical ? 1 : (oneRow ? groups.length : Math.max(1, Math.min(groups.length, Number(s.legendColumns) || 3)));
    const rowH = Math.max(24, font + 10);
    const cellW = oneRow ? null : Math.max(...itemWidths);
    let content = '';
    groups.forEach((g, i) => {
      let x = 0, y = 0;
      if (oneRow) {
        x = itemWidths.slice(0, i).reduce((a, b) => a + b, 0);
      } else {
        x = (i % cols) * cellW;
        y = Math.floor(i / cols) * rowH;
      }
      const st = getGallerySeriesStyle(i);
      const cy = y + font * 0.58;
      const dash = kdeDash(s.kdeLineStyle);
      // KDE legend is line-based (not a bar-chart color block).
      content += `<line x1="${x}" y1="${cy}" x2="${x + symbol}" y2="${cy}" stroke="${st.color}" stroke-width="${lineW}" stroke-opacity="${clampLocal(num(s.kdeLineOpacity, 1), 0.2, 1)}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
      content += `<text x="${x + symbol + 9}" y="${y + font}" font-size="${font}" font-weight="${s.legendWeight}" fill="#263238">${esc(g)}</text>`;
    });
    const lx = s.legendX ?? p.l, ly = s.legendY ?? Math.max(18, p.t - font - 20);
    return `<g data-gobject="legend" data-gdrag="legend" class="chart-object draggable" transform="translate(${lx} ${ly})">${content}</g>`;
  }
  function kdeRugSvg(values, xMap, baseY, color, s) {
    if (!s.kdeShowRug) return '';
    const h = clampLocal(num(s.kdeRugHeight, 8), 3, 18);
    return finiteValues(values).map(v => `<line x1="${xMap(v)}" y1="${baseY}" x2="${xMap(v)}" y2="${baseY - h}" stroke="${color}" stroke-width="0.85" stroke-opacity="0.65"/>`).join('');
  }
  function kdeCurveMode(W, H, p, rows, groups, s) {
    const domain = kdeDomain(rows, groups, s);
    const allValues = rows.map(r => Number(r.Value)).filter(Number.isFinite);
    // v0.19.0: honour the X/Y numeric-range controls from the 轴数字范围 panel,
    // and floor the Y axis at 0 so the curve baseline sits on the X axis instead
    // of floating above it (the old padding pushed the baseline below zero).
    const xRange = (typeof resolveGalleryNumericRange === 'function')
      ? resolveGalleryNumericRange('x', allValues, { pad: .08 })
      : { min: domain.min, max: domain.max, ticks: makeTicks(domain.min, domain.max, null, 7) };
    const xmin = xRange.min, xmax = xRange.max;
    const curves = groups.map((g, i) => kdeCurveFor(rows.filter(r => String(r.Group || 'All') === g).map(r => r.Value), xmin, xmax, domain.bandwidths[i], 200));
    const ymaxRaw = Math.max(0, ...curves.flatMap(c => c.map(q => q[1])));
    const yRange = (typeof resolveGalleryNumericRange === 'function')
      ? resolveGalleryNumericRange('y', [0, ymaxRaw || 1], { pad: .08, includeZero: true, floorZero: true })
      : { min: 0, max: (ymaxRaw || 1) * 1.08, ticks: makeTicks(0, (ymaxRaw || 1) * 1.08, null, 5) };
    const ymin = yRange.min, ymax = yRange.max;
    const xMap = scaleLinear(xmin, xmax, p.l, p.l + p.w);
    // v0.23.0: broken Y axis support for the KDE curve mode.
    const yb = (typeof galleryBrokenY === 'function') ? galleryBrokenY(ymin, ymax, p) : null;
    const yMap = yb ? yb.map : scaleLinear(ymin, ymax, p.t + p.h, p.t);
    const xTicks = xRange.ticks || makeTicks(xmin, xmax, null, 7);
    const yTicks = yb ? yb.ticks : (yRange.ticks || makeTicks(ymin, ymax, null, 5));
    // v0.20.0: axes are emitted after the series below so the curve line, the
    // baseline fill and the rug marks can never cover the X axis (publication
    // convention: the axis frame stays on top of the data).
    let out = '';
    const dash = kdeDash(s.kdeLineStyle), dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    const lineW = clampLocal(num(s.kdeLineWidth, 1.5), 0.5, 5);
    const lineOpacity = clampLocal(num(s.kdeLineOpacity, 1), 0.2, 1);
    const fillOpacity = clampLocal(num(s.kdeFillOpacity, 0.14), 0, 0.5);
    groups.forEach((g, i) => {
      const st = getGallerySeriesStyle(i), curve = curves[i], d = kdePath(curve, xMap, yMap);
      let body = '';
      if (s.kdeFillEnabled && fillOpacity > 0) body += `<path d="${d} L${xMap(xmax)},${yMap(ymin)} L${xMap(xmin)},${yMap(ymin)} Z" fill="${st.color}" fill-opacity="${fillOpacity}" stroke="none"/>`;
      body += `<path d="${d}" fill="none" stroke="${st.color}" stroke-opacity="${lineOpacity}" stroke-width="${lineW}"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>`;
      body += kdeRugSvg(rows.filter(r => String(r.Group || 'All') === g).map(r => r.Value), xMap, p.t + p.h, st.color, s);
      out += `<g data-gobject="series" data-gseries="${i}" class="chart-object">${body}</g>`;
    });
    // v0.20.0: frame / ticks / labels are drawn on top of the curves now.
    out += commonAxes(W, H, p, xTicks, yTicks, v => xMap(v), yMap);
    out += kdeLegend(groups, W, p, s);
    return out;
  }
  function kdePanelAxes(panel, s, xMap, yMap, xTicks, yTicks) {
    const axis = s.axisColor || '#20262b';
    const frame = s.frameColor || axis;
    const sw = num(s.axisWidth, 1.35);
    const fw = num(s.frameWidth, sw);
    const tick = num(s.tickLength, 6);
    const xSize = num(s.xTickSize, 12), ySize = num(s.yTickSize, 12);
    let out = '';
    if (s.frameMode !== 'none') {
      out += `<line x1="${panel.l}" y1="${panel.t + panel.h}" x2="${panel.l + panel.w}" y2="${panel.t + panel.h}" stroke="${axis}" stroke-width="${sw}"/>`;
      out += `<line x1="${panel.l}" y1="${panel.t}" x2="${panel.l}" y2="${panel.t + panel.h}" stroke="${axis}" stroke-width="${sw}"/>`;
      if (s.frameMode === 'lbr' || s.frameMode === 'box') out += `<line x1="${panel.l + panel.w}" y1="${panel.t}" x2="${panel.l + panel.w}" y2="${panel.t + panel.h}" stroke="${frame}" stroke-width="${fw}"/>`;
      if (s.frameMode === 'box') out += `<line x1="${panel.l}" y1="${panel.t}" x2="${panel.l + panel.w}" y2="${panel.t}" stroke="${frame}" stroke-width="${fw}"/>`;
    }
    yTicks.forEach(v => {
      const y = yMap(v);
      out += `<line x1="${panel.l - tick}" x2="${panel.l}" y1="${y}" y2="${y}" stroke="${axis}" stroke-width="${sw}"/>`;
      out += `<text x="${panel.l - tick - 4}" y="${y + 4}" text-anchor="end" font-size="${ySize}" font-weight="${s.yTickWeight || 400}" fill="${s.yTickColor || axis}">${esc(formatTick(v))}</text>`;
    });
    xTicks.forEach(v => {
      const x = xMap(v);
      out += `<line x1="${x}" x2="${x}" y1="${panel.t + panel.h}" y2="${panel.t + panel.h + tick}" stroke="${axis}" stroke-width="${sw}"/>`;
      out += `<text x="${x}" y="${panel.t + panel.h + tick + 16}" text-anchor="middle" font-size="${xSize}" font-weight="${s.xTickWeight || 400}" fill="${s.xTickColor || axis}">${esc(formatTick(v))}</text>`;
    });
    return out;
  }
  function kdeHistogramFacetMode(W, H, p, rows, groups, s) {
    const domain = kdeDomain(rows, groups, s);
    const allVals = finiteValues(rows.map(r => r.Value));
    const geometry = resolvedHistogramGeometry(allVals, s.kdeHistBins, s.kdeHistAutoBins);
    // Force shared bins across groups, but extend KDE tails in the axis domain.
    const xMin = Math.min(domain.min, geometry.domainMin), xMax = Math.max(domain.max, geometry.domainMax);
    const tickBand = num(s.tickLength, 6) + num(s.xTickSize, 12) + 20;
    const gap = tickBand + clampLocal(num(s.kdeFacetGap, 22), 8, 60);
    const legendReserve = s.legend ? Math.max(30, num(s.legendFontSize, 12) + 18) : 0;
    const top = p.t + legendReserve;
    const available = Math.max(180, p.h - legendReserve);
    const panelH = Math.max(70, (available - gap * (groups.length - 1)) / groups.length);
    let out = kdeLegend(groups, W, p, s);
    const dash = kdeDash(s.kdeLineStyle), dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    const lineW = clampLocal(num(s.kdeLineWidth, 1.5), 0.5, 5);
    const lineOpacity = clampLocal(num(s.kdeLineOpacity, 1), 0.2, 1);
    const histOpacity = clampLocal(num(s.kdeHistOpacity, 0.24), 0.05, 0.55);
    groups.forEach((g, gi) => {
      const vals = finiteValues(rows.filter(r => String(r.Group || 'All') === g).map(r => r.Value));
      const bw = kdeBandwidthFor(vals, s);
      const curve = kdeCurveFor(vals, xMin, xMax, bw, 190);
      const counts = Array(geometry.bins).fill(0);
      vals.forEach(v => {
        let bi = Math.floor((v - geometry.domainMin) / geometry.binWidth);
        if (v === geometry.domainMax) bi = geometry.bins - 1;
        if (bi >= 0 && bi < geometry.bins) counts[bi] += 1;
      });
      const densities = counts.map(c => c / (Math.max(1, vals.length) * geometry.binWidth));
      const ymaxRaw = Math.max(0, ...densities, ...curve.map(q => q[1]));
      const ymax = ymaxRaw > 0 ? ymaxRaw * 1.1 : 1;
      const panel = { l: p.l, t: top + gi * (panelH + gap), w: p.w, h: panelH };
      const xMap = scaleLinear(xMin, xMax, panel.l, panel.l + panel.w);
      const yMap = scaleLinear(0, ymax, panel.t + panel.h, panel.t + 5);
      const st = getGallerySeriesStyle(gi);
      let body = '';
      densities.forEach((d, bi) => {
        const left = geometry.domainMin + bi * geometry.binWidth;
        const right = left + geometry.binWidth;
        const x1 = xMap(left), x2 = xMap(right), y = yMap(d);
        body += `<rect x="${x1}" y="${y}" width="${Math.max(0, x2 - x1)}" height="${Math.max(0, panel.t + panel.h - y)}" fill="${st.color}" fill-opacity="${histOpacity}" stroke="${st.color}" stroke-opacity="0.55" stroke-width="0.7"/>`;
      });
      const dPath = kdePath(curve, xMap, yMap);
      // v0.19.0: the fill switch now applies here too. This mode used to ignore
      // it entirely, so ticking 曲线下方填充 in the panel did nothing at all.
      const facetFillOpacity = clampLocal(num(s.kdeFillOpacity, 0.14), 0, 0.5);
      if (s.kdeFillEnabled && facetFillOpacity > 0) body += `<path d="${dPath} L${xMap(xMax)},${yMap(0)} L${xMap(xMin)},${yMap(0)} Z" fill="${st.color}" fill-opacity="${Math.min(0.3, facetFillOpacity + 0.04)}" stroke="none"/>`;
      body += `<path d="${dPath}" fill="none" stroke="${st.color}" stroke-opacity="${lineOpacity}" stroke-width="${lineW}"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>`;
      body += kdeRugSvg(vals, xMap, panel.t + panel.h, st.color, s);
      out += `<g data-gobject="series" data-gseries="${gi}" class="chart-object">${body}</g>`;
      out += kdePanelAxes(panel, s, xMap, yMap, makeTicks(xMin, xMax, null, 7), makeTicks(0, ymax, null, 4));
    });
    out += histogramDraggableAxisTitles(W, H, p, s);
    return out;
  }
  function kdeRidgelineMode(W, H, p, rows, groups, s) {
    const domain = kdeDomain(rows, groups, s);
    const xMap = scaleLinear(domain.min, domain.max, p.l + 74, p.l + p.w);
    const curves = groups.map((g, i) => kdeCurveFor(rows.filter(r => String(r.Group || 'All') === g).map(r => r.Value), domain.min, domain.max, domain.bandwidths[i], 190));
    const peaks = curves.map(c => Math.max(1e-12, ...c.map(q => q[1])));
    const overlap = clampLocal(num(s.kdeRidgeOverlap, 0.55), 0, 0.85);
    const heightScale = clampLocal(num(s.kdeRidgeHeight, 0.78), 0.35, 1.2);
    const rowStep = p.h / Math.max(1, groups.length + 0.45 - overlap * 0.45);
    const ridgeH = rowStep * heightScale * (1 + overlap * 0.45);
    const fillOpacity = clampLocal(num(s.kdeFillOpacity, 0.14), 0, 0.5);
    const lineOpacity = clampLocal(num(s.kdeLineOpacity, 1), 0.2, 1);
    const lineW = clampLocal(num(s.kdeLineWidth, 1.5), 0.5, 5);
    const dash = kdeDash(s.kdeLineStyle), dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    let out = '';
    groups.forEach((g, i) => {
      const baseline = p.t + (i + 1) * rowStep;
      const st = getGallerySeriesStyle(i), peak = peaks[i];
      const yMap = d => baseline - d / peak * ridgeH;
      const curve = curves[i], path = kdePath(curve, xMap, yMap);
      if (s.kdeFillEnabled && fillOpacity > 0) out += `<path data-gobject="series" data-gseries="${i}" class="chart-object" d="${path} L${xMap(domain.max)},${baseline} L${xMap(domain.min)},${baseline} Z" fill="${st.color}" fill-opacity="${Math.min(0.32, fillOpacity + 0.04)}" stroke="none"/>`;
      out += `<path data-gobject="series" data-gseries="${i}" class="chart-object" d="${path}" fill="none" stroke="${st.color}" stroke-opacity="${lineOpacity}" stroke-width="${lineW}"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>`;
      out += `<line x1="${xMap(domain.min)}" x2="${xMap(domain.max)}" y1="${baseline}" y2="${baseline}" stroke="${s.axisColor || '#20262b'}" stroke-width="0.65" stroke-opacity="0.42"/>`;
      out += `<text x="${p.l + 64}" y="${baseline - 4}" text-anchor="end" font-size="${Math.max(10, num(s.yTickSize, 12))}" font-weight="${s.yTickWeight || 400}" fill="${st.color}">${esc(g)}</text>`;
      out += kdeRugSvg(rows.filter(r => String(r.Group || 'All') === g).map(r => r.Value), xMap, baseline, st.color, s);
    });
    const axisY = p.t + p.h;
    const ticks = makeTicks(domain.min, domain.max, null, 7);
    const axis = s.axisColor || '#20262b';
    out += `<g data-gobject="axis-x" class="chart-object"><line x1="${xMap(domain.min)}" x2="${xMap(domain.max)}" y1="${axisY}" y2="${axisY}" stroke="${axis}" stroke-width="${s.axisWidth || 1.2}"/>`;
    ticks.forEach(v => { const x = xMap(v); out += `<line x1="${x}" x2="${x}" y1="${axisY}" y2="${axisY + s.tickLength}" stroke="${axis}" stroke-width="${s.axisWidth || 1.2}"/><text x="${x}" y="${axisY + s.tickLength + 16}" text-anchor="middle" font-size="${s.xTickSize || 12}" font-weight="${s.xTickWeight || 400}" fill="${s.xTickColor || axis}">${esc(formatTick(v))}</text>`; });
    out += `</g>`;
    if (s.xTitleVisible && s.xTitle) {
      const x = s.xTitleX ?? (p.l + p.w / 2), y = s.xTitleY ?? (H - 24);
      out += `<text data-gobject="axis-x" data-gdrag="xTitle" class="chart-object draggable" x="${x}" y="${y}" text-anchor="middle" font-size="${s.xTitleSize}" font-weight="${s.xTitleWeight}" fill="${s.xTitleColor}">${esc(s.xTitle)}</text>`;
    }
    return out;
  }
  galleryKde = function patchedGalleryKde(W, H) {
    const s = ensureFixSettings();
    const p = galleryPlotBox(W, H);
    const rows = (state.gallery.rows || []).filter(r => Number.isFinite(Number(r.Value)));
    if (!rows.length) return '';
    const groups = [...new Set(rows.map(r => String(r.Group || 'All')))];
    if (!String(s.xTitle || '').trim()) s.xTitle = 'Value';
    if (['', 'Value', 'Frequency', '频数'].includes(String(s.yTitle || '').trim())) s.yTitle = 'Density';
    if (s.kdeDisplayMode === 'hist-kde') return kdeHistogramFacetMode(W, H, p, rows, groups, s);
    if (s.kdeDisplayMode === 'ridge') return kdeRidgelineMode(W, H, p, rows, groups, s);
    return kdeCurveMode(W, H, p, rows, groups, s);
  };
  // v0.19.0: index.html's v0.11.5 block replaced galleryKde with a simpler
  // renderer that ignored every KDE setting below, which is why those controls
  // appeared to do nothing. The reference is kept so the last patch in the
  // chain can put this implementation back.
  try { globalThis.__foodlabGalleryKde = galleryKde; } catch (_err) {}
  // v0.20.0: the same index.html v0.11.5 block also replaced galleryScatter
  // with a version that only ever drew the overall fit with a hard-coded black
  // dashed line, so per-group fits and the 拟合线型 / 统计标注 controls were
  // ignored. The v0.11.5 block keeps its axis-range/clipping behaviour but now
  // calls these exported helpers for the regression styling and the stats box.
  try { globalThis.__foodlabScatterStatsSvg = scatterStatsSvg; } catch (_err) {}
  try { globalThis.__foodlabScatterDash = scatterRegressionDash; } catch (_err) {}

  galleryScatter = function patchedGalleryScatter(W, H, bubble) {
    const s = ensureFixSettings();
    const p = galleryPlotBox(W, H);
    const rows = state.gallery.rows.filter(r => Number.isFinite(r.X) && Number.isFinite(r.Y));
    if (!rows.length) return '';
    const groups = [...new Set(rows.map(r => String(r.Group || 'All')))];
    const xs = rows.map(r => r.X);
    const ys = rows.map(r => r.Y);
    // v0.20.0: honour the X/Y 轴数字范围 panel (manual ranges, tick step and
    // optional log10 axis) exactly like the removed v0.11.5 override did, and
    // apply strict clipping so out-of-range data never leaks into the plot.
    // index.html no longer overrides galleryScatter, so THIS function is now
    // the single authoritative scatter/bubble renderer and later edits to
    // other modules can no longer clobber it. galleryRangeMap handles log axes
    // and is byte-identical to scaleLinear when the range is linear.
    let xr = null, yr = null;
    if (typeof resolveGalleryNumericRange === 'function') {
      try { xr = resolveGalleryNumericRange('x', xs, { pad: .08 }); } catch (_e) {}
      try { yr = resolveGalleryNumericRange('y', ys, { pad: .10 }); } catch (_e) {}
    }
    if (!xr || !Number.isFinite(xr.min) || !Number.isFinite(xr.max)) {
      const xmin = Math.min(...xs), xmax = Math.max(...xs), xpad = (xmax - xmin || 1) * 0.08;
      xr = { min: xmin - xpad, max: xmax + xpad, ticks: makeTicks(xmin - xpad, xmax + xpad, null, 6), log: false };
    }
    if (!yr || !Number.isFinite(yr.min) || !Number.isFinite(yr.max)) {
      const ymin = Math.min(...ys), ymax = Math.max(...ys), ypad = (ymax - ymin || 1) * 0.10;
      yr = { min: ymin - ypad, max: ymax + ypad, ticks: makeTicks(ymin - ypad, ymax + ypad, null, 6), log: false };
    }
    const xMap = galleryRangeMap(xr, p.l, p.l + p.w);
    // v0.23.0: broken Y axis support (settings come from the Y 轴与纵标题
    // panel). When active, data points, the regression line and the statistics
    // all follow the two-segment map instead of the plain linear one.
    const yb = typeof galleryBrokenY === 'function' ? galleryBrokenY(yr.min, yr.max, p) : null;
    const yMap = yb ? yb.map : galleryRangeMap(yr, p.t + p.h, p.t);
    const yTicks = yb ? yb.ticks : yr.ticks;
    // Axes and legend first (outside the clip); data, regression lines and the
    // statistics box are clipped so manual ranges crop strictly.
    let out = commonAxes(
      W, H, p,
      xr.ticks, yTicks,
      v => xMap(Number(v)),
      v => yMap(Number(v)),
      { x: !!xr.log, y: !!yr.log }
    ) + scatterLegend(groups, W, p, s);
    out += `<clipPath id="galleryScatterClip"><rect x="${p.l}" y="${p.t}" width="${p.w}" height="${p.h}"/></clipPath><g clip-path="url(#galleryScatterClip)">`;

    const sizes = rows.map(r => r.Size).filter(Number.isFinite);
    const smin = sizes.length ? Math.min(...sizes) : 0;
    const smax = sizes.length ? Math.max(...sizes) : 1;
    groups.forEach((g, gi) => {
      const st = getGallerySeriesStyle(gi);
      const groupRows = rows.filter(r => String(r.Group || 'All') === g);
      const body = groupRows.map(r => {
        const radius = bubble && Number.isFinite(r.Size)
          ? st.pointSize + (r.Size - smin) / (smax - smin || 1) * Math.max(5, st.pointSize * 2)
          : st.pointSize;
        const fill = st.markerFill === 'white' ? 'white' : st.color;
        const attrs = `fill="${fill}" fill-opacity="${st.opacity}" stroke="${st.color}" stroke-width="1.05"`;
        return markerShapeSvg(st.markerShape, xMap(r.X), yMap(r.Y), radius, attrs);
      }).join('');
      out += `<g data-gobject="series" data-gseries="${gi}" class="chart-object">${body}</g>`;
    });
    const analysis = state.gallery.analysis;
    const dash = scatterRegressionDash(s.scatterRegressionLineStyle);
    const lineWidth = clampLocal(num(s.scatterRegressionLineWidth, 1.35), 0.5, 4);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    // Regression lines follow the axis scale: straight line for linear axes,
    // 48-point sampled curve when either axis is logarithmic.
    const linePath = (b0, b1, x1, x2, stroke) => {
      if (!Number.isFinite(b0) || !Number.isFinite(b1)) return '';
      if (!xr.log && !yr.log) {
        const y1 = b0 + b1 * x1, y2 = b0 + b1 * x2;
        return `<line x1="${xMap(x1)}" y1="${yMap(y1)}" x2="${xMap(x2)}" y2="${yMap(y2)}" stroke="${stroke}" stroke-width="${lineWidth}"${dashAttr} stroke-linecap="round"/>`;
      }
      const N = 48; let d = '';
      for (let i = 0; i <= N; i++) {
        const t = i / N, x = xr.log ? x1 * Math.pow(x2 / x1, t) : x1 + (x2 - x1) * t;
        const yv = b0 + b1 * x;
        if (!Number.isFinite(yv)) continue;
        d += (d ? 'L' : 'M') + xMap(x) + ',' + yMap(yv);
      }
      return d ? `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${lineWidth}"${dashAttr} stroke-linecap="round" stroke-linejoin="round"/>` : '';
    };
    if (s.scatterFitMode === 'overall') {
      const m = analysis?.overall;
      if (s.showRegression && m && Number.isFinite(m.slope) && Number.isFinite(m.intercept)) {
        out += `<g data-gobject="regression" class="chart-object">${linePath(m.intercept, m.slope, xr.min, xr.max, '#333333')}</g>`;
      }
      if (m) out += scatterStatsSvg(rows, groups, [m], p, xMap, yMap, s, true);
    } else {
      // One OLS fit per group; do not extrapolate beyond each group's observed X range.
      const table = analysis?.table || [];
      groups.forEach((g, gi) => {
        const st = getGallerySeriesStyle(gi);
        const groupRows = rows.filter(r => String(r.Group || 'All') === g);
        const model = table.find(r => String(r.Group) === g);
        if (!model) return;
        const gx = groupRows.map(r => r.X).filter(Number.isFinite);
        if (!gx.length) return;
        const gxMin = Math.min(...gx), gxMax = Math.max(...gx);
        if (s.showRegression && gx.length >= 2 && gxMax > gxMin && Number.isFinite(model.Slope) && Number.isFinite(model.Intercept)) {
          out += `<g data-gobject="regression" data-gseries="${gi}" class="chart-object">${linePath(model.Intercept, model.Slope, gxMin, gxMax, st.color)}</g>`;
        }
      });
      out += scatterStatsSvg(rows, groups, table, p, xMap, yMap, s, false);
    }
    out += '</g>';
    return out;
  };
  galleryDragSnapshot = function patchedGalleryDragSnapshot(key, el = null) {
    if (key === 'regression' && el?.dataset?.gdrag === 'regression') {
      const s = ensureFixSettings();
      const x = Number(el.dataset.gdragX);
      const y = Number(el.dataset.gdragY);
      return {
        x: Number.isFinite(x) ? x : (Number.isFinite(Number(s.scatterStatsX)) ? Number(s.scatterStatsX) : 120),
        y: Number.isFinite(y) ? y : (Number.isFinite(Number(s.scatterStatsY)) ? Number(s.scatterStatsY) : 90)
      };
    }
    return originalGalleryDragSnapshot(key, el);
  };
  galleryApplyDrag = function patchedGalleryApplyDrag(key, x, y, el) {
    if (key === 'regression' && el?.dataset?.gdrag === 'regression') {
      const s = ensureFixSettings();
      s.scatterStatsPosition = 'manual';
      s.scatterStatsX = x;
      s.scatterStatsY = y;
      el.dataset.gdragX = x;
      el.dataset.gdragY = y;
      el.setAttribute('transform', `translate(${x} ${y})`);
      return;
    }
    return originalGalleryApplyDrag(key, x, y, el);
  };
  if (typeof document !== 'undefined' && document.addEventListener) {
    const forceScatterStatsManual = event => {
      const el = event.target?.closest?.('[data-gsetting="scatterStatsX"], [data-gsetting="scatterStatsY"]');
      if (!el) return;
      state.gallery.settings.scatterStatsPosition = 'manual';
    };
    document.addEventListener('input', forceScatterStatsManual, true);
    document.addEventListener('change', forceScatterStatsManual, true);
    document.addEventListener('change', event => {
      const input = event.target?.closest?.('[data-hist-manual-axis]');
      if (!input) return;
      const key = input.dataset.histManualAxis;
      if (!['histManualXMin', 'histManualXMax'].includes(key)) return;
      const raw = String(input.value ?? '').trim();
      state.gallery.settings[key] = raw === '' ? null : Number(raw);
      const min = state.gallery.settings.histManualXMin;
      const max = state.gallery.settings.histManualXMax;
      if (hasFiniteSetting(min) && hasFiniteSetting(max) && Number(max) <= Number(min)) {
        if (typeof toast === 'function') toast('X 轴 Max 必须大于 Min；当前将暂时使用自动范围。');
      } else {
        const vals = (state.gallery.rows || []).map(r => Number(r.Value)).filter(Number.isFinite);
        if (vals.length) {
          const dataMin = Math.min(...vals), dataMax = Math.max(...vals);
          const hidesLeft = hasFiniteSetting(min) && Number(min) > dataMin;
          const hidesRight = hasFiniteSetting(max) && Number(max) < dataMax;
          if ((hidesLeft || hidesRight) && typeof toast === 'function') toast('提示：当前手动 X 轴范围会隐藏部分数据。');
        }
        if (typeof renderChartStudio === 'function') renderChartStudio();
      }
    }, true);
  }
  ensureFixSettings();
})();


/* ===== FoodLab Studio v0.10.8 — publication heatmap renderer ===== */
(() => {
  const previousSpecificPropertyHtml = gallerySpecificPropertyHtml;
  const previousBasePropertyHtml = galleryBasePropertyHtml;
  const previousMethodNoteText = galleryMethodNoteText;
  const SCI_HEATMAP_PALETTES = {
    paperBlueYellowRed: {
      name:'Paper Blue – Yellow – Red（论文风格推荐）',
      stops:[
        [0.00,'#3F67A8'],
        [0.18,'#6FA8CF'],
        [0.36,'#BFDDE8'],
        [0.50,'#FFF4B2'],
        [0.64,'#F9C66B'],
        [0.82,'#F07A4A'],
        [1.00,'#C93B36']
      ],
      low:'#3F67A8',mid:'#FFF4B2',high:'#C93B36',diagonal:'#9F272A'
    },
    bluePaleYellowRed: {
      name:'Blue – Pale yellow – Red（柔和组学）',
      stops:[[0,'#3B6FB6'],[.25,'#9CC4DF'],[.5,'#FFF3B0'],[.75,'#F5A15D'],[1,'#D9483B']],
      low:'#3B6FB6',mid:'#FFF3B0',high:'#D9483B',diagonal:'#A51C30'
    },
    rdYlBuR: {
      name:'RdYlBu reversed（经典组学）',
      stops:[[0,'#313695'],[.18,'#4575B4'],[.34,'#ABD9E9'],[.5,'#FFFFBF'],[.66,'#FDAE61'],[.82,'#F46D43'],[1,'#A50026']],
      low:'#313695',mid:'#FFFFBF',high:'#A50026',diagonal:'#7D001D'
    },
    coolwarm: {
      name:'Coolwarm（蓝 – 浅灰 – 红）',
      stops:[[0,'#3B4CC0'],[.25,'#8DB0E2'],[.5,'#F3F3F1'],[.75,'#E88975'],[1,'#B40426']],
      low:'#3B4CC0',mid:'#F3F3F1',high:'#B40426',diagonal:'#86001C'
    },
    navyCreamBrick: {
      name:'Navy – Cream – Brick（低饱和论文风）',
      stops:[[0,'#294A73'],[.25,'#86A8C5'],[.5,'#FAF5DF'],[.75,'#D9966A'],[1,'#A8403B']],
      low:'#294A73',mid:'#FAF5DF',high:'#A8403B',diagonal:'#7D302C'
    },
    blueWhiteRed: {
      name:'Blue – White – Red（相关矩阵经典）',
      stops:[[0,'#2166AC'],[.5,'#F7F7F7'],[1,'#B2182B']],
      low:'#2166AC',mid:'#F7F7F7',high:'#B2182B',diagonal:'#8B0000'
    },
    blueWhiteOrange: {
      name:'Blue – White – Orange（色盲友好）',
      stops:[[0,'#2C7BB6'],[.25,'#ABD9E9'],[.5,'#F7F7F7'],[.75,'#FDAE61'],[1,'#D95F02']],
      low:'#2C7BB6',mid:'#F7F7F7',high:'#D95F02',diagonal:'#A84300'
    },
    blueGrayOrange: {
      name:'Blue – Gray – Orange（色盲友好）',
      stops:[[0,'#0072B2'],[.25,'#70A6C1'],[.5,'#F0F0F0'],[.75,'#E69F69'],[1,'#D55E00']],
      low:'#0072B2',mid:'#F0F0F0',high:'#D55E00',diagonal:'#9B4300'
    },
    tealIvoryBurgundy: {
      name:'Teal – Ivory – Burgundy（柔和发散）',
      stops:[[0,'#246B73'],[.25,'#8FBFC0'],[.5,'#FFF9E9'],[.75,'#D99A96'],[1,'#8E3145']],
      low:'#246B73',mid:'#FFF9E9',high:'#8E3145',diagonal:'#662232'
    },
    custom: {name:'自定义',stops:null,low:null,mid:null,high:null,diagonal:null}
  };
  const GROUP_COLORS=['#3B7A57','#D8892B','#4C78A8','#7A6FA8','#B85C5C','#5C8C8C','#9A7B4F','#65737E'];
  function ensureHeatmapSciSettings(){
    const s=state.gallery.settings;
    if(!['correlation','clustered'].includes(s.heatmapMode))s.heatmapMode='correlation';
    if(!SCI_HEATMAP_PALETTES[s.heatmapPalette])s.heatmapPalette=s.heatmapMode==='clustered'?'paperBlueYellowRed':'blueWhiteRed';
    if(!['none','rows','cols','both'].includes(s.heatmapCluster))s.heatmapCluster='none';
    if(!['average','complete','single','ward'].includes(s.heatmapLinkage))s.heatmapLinkage='average';
    if(!['correlation','euclidean','manhattan'].includes(s.heatmapDistance))s.heatmapDistance='correlation';
    if(!['none','rowZ','columnZ','rowMinMax'].includes(s.heatmapStandardize))s.heatmapStandardize='rowZ';
    if(!['full','lower','upper'].includes(s.heatmapTriangle))s.heatmapTriangle='full';
    // v0.24.4: 相关性热图（Corrplot）强制圆形 + 星号 + 蓝红——清除历史会话残留的 square / 聚类色阶，任何入口进入相关热图都是论文图3 风格；聚类热图保持方形。
    if(s.heatmapMode==='correlation'){
      if(!['circle','lowerCircle','mixed','number'].includes(s.heatmapCellStyle))s.heatmapCellStyle='circle';
      if(s.heatmapShowStars==null)s.heatmapShowStars=true;
      if(s.heatmapClusteredDefaultsApplied){s.heatmapPalette='blueWhiteRed';s.heatmapScaleMode='auto';s.heatmapCluster='both';s.heatmapClusteredDefaultsApplied=false;}
      s.heatmapShowDendrogram=false;
      s.heatmapShowGroupAnnotation=false;
    }else{
      if(!['square','circle','mixed','number'].includes(s.heatmapCellStyle))s.heatmapCellStyle='square';
      if(s.heatmapShowStars==null)s.heatmapShowStars=false;
      if(s.heatmapClusteredDefaultsApplied){s.heatmapShowDendrogram=true;s.heatmapShowGroupAnnotation=true;}
    }
    if(!['left','right'].includes(s.heatmapRowLabelSide))s.heatmapRowLabelSide=s.heatmapMode==='correlation'?'left':'right';
    if(!['auto','always','never'].includes(s.heatmapValueMode))s.heatmapValueMode='auto';
    s.heatmapShowDendrogram=s.heatmapShowDendrogram!==false;
    s.heatmapDendrogramSize=Number.isFinite(Number(s.heatmapDendrogramSize))?Number(s.heatmapDendrogramSize):82;
    s.heatmapRowDendrogramSize=Number.isFinite(Number(s.heatmapRowDendrogramSize))?Number(s.heatmapRowDendrogramSize):112;
    s.heatmapColDendrogramSize=Number.isFinite(Number(s.heatmapColDendrogramSize))?Number(s.heatmapColDendrogramSize):38;
    s.heatmapDendrogramLineWidth=Number.isFinite(Number(s.heatmapDendrogramLineWidth))?Number(s.heatmapDendrogramLineWidth):0.85;
    s.heatmapDendrogramColor=s.heatmapDendrogramColor||'#3f474b';
    s.heatmapCellGap=Number.isFinite(Number(s.heatmapCellGap))?Number(s.heatmapCellGap):0;
    s.heatmapGridStroke=s.heatmapGridStroke||(s.heatmapMode==='correlation'?'#00000055':'#F2F2EE');
    s.heatmapGridStrokeWidth=Number.isFinite(Number(s.heatmapGridStrokeWidth))?Number(s.heatmapGridStrokeWidth):0.28;
    s.heatmapColorBarLength=Number.isFinite(Number(s.heatmapColorBarLength))?Number(s.heatmapColorBarLength):150;
    s.heatmapColorBarThickness=Number.isFinite(Number(s.heatmapColorBarThickness))?Number(s.heatmapColorBarThickness):12;
    // v0.24.5: 图二风格——列标签默认底部、相关模式默认网格、星号位置/大小、色带刻度细分
    s.heatmapColumnLabelSide=['top','bottom'].includes(s.heatmapColumnLabelSide)?s.heatmapColumnLabelSide:'bottom';
    s.heatmapShowGrid=s.heatmapShowGrid!==false;
    s.heatmapStarSize=Number.isFinite(Number(s.heatmapStarSize))?Number(s.heatmapStarSize):Math.max(7,Math.round(Number(s.heatmapValueSize)*.95*10)/10);
    s.heatmapStarPosition=['inside','below','center'].includes(s.heatmapStarPosition)?s.heatmapStarPosition:'below';
    s.heatmapLowerCircleNumber=s.heatmapLowerCircleNumber===true;
    s.heatmapUpperNumberStar=s.heatmapUpperNumberStar===true;
    s.heatmapColorBarStep=Number.isFinite(Number(s.heatmapColorBarStep))?Math.max(.05,Number(s.heatmapColorBarStep)):0.2;
    s.heatmapStarNote=s.heatmapStarNote!==false;
    s.heatmapStarNoteSize=Number.isFinite(Number(s.heatmapStarNoteSize))?Number(s.heatmapStarNoteSize):Math.max(8,Number(s.heatmapValueSize)-1);
    s.heatmapScaleMode=['auto','p15','p20','p25','p30','manual'].includes(s.heatmapScaleMode)?s.heatmapScaleMode:'auto';
    s.heatmapScaleMin=Number.isFinite(Number(s.heatmapScaleMin))?Number(s.heatmapScaleMin):-2;
    s.heatmapScaleCenter=Number.isFinite(Number(s.heatmapScaleCenter))?Number(s.heatmapScaleCenter):0;
    s.heatmapScaleMax=Number.isFinite(Number(s.heatmapScaleMax))?Number(s.heatmapScaleMax):2;
    s.heatmapShowGroupAnnotation=s.heatmapShowGroupAnnotation!==false;
    s.heatmapShowGroupNames=s.heatmapShowGroupNames===true;
    s.heatmapAutoRowLabelFit=s.heatmapAutoRowLabelFit===true;
    s.heatmapAutoColLabelFit=s.heatmapAutoColLabelFit===true;
    s.heatmapColumnLabelAngle=Number.isFinite(Number(s.heatmapColumnLabelAngle))?Number(s.heatmapColumnLabelAngle):45;
    if(typeof s.heatmapCorrelationGroup!=='string')s.heatmapCorrelationGroup='__all__';
    // v0.10.8: cluster heatmaps use the publication-friendly defaults used by
    // common metabolomics / volatile-compound heatmaps: keep experimental
    // sample order, cluster features by default, and use a softer 5-stop scale.
    if(s.heatmapMode==='clustered'&&!s.heatmapV0108DefaultsApplied){
      s.heatmapStandardize='rowZ';
      s.heatmapCluster='rows';
      s.heatmapDistance='euclidean';
      s.heatmapLinkage='ward';
      if(s.heatmapPalette!=='custom')s.heatmapPalette='paperBlueYellowRed';
      s.heatmapRowLabelSide='right';
      s.heatmapValueMode='never';
      s.heatmapShowGroupAnnotation=true;
      s.heatmapCellGap=0;
      s.heatmapGridStroke='#F2F2EE';
      s.heatmapGridStrokeWidth=.28;
      s.heatmapDendrogramSize=82;
      s.heatmapRowDendrogramSize=112;
      s.heatmapColDendrogramSize=38;
      s.heatmapDendrogramLineWidth=.68;
      s.heatmapDendrogramColor='#333333';
      s.heatmapColorBarOrientation='vertical';
      s.heatmapColorBarLength=150;
      s.heatmapColorBarThickness=12;
      s.heatmapShowGroupNames=false;
      s.heatmapAutoRowLabelFit=false;
      s.heatmapAutoColLabelFit=false;
      s.heatmapYLabelSize=7;
      s.heatmapXLabelSize=11;
      s.heatmapColumnLabelAngle=45;
      // Generic gallery defaults put legends near the upper left. Move the
      // heatmap scale to the publication-style upper-right position once.
      s.legendX=Math.max(20,Number(s.width||980)-58);
      s.legendY=54;
      s.heatmapV0108DefaultsApplied=true;
    }
    const p=SCI_HEATMAP_PALETTES[s.heatmapPalette]||SCI_HEATMAP_PALETTES.blueWhiteRed;
    if(s.heatmapPalette!=='custom'){
      s.heatmapLowColor=p.low;s.heatmapMidColor=p.mid;s.heatmapHighColor=p.high;s.heatmapDiagonalColor=p.diagonal;
    }
    return s;
  }
  applyHeatmapPalette=function patchedSciHeatmapPalette(name){
    const p=SCI_HEATMAP_PALETTES[name];if(!p||name==='custom')return;
    const s=state.gallery.settings;s.heatmapPalette=name;s.heatmapLowColor=p.low;s.heatmapMidColor=p.mid;s.heatmapHighColor=p.high;s.heatmapDiagonalColor=p.diagonal;
  };
  heatmapPalettePreview=function patchedHeatmapPalettePreview(){
    const s=ensureHeatmapSciSettings(),p=SCI_HEATMAP_PALETTES[s.heatmapPalette];
    const stops=p?.stops||[[0,s.heatmapLowColor],[.5,s.heatmapMidColor],[1,s.heatmapHighColor]];
    const grad=stops.map(([t,c])=>`${c} ${Math.round(t*100)}%`).join(',');
    const labels=s.heatmapMode==='correlation'?['−1','0','+1']:['Low','0','High'];
    return `<div class="heatmap-palette-preview" style="display:grid;grid-template-columns:1fr;gap:4px"><div style="height:24px;border:1px solid #d7dde0;border-radius:3px;background:linear-gradient(90deg,${grad})"></div><div style="display:flex;justify-content:space-between;font-size:11px"><span>${labels[0]}</span><span>${labels[1]}</span><span>${labels[2]}</span></div></div>`;
  };
  function heatmapCorrelationGroupOptions(){
    const rows=state.gallery.rows||[],groups=[...new Set(rows.map(r=>String(r.Group||'').trim()).filter(Boolean))];
    const opts=[['__all__','全部样本']];groups.forEach(g=>opts.push([g,g]));return opts;
  }
  gallerySpecificPropertyHtml=function patchedHeatmapPropertyHtml(type,id){
    if(type==='heatmap'&&id==='heatmap-scale'){
      const s=ensureHeatmapSciSettings();
      // v0.24.5: 显示模式下拉已删除——热图类型在数据导入处选择
      const statControls=s.heatmapMode==='correlation'
        ? gallerySection('相关矩阵',[
            gSelect('correlationMethod','相关方法',[['pearson','Pearson'],['spearman','Spearman']]),
            gSelect('heatmapCorrelationGroup','样本范围',heatmapCorrelationGroupOptions()),
            gSelect('heatmapTriangle','矩阵显示',[['full','完整矩阵'],['lower','仅下三角'],['upper','仅上三角']])
          ])+gallerySection('图形样式（Corrplot）',[
            gSelect('heatmapCellStyle','格子画法',s.heatmapMode==='correlation'?[['circle','圆形（论文常用）'],['lowerCircle','下三角圆形 + 上三角数字'],['mixed','上三角圆形 + 下三角数字'],['number','纯数字']]:[['square','方形色块'],['circle','圆形'],['mixed','上三角圆形 + 下三角数字'],['number','纯数字']]),
            gCheck('heatmapShowStars','显示显著性星号（* ≤0.05 ** ≤0.01 *** ≤0.001）'),
            gSelect('heatmapStarPosition','星号位置',[['below','圆形下方（论文常用）'],['center','圆内居中'],['inside','数值旁']]),
            gRange('heatmapStarSize','星号大小',6,20,.5),
            gCheck('heatmapLowerCircleNumber','下三角圆形内显示数字'),
            gCheck('heatmapUpperNumberStar','上三角数字旁显示星号')
          ])
        : gallerySection('数据标准化',[
            gSelect('heatmapStandardize','标准化',[['rowZ','Row Z-score（推荐）'],['none','不标准化'],['columnZ','Column Z-score'],['rowMinMax','Row 0–1']])
          ]);
      // v0.24.2: 相关性热图（Corrplot）面板精简——只保留聚类排序；聚类热图保留完整层次聚类。
      const clusterControls=s.heatmapMode==='correlation'
        ? gallerySection('聚类排序',[
            gSelect('heatmapCluster','排序方式',[['none','不聚类（按输入顺序）'],['rows','仅行聚类'],['cols','仅列聚类'],['both','行 + 列聚类']])
          ])
        : gallerySection('层次聚类',[
            gSelect('heatmapCluster','聚类对象',[['none','不聚类'],['rows','仅行 / Feature 聚类（推荐）'],['cols','仅列 / Sample 聚类'],['both','行 + 列聚类']]),
            gSelect('heatmapDistance','距离',[['euclidean','Euclidean（聚类热图推荐）'],['correlation','Correlation distance'],['manhattan','Manhattan']]),
            gSelect('heatmapLinkage','Linkage',[['ward','Ward（推荐；使用 Euclidean）'],['average','Average'],['complete','Complete'],['single','Single']]),
            gCheck('heatmapShowDendrogram','显示聚类树'),
            gRange('heatmapRowDendrogramSize','行聚类树宽度',45,180,2),
            gRange('heatmapColDendrogramSize','列聚类树高度',20,100,2),
            gRange('heatmapDendrogramLineWidth','树线粗细',.35,2,.05),
            gColor('heatmapDendrogramColor','树线颜色')
          ]);
      const paletteControls=gallerySection('SCI 色阶',[
        gSelect('heatmapPalette','色阶方案',Object.entries(SCI_HEATMAP_PALETTES).map(([k,v])=>[k,v.name])),
        heatmapPalettePreview(),
        gHeatColor('heatmapLowColor','低值颜色'),gHeatColor('heatmapMidColor','中间颜色'),gHeatColor('heatmapHighColor','高值颜色')
      ]);
      const scaleControls=s.heatmapMode==='clustered'?gallerySection('色阶范围',[
        gSelect('heatmapScaleMode','色彩饱和范围',[['auto','自动'],['p15','±1.5（高对比）'],['p20','±2.0（常用）'],['p25','±2.5（更柔和）'],['p30','±3.0（低饱和）'],['manual','手动']]),
        gNumber('heatmapScaleMin','最小值',-20,20,.1),gNumber('heatmapScaleCenter','中心值',-20,20,.1),gNumber('heatmapScaleMax','最大值',-20,20,.1)
      ]):'';
      const cellControls=gallerySection('矩阵与标签',[
        gSelect('heatmapValueMode','格内数值',[['auto','自动：小矩阵显示'],['always','始终显示'],['never','隐藏']]),
        gRange('heatmapValueSize','格内数字字号',6,24,1),
        gCheck('heatmapAutoColLabelFit','列标签自动缩小'),
        gRange('heatmapXLabelSize','列标签字号',6,26,.5),
        gSelect('heatmapColumnLabelAngle','列标签角度',[[0,'0°'],[30,'30°'],[45,'45°（推荐）'],[60,'60°'],[90,'90°']]),
        gCheck('heatmapAutoRowLabelFit','行标签自动缩小'),
        gSelect('heatmapColumnLabelSide','列标签位置',[['bottom','底部（论文常用）'],['top','顶部']]),
        gRange('heatmapYLabelSize','行标签字号',5,22,.5),
        gCheck('heatmapShowGrid','显示单元格网格'),
        gSelect('heatmapRowLabelSide','行标签位置',[['right','右侧（组学常用）'],['left','左侧']]),
        (s.heatmapMode==='clustered'?gCheck('heatmapShowGroupAnnotation','显示样本分组注释条'):''),
        (s.heatmapMode==='clustered'?gCheck('heatmapShowGroupNames','在注释条上显示组名'):''),
        gRange('heatmapCellGap','格子间距',0,2,.1),
        gColor('heatmapGridStroke','格子边线颜色'),gRange('heatmapGridStrokeWidth','格子边线粗细',0,1.5,.05)
      ]);
      const note=`<div class="method-badge"><b>推荐：</b>${s.heatmapMode==='clustered'?'Feature × Sample 数据默认使用 Row Z-score、仅 Feature 聚类、Euclidean + Ward，并保留原始样本顺序；这更接近常见代谢组/挥发性化合物论文热图。':'相关系数固定以 0 为中点；对称矩阵如需聚类，行列使用同一叶序。'} 树状图由真实聚类 merge 结果生成并与单元格中心对齐；行树和列树尺寸独立控制。大矩阵建议使用细灰黑树线、隐藏注释条组名，并按需要调节色彩饱和范围。</div>`;
      return statControls+clusterControls+paletteControls+scaleControls+cellControls+note;
    }
    return previousSpecificPropertyHtml(type,id);
  };
  galleryBasePropertyHtml=function patchedHeatmapLegendProperties(id){
    if(id==='legend'&&state.gallery.type==='heatmap'){
      ensureHeatmapSciSettings();
      return gallerySection('色带图例',[
        gCheck('heatmapColorBar','显示色带'),
        gNumber('legendX','水平位置',0,1800,1),gNumber('legendY','垂直位置',0,1200,1),
        gRange('legendFontSize','数字字号',7,30,1),
        gOrientationButtons('heatmapColorBarOrientation','排列方向'),
        gRange('heatmapColorBarLength','色带长度',70,600,5),
        gRange('heatmapColorBarThickness','色带厚度',7,30,1),
        gSelect('heatmapColorBarStep','刻度间隔',[[.1,'0.1'],[.2,'0.2'],[.25,'0.25'],[.5,'0.5'],[1,'1']]),
      ])+galleryDragHint('色带图例');
    }
    return previousBasePropertyHtml(id);
  };
  galleryMethodNoteText=function patchedHeatmapMethodNoteText(){
    const s=ensureHeatmapSciSettings();
    if(state.gallery.type==='heatmap'){
      if(s.heatmapMode==='clustered')return `聚类热图：${s.heatmapStandardize==='rowZ'?'Row Z-score':s.heatmapStandardize==='columnZ'?'Column Z-score':s.heatmapStandardize==='rowMinMax'?'Row 0–1':'原始值'}；${s.heatmapLinkage==='ward'?'Euclidean / Ward':`${s.heatmapDistance} / ${s.heatmapLinkage}`}；${s.heatmapCluster==='rows'?'Feature 聚类，Sample 保持输入顺序':s.heatmapCluster==='both'?'Feature + Sample 聚类':s.heatmapCluster==='cols'?'Sample 聚类':'不聚类'}`;
      const g=s.heatmapCorrelationGroup&&s.heatmapCorrelationGroup!=='__all__'?`；样本组 ${s.heatmapCorrelationGroup}`:'；全部样本';
      return `相关矩阵：${correlationMethodLabel(s.correlationMethod)}${g}；${s.heatmapCluster==='none'?'原始顺序':`${s.heatmapLinkage} linkage 聚类`}`;
    }
    return previousMethodNoteText();
  };
  function hMean(a){const v=a.filter(Number.isFinite);return v.length?v.reduce((x,y)=>x+y,0)/v.length:0}
  function hSd(a){const v=a.filter(Number.isFinite),m=hMean(v);return v.length>1?Math.sqrt(v.reduce((s,x)=>s+(x-m)*(x-m),0)/(v.length-1)):0}
  function hPearson(a,b){
    const pairs=[];for(let i=0;i<Math.min(a.length,b.length);i++)if(Number.isFinite(a[i])&&Number.isFinite(b[i]))pairs.push([a[i],b[i]]);
    if(pairs.length<2)return 0;const x=pairs.map(p=>p[0]),y=pairs.map(p=>p[1]),mx=hMean(x),my=hMean(y),sx=Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)),sy=Math.sqrt(y.reduce((s,v)=>s+(v-my)**2,0));if(!(sx>0&&sy>0))return 0;return x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0)/(sx*sy);
  }
  function hRanks(values){
    const out=Array(values.length).fill(NaN),pairs=values.map((v,i)=>[v,i]).filter(x=>Number.isFinite(x[0])).sort((a,b)=>a[0]-b[0]);
    let i=0;while(i<pairs.length){let j=i+1;while(j<pairs.length&&pairs[j][0]===pairs[i][0])j++;const rank=(i+j-1)/2+1;for(let k=i;k<j;k++)out[pairs[k][1]]=rank;i=j}return out;
  }
  function hSpearman(a,b){
    const pairs=[];for(let i=0;i<Math.min(a.length,b.length);i++)if(Number.isFinite(a[i])&&Number.isFinite(b[i]))pairs.push([a[i],b[i]]);
    if(pairs.length<2)return 0;return hPearson(hRanks(pairs.map(p=>p[0])),hRanks(pairs.map(p=>p[1])));
  }
  function hDistance(a,b,metric){
    const pairs=[];for(let i=0;i<Math.min(a.length,b.length);i++)if(Number.isFinite(a[i])&&Number.isFinite(b[i]))pairs.push([a[i],b[i]]);
    if(!pairs.length)return 1;
    if(metric==='correlation')return Math.max(0,1-hPearson(pairs.map(p=>p[0]),pairs.map(p=>p[1])));
    if(metric==='manhattan')return pairs.reduce((s,p)=>s+Math.abs(p[0]-p[1]),0)/pairs.length;
    return Math.sqrt(pairs.reduce((s,p)=>s+(p[0]-p[1])**2,0)/pairs.length);
  }
  function centroidOf(vectors,leaves){
    const dims=Math.max(0,...leaves.map(i=>vectors[i]?.length||0)),out=[];
    for(let d=0;d<dims;d++){const vals=leaves.map(i=>Number(vectors[i]?.[d])).filter(Number.isFinite);out.push(vals.length?hMean(vals):NaN)}
    return out;
  }
  function wardDistance(A,B,vectors){
    const ca=A.centroid||centroidOf(vectors,A.leaves),cb=B.centroid||centroidOf(vectors,B.leaves),pairs=[];
    for(let i=0;i<Math.min(ca.length,cb.length);i++)if(Number.isFinite(ca[i])&&Number.isFinite(cb[i]))pairs.push([ca[i],cb[i]]);
    if(!pairs.length)return 1;
    const sq=pairs.reduce((s,p)=>s+(p[0]-p[1])**2,0);
    return Math.sqrt((A.leaves.length*B.leaves.length)/(A.leaves.length+B.leaves.length)*sq);
  }
  function hierarchicalCluster(labels,vectors,metric='correlation',linkage='average'){
    if(labels.length<2)return{order:[...labels],tree:null,maxHeight:1};
    const effectiveMetric=linkage==='ward'?'euclidean':metric;
    const baseDist=Array.from({length:labels.length},()=>Array(labels.length).fill(0));
    for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)baseDist[i][j]=baseDist[j][i]=hDistance(vectors[i],vectors[j],effectiveMetric);
    let clusters=labels.map((label,i)=>({leaves:[i],centroid:centroidOf(vectors,[i]),tree:{leaf:true,label,index:i,height:0}}));
    const between=(A,B)=>{
      if(linkage==='ward')return wardDistance(A,B,vectors);
      const ds=[];A.leaves.forEach(i=>B.leaves.forEach(j=>ds.push(baseDist[i][j])));if(!ds.length)return 0;
      if(linkage==='complete')return Math.max(...ds);if(linkage==='single')return Math.min(...ds);return ds.reduce((a,b)=>a+b,0)/ds.length;
    };
    let maxHeight=0;
    while(clusters.length>1){
      let bi=0,bj=1,bd=Infinity;
      for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++){const d=between(clusters[i],clusters[j]);if(d<bd){bd=d;bi=i;bj=j}}
      const A=clusters[bi],B=clusters[bj],leaves=[...A.leaves,...B.leaves],height=Math.max(bd,A.tree.height||0,B.tree.height||0);
      const merged={leaves,centroid:centroidOf(vectors,leaves),tree:{leaf:false,left:A.tree,right:B.tree,height}};
      maxHeight=Math.max(maxHeight,height);clusters=clusters.filter((_,i)=>i!==bi&&i!==bj);clusters.push(merged);
    }
    const order=[];(function walk(n){if(!n)return;if(n.leaf){order.push(labels[n.index]);return}walk(n.left);walk(n.right)})(clusters[0].tree);
    return{order,tree:clusters[0].tree,maxHeight:maxHeight||1};
  }
  // Draw every merge as one continuous U-shaped SVG path.  The previous
  // renderer emitted three independent <line> elements per merge; at dense
  // scales anti-aliasing and sub-pixel rounding made branches appear broken.
  function dendrogramSvg(tree,order,positions,base,extent,orientation,color,width){
    if(!tree||!order.length)return'';
    const index=new Map(order.map((x,i)=>[x,i]));
    const maxH=(function maxHeight(n){return !n||n.leaf?0:Math.max(Number(n.height)||0,maxHeight(n.left),maxHeight(n.right))})(tree)||1;
    let out=`<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="butt" stroke-linejoin="miter" vector-effect="non-scaling-stroke" shape-rendering="geometricPrecision">`;
    function walk(node){
      if(node.leaf){const i=index.get(node.label);return{pos:positions[i],level:base};}
      const L=walk(node.left),R=walk(node.right),d=clamp((Number(node.height)||0)/maxH,0,1),level=base-d*extent;
      if(orientation==='top')out+=`<path d="M ${L.pos} ${L.level} V ${level} H ${R.pos} V ${R.level}"/>`;
      else out+=`<path d="M ${L.level} ${L.pos} H ${level} V ${R.pos} H ${R.level}"/>`;
      return{pos:(L.pos+R.pos)/2,level};
    }
    walk(tree);return out+'</g>';
  }
  function transformMatrix(matrix,mode){
    const out=matrix.map(r=>r.slice());if(mode==='none')return out;
    if(mode==='rowZ'||mode==='rowMinMax')return out.map(row=>{const vals=row.filter(Number.isFinite);if(!vals.length)return row.map(()=>0);if(mode==='rowMinMax'){const mn=Math.min(...vals),mx=Math.max(...vals);return row.map(v=>Number.isFinite(v)?(v-mn)/(mx-mn||1):NaN)}const m=hMean(vals),sd=hSd(vals)||1;return row.map(v=>Number.isFinite(v)?(v-m)/sd:NaN)});
    if(mode==='columnZ'){
      const cols=Math.max(0,...out.map(r=>r.length));for(let j=0;j<cols;j++){const vals=out.map(r=>r[j]).filter(Number.isFinite),m=hMean(vals),sd=hSd(vals)||1;out.forEach(r=>{if(Number.isFinite(r[j]))r[j]=(r[j]-m)/sd})}return out;
    }
    return out;
  }
  function quantileAbs(values,p=.98){const a=values.filter(Number.isFinite).map(Math.abs).sort((x,y)=>x-y);if(!a.length)return 1;const i=Math.min(a.length-1,Math.floor((a.length-1)*p));return a[i]||1}
  /* ===== v0.24.0 Corrplot：相关性显著性 =====
   * p 值：t = r*sqrt((n-2)/(1-r^2))，df=n-2，双尾；t 分布 CDF 用不完全
   * beta 函数（连分式）精确计算。
   */
  function hmGammaLn(x){
    const cof=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,.1208650973866179e-2,-.5395239384953e-5];
    let y=x,t=x+5.5;let s=0.9999999999998099;
    for(let i=0;i<6;i++)s+=cof[i]/++y;
    return Math.log(2.5066282746310005*s/x)-t+Math.log(t)*(x+.5);
  }
  function hmBetaCF(a,b,x){
    const MAXIT=200,EPS=3e-12,FPMIN=1e-300,qab=a+b,qap=a+1,qam=a-1;
    let c=1,d=1-qab*x/qap;d=Math.abs(d)<FPMIN?FPMIN:d;d=1/d;let h=d;
    for(let m=1;m<=MAXIT;m++){
      const m2=2*m,aa1=m*(b-m)*x/((qam+m2)*(a+m2));
      d=1+aa1*d;d=Math.abs(d)<FPMIN?FPMIN:d;c=1+aa1/c;c=Math.abs(c)<FPMIN?FPMIN:c;d=1/d;h*=d*c;
      const aa2=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
      d=1+aa2*d;d=Math.abs(d)<FPMIN?FPMIN:d;c=1+aa2/c;c=Math.abs(c)<FPMIN?FPMIN:c;d=1/d;const del=d*c;h*=del;
      if(Math.abs(del-1)<EPS)break;
    }
    return h;
  }
  function hmRbeta(x,a,b){
    if(x<=0)return 0;if(x>=1)return 1;
    const lb=hmGammaLn(a)+hmGammaLn(b)-hmGammaLn(a+b),bt=Math.exp(a*Math.log(x)+b*Math.log(1-x)-lb);
    return x<(a+1)/(a+b+2)?bt*hmBetaCF(a,b,x)/a:1-bt*hmBetaCF(b,a,1-x)/b;
  }
  function hmTCdf(t,df){
    if(!Number.isFinite(t))return NaN;
    const x=df/(df+t*t);
    return t>0?1-0.5*hmRbeta(x,df/2,.5):0.5*hmRbeta(x,df/2,.5);
  }
  function correlationPValue(r,n){
    if(!Number.isFinite(r))return NaN;
    if(Math.abs(r)>=1)return 0;
    const df=n-2;
    if(df<=0)return NaN;
    const t=Math.abs(r)*Math.sqrt(df/(1-r*r));
    return 2*(1-hmTCdf(t,df));
  }
  function hmCorrStars(p){return p<=.001?'***':p<=.01?'**':p<=.05?'*':''}
  function heatmapModel(){
    const s=ensureHeatmapSciSettings(),a=state.gallery.analysis;
    if(s.heatmapMode==='correlation'){
      const labels=a?.vars?.slice?.()||[],allRows=state.gallery.rows||[];
      const selected=s.heatmapCorrelationGroup&&s.heatmapCorrelationGroup!=='__all__'?allRows.filter(r=>String(r.Group||'').trim()===s.heatmapCorrelationGroup):allRows;
      const n=selected.length||allRows.length;
      const corrFn=s.correlationMethod==='spearman'?hSpearman:hPearson;
      const corrValue=(r,c)=>{if(selected.length){const x=selected.map(row=>Number(row[r])),y=selected.map(row=>Number(row[c]));return r===c?1:corrFn(x,y)}return Number(a.corr?.[r]?.[c])};
      const pValue=(r,c)=>{const rv=r===c?1:corrValue(r,c);if(!Number.isFinite(rv))return NaN;if(Math.abs(rv)>=1)return 0;return n>2?correlationPValue(rv,n):NaN};
      let matrix=labels.map(r=>labels.map(c=>corrValue(r,c))),pMatrix=labels.map(r=>labels.map(c=>pValue(r,c))),rowLabels=labels.slice(),colLabels=labels.slice(),rowTree=null,colTree=null;
      if(s.heatmapCluster!=='none'){
        const cl=hierarchicalCluster(labels,matrix.map(r=>r.slice()),s.heatmapDistance,s.heatmapLinkage);
        if(s.heatmapCluster==='rows'||s.heatmapCluster==='both'){rowLabels=cl.order.slice();rowTree=cl.tree}
        if(s.heatmapCluster==='cols'||s.heatmapCluster==='both'){colLabels=cl.order.slice();colTree=cl.tree}
        if(s.heatmapCluster==='both'){rowLabels=cl.order.slice();colLabels=cl.order.slice();rowTree=cl.tree;colTree=cl.tree}
        matrix=rowLabels.map(r=>colLabels.map(c=>corrValue(r,c)));
        pMatrix=rowLabels.map(r=>colLabels.map(c=>pValue(r,c)));
      }
      return{rowLabels,colLabels,matrix,pMatrix,rowTree,colTree,min:-1,center:0,max:1,correlation:true};
    }
    const source=state.gallery.rows||[],vars=a?.vars?.slice?.()||[],sampleLabels=source.map((r,i)=>String(r.SampleID||`S${i+1}`));
    let colGroups=source.map(r=>String(r.Group||'All')),matrix=vars.map(v=>source.map(r=>Number(r[v])));matrix=transformMatrix(matrix,s.heatmapStandardize);
    let rowLabels=vars.slice(),colLabels=sampleLabels.slice(),rowTree=null,colTree=null;
    if(s.heatmapCluster==='rows'||s.heatmapCluster==='both'){
      const cl=hierarchicalCluster(rowLabels,matrix,s.heatmapDistance,s.heatmapLinkage);rowTree=cl.tree;const idx=new Map(rowLabels.map((x,i)=>[x,i]));matrix=cl.order.map(x=>matrix[idx.get(x)]);rowLabels=cl.order;
    }
    if(s.heatmapCluster==='cols'||s.heatmapCluster==='both'){
      const vectors=colLabels.map((_,j)=>matrix.map(r=>r[j])),cl=hierarchicalCluster(colLabels,vectors,s.heatmapDistance,s.heatmapLinkage),idx=new Map(colLabels.map((x,i)=>[x,i]));
      matrix=matrix.map(r=>cl.order.map(x=>r[idx.get(x)]));colGroups=cl.order.map(x=>colGroups[idx.get(x)]);colLabels=cl.order;colTree=cl.tree;
    }
    const vals=matrix.flat().filter(Number.isFinite);let min,max,center=0;
    if(s.heatmapScaleMode==='manual'){min=Number(s.heatmapScaleMin);center=Number(s.heatmapScaleCenter);max=Number(s.heatmapScaleMax)}
    else if(['p15','p20','p25','p30'].includes(s.heatmapScaleMode)){const lim=({p15:1.5,p20:2,p25:2.5,p30:3})[s.heatmapScaleMode];min=-lim;max=lim;center=0}
    else if(s.heatmapStandardize==='rowMinMax'){min=0;center=.5;max=1}
    else if(['rowZ','columnZ'].includes(s.heatmapStandardize)){const q=quantileAbs(vals,.985),lim=Math.min(3.5,Math.max(2,Math.ceil(q*2)/2));min=-lim;max=lim;center=0}
    else{min=Math.min(...vals,0);max=Math.max(...vals,1);center=min<0&&max>0?0:(min+max)/2}
    if(!(max>min)){max=min+1;center=(min+max)/2}
    return{rowLabels,colLabels,colGroups,matrix,rowTree,colTree,min,center,max,correlation:false};
  }
  function colorFromStops(t,stops){
    const x=clamp(t,0,1);if(!stops?.length)return'#eeeeee';
    for(let i=1;i<stops.length;i++)if(x<=stops[i][0]){const [t0,c0]=stops[i-1],[t1,c1]=stops[i],u=(x-t0)/(t1-t0||1);return blendHex(c0,c1,clamp(u,0,1))}
    return stops[stops.length-1][1];
  }
  function heatColorScaled(v,min,center,max){
    const s=ensureHeatmapSciSettings();if(!Number.isFinite(v))return'#eeeeee';
    const palette=SCI_HEATMAP_PALETTES[s.heatmapPalette];
    if(s.heatmapPalette!=='custom'&&palette?.stops){const t=v<=center?.5*(v-min)/(center-min||1):.5+.5*(v-center)/(max-center||1);return colorFromStops(t,palette.stops)}
    if(v<=center){const t=(v-min)/(center-min||1);return blendHex(s.heatmapLowColor,s.heatmapMidColor,clamp(t,0,1))}
    const t=(v-center)/(max-center||1);return blendHex(s.heatmapMidColor,s.heatmapHighColor,clamp(t,0,1));
  }
  heatColor=function patchedHeatColor(v,diagonal=false){const s=ensureHeatmapSciSettings();if(diagonal&&s.heatmapMode==='correlation')return s.heatmapDiagonalColor||s.heatmapHighColor;const m=heatmapModel();return heatColorScaled(v,m.min,m.center,m.max)};
  heatmapColorBar=function patchedHeatmapColorBar(W,H,model=null){
    const s=ensureHeatmapSciSettings();if(!s.heatmapColorBar)return'';const m=model||heatmapModel(),x=s.legendX??W-58,y=s.legendY??54,horizontal=s.heatmapColorBarOrientation!=='vertical',steps=120,len=s.heatmapColorBarLength,th=s.heatmapColorBarThickness,fs=Math.max(8,Number(s.legendFontSize)-1),step=Math.max(.05,Number(s.heatmapColorBarStep)||.2);let out=`<g data-gobject="legend" data-gdrag="legend" class="chart-object draggable" transform="translate(${x} ${y})">`;
    if(horizontal){
      for(let i=0;i<steps;i++){const t=i/(steps-1),v=m.min+(m.max-m.min)*t;out+=`<rect x="${i*len/steps}" y="0" width="${len/steps+.5}" height="${th}" fill="${heatColorScaled(v,m.min,m.center,m.max)}"/>`}
      let ticks='';for(let v=m.min;v<=m.max+1e-9;v+=step){const t=clamp((v-m.min)/(m.max-m.min||1),0,1),lb=(+v.toFixed(3)).toString();ticks+=`<text x="${t*len}" y="${th+fs+3}" text-anchor="${t<.02?'start':t>.98?'end':'middle'}" font-size="${fs}">${lb}</text>`}out+=`<rect width="${len}" height="${th}" fill="none" stroke="#50585c" stroke-width=".65"/>${ticks}`;
    }else{
      for(let i=0;i<steps;i++){const t=i/(steps-1),v=m.max-(m.max-m.min)*t;out+=`<rect x="0" y="${i*len/steps}" width="${th}" height="${len/steps+.5}" fill="${heatColorScaled(v,m.min,m.center,m.max)}"/>`}
      let ticks='';for(let v=m.min;v<=m.max+1e-9;v+=step){const t=clamp((v-m.min)/(m.max-m.min||1),0,1),lb=(+v.toFixed(3)).toString();ticks+=`<text x="${th+7}" y="${(1-t)*len+fs*.35}" font-size="${fs}">${lb}</text>`}out+=`<rect width="${th}" height="${len}" fill="none" stroke="#50585c" stroke-width=".65"/>${ticks}`;
    }
    return out+'</g>';
  };
  function groupRuns(groups){
    const out=[];if(!groups?.length)return out;let start=0,current=groups[0];
    for(let i=1;i<=groups.length;i++){if(i===groups.length||groups[i]!==current){out.push({group:current,start,end:i-1});start=i;current=groups[i]}}
    return out;
  }
  function clusteredHeatmapSvg(W,H,s,m){
    const rows=m.rowLabels,cols=m.colLabels,showRowDen=s.heatmapShowDendrogram&&(s.heatmapCluster==='rows'||s.heatmapCluster==='both')&&m.rowTree,showColDen=s.heatmapShowDendrogram&&(s.heatmapCluster==='cols'||s.heatmapCluster==='both')&&m.colTree;
    const rowDen=showRowDen?Number(s.heatmapRowDendrogramSize):0,colDen=showColDen?Number(s.heatmapColDendrogramSize):0;
    const leftBase=28,rowLabelEstimate=Math.max(...rows.map(x=>String(x).length),4)*Math.max(6,Number(s.heatmapYLabelSize))*.54;
    const rightLabelSpace=s.heatmapRowLabelSide==='right'?Math.min(260,Math.max(95,rowLabelEstimate+18)):18;
    const leftLabelSpace=s.heatmapRowLabelSide==='left'?Math.min(240,Math.max(90,rowLabelEstimate+18)):16;
    const colorBarReserve=s.heatmapColorBar&&s.heatmapColorBarOrientation==='vertical'?54:12;
    const x0=leftBase+leftLabelSpace+rowDen+8;
    const annotationH=s.heatmapShowGroupAnnotation?7:0;
    const topBase=30+(showColDen?colDen+8:0)+(annotationH?annotationH+5:0);
    const bottomReserve=82;
    const maxW=Math.max(100,W-x0-rightLabelSpace-colorBarReserve-22),maxH=Math.max(120,H-topBase-bottomReserve);
    const cellW=maxW/cols.length,cellH=maxH/rows.length,y0=topBase;
    const heatW=cellW*cols.length,heatH=cellH*rows.length,xCenters=cols.map((_,j)=>x0+(j+.5)*cellW),yCenters=rows.map((_,i)=>y0+(i+.5)*cellH);
    const yLabelSize=s.heatmapAutoRowLabelFit?Math.min(Number(s.heatmapYLabelSize),Math.max(5,cellH*.78)):Number(s.heatmapYLabelSize);
    const xLabelSize=s.heatmapAutoColLabelFit?Math.min(Number(s.heatmapXLabelSize),Math.max(6.5,Math.min(12,cellW*.30+5))):Number(s.heatmapXLabelSize);
    let body='';
    if(s.heatmapShowGroupAnnotation&&m.colGroups?.length){
      const unique=[...new Set(m.colGroups)],gmap=new Map(unique.map((g,i)=>[g,GROUP_COLORS[i%GROUP_COLORS.length]]));
      const barY=y0-annotationH-1;
      m.colGroups.forEach((g,j)=>{body+=`<rect x="${x0+j*cellW}" y="${barY}" width="${cellW+.15}" height="${annotationH}" fill="${gmap.get(g)}"/>`});
      if(s.heatmapShowGroupNames&&!showColDen){groupRuns(m.colGroups).forEach(run=>{const center=x0+(run.start+run.end+1)*cellW/2,w=(run.end-run.start+1)*cellW,fs=Math.min(10,Math.max(6.5,w/(String(run.group).length*.62+1)));body+=`<text x="${center}" y="${barY-4}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${gmap.get(run.group)}">${esc(run.group)}</text>`})}
    }
    if(showColDen){const treeBase=y0-annotationH-5;body+=`<g data-gobject="heatmap-scale" class="chart-object">${dendrogramSvg(m.colTree,cols,xCenters,treeBase,Math.max(10,colDen),'top',s.heatmapDendrogramColor,s.heatmapDendrogramLineWidth)}</g>`}
    if(showRowDen)body+=`<g data-gobject="heatmap-scale" class="chart-object">${dendrogramSvg(m.rowTree,rows,yCenters,x0-6,Math.max(20,rowDen-8),'left',s.heatmapDendrogramColor,s.heatmapDendrogramLineWidth)}</g>`;
    rows.forEach((v,i)=>{
      const y=yCenters[i]+yLabelSize*.34,labelX=s.heatmapRowLabelSide==='right'?x0+heatW+8:x0-8,anchor=s.heatmapRowLabelSide==='right'?'start':'end';
      body+=`<text x="${labelX}" y="${y}" text-anchor="${anchor}" font-size="${yLabelSize}" font-weight="${s.yTickWeight}" fill="${s.yTickColor}">${esc(v)}</text>`;
      cols.forEach((w,j)=>{const value=m.matrix[i]?.[j],x=x0+j*cellW,yc=y0+i*cellH,gap=Math.min(Number(s.heatmapCellGap)||0,Math.min(cellW,cellH)*.16),color=heatColorScaled(value,m.min,m.center,m.max);body+=`<rect x="${x+gap/2}" y="${yc+gap/2}" width="${Math.max(0,cellW-gap)}" height="${Math.max(0,cellH-gap)}" fill="${color}" stroke="${s.heatmapGridStroke}" stroke-width="${s.heatmapGridStrokeWidth}" shape-rendering="crispEdges"/>`;const showValue=s.heatmapValueMode==='always'||(s.heatmapValueMode==='auto'&&rows.length<=12&&cols.length<=12);if(showValue){const rgb=hexRgb(color),lum=.299*rgb[0]+.587*rgb[1]+.114*rgb[2];body+=`<text x="${x+cellW/2}" y="${yc+cellH/2+Number(s.heatmapValueSize)*.34}" text-anchor="middle" font-size="${s.heatmapValueSize}" fill="${lum<145?'white':'#222'}">${formatNumber(value,2)}</text>`}}
      );
    });
    // Publication layout: sample labels sit below the matrix, not on top of
    // the annotation strip. This avoids the three-layer collision seen in
    // the previous version.
    const labelY=y0+heatH+14,angle=-Math.abs(Number(s.heatmapColumnLabelAngle)||0);
    cols.forEach((v,j)=>{const x=xCenters[j];body+=`<text x="${x}" y="${labelY}" text-anchor="end" font-size="${xLabelSize}" font-weight="${s.xTickWeight}" fill="${s.xTickColor}" transform="rotate(${angle} ${x} ${labelY})">${esc(v)}</text>`});
    return `<g data-gobject="heatmap-scale" class="chart-object">${body}</g>${heatmapColorBar(W,H,m)}`;
  }
  function correlationHeatmapSvg(W,H,s,m){
    const rows=m.rowLabels,cols=m.colLabels,showDen=s.heatmapShowDendrogram&&s.heatmapCluster!=='none',rowDen=showDen&&(s.heatmapCluster==='rows'||s.heatmapCluster==='both')?Number(s.heatmapRowDendrogramSize):0,colDen=showDen&&(s.heatmapCluster==='cols'||s.heatmapCluster==='both')?Number(s.heatmapColDendrogramSize):0;
    const leftLabelSpace=s.heatmapRowLabelSide==='left'?Math.min(180,Math.max(75,Math.max(...rows.map(x=>String(x).length))*Number(s.heatmapYLabelSize)*.55)):18;
    const rightLabelSpace=s.heatmapRowLabelSide==='right'?Math.min(200,Math.max(80,Math.max(...rows.map(x=>String(x).length))*Number(s.heatmapYLabelSize)*.55)):20;
        const rawX0=42+leftLabelSpace+rowDen,baseY0=48+colDen+54,maxW=Math.max(100,W-rawX0-rightLabelSpace-95),maxH=Math.max(100,H-baseY0-80),side=Math.min(maxW,maxH),x0=Math.max(rawX0,Math.min((W-70-side)/2,W-70-side)),y0=Math.max(baseY0,(H-80-side)/2),cellW=side/cols.length,cellH=side/rows.length;
    const xCenters=cols.map((_,j)=>x0+(j+.5)*cellW),yCenters=rows.map((_,i)=>y0+(i+.5)*cellH);let body='';
    if(showDen&&m.colTree&&(s.heatmapCluster==='cols'||s.heatmapCluster==='both'))body+=`<g data-gobject="heatmap-scale" class="chart-object">${dendrogramSvg(m.colTree,cols,xCenters,y0-7,colDen-9,'top',s.heatmapDendrogramColor,s.heatmapDendrogramLineWidth)}</g>`;
    if(showDen&&m.rowTree&&(s.heatmapCluster==='rows'||s.heatmapCluster==='both'))body+=`<g data-gobject="heatmap-scale" class="chart-object">${dendrogramSvg(m.rowTree,rows,yCenters,x0-6,rowDen-9,'left',s.heatmapDendrogramColor,s.heatmapDendrogramLineWidth)}</g>`;
    if(s.heatmapShowGrid){const gw=Math.min(.6,Number(s.heatmapGridStrokeWidth)||.3),gcol=s.heatmapGridStroke;for(let j=0;j<=cols.length;j++){const gx=x0+j*cellW;body+=`<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y0+side}" stroke="${gcol}" stroke-width="${gw}"/>`}for(let i=0;i<=rows.length;i++){const gy=y0+i*cellH;body+=`<line x1="${x0}" y1="${gy}" x2="${x0+side}" y2="${gy}" stroke="${gcol}" stroke-width="${gw}"/>`}}
    const colLabelsBottom=s.heatmapColumnLabelSide==='bottom';cols.forEach((v,j)=>{const x=xCenters[j],y=colLabelsBottom?y0+side+16:y0-10;body+=`<text x="${x}" y="${y}" text-anchor="${colLabelsBottom?'end':'start'}" font-size="${s.heatmapXLabelSize}" font-weight="${s.xTickWeight}" fill="${s.xTickColor}" transform="rotate(${-Math.abs(Number(s.heatmapColumnLabelAngle)||0)} ${x} ${y})">${esc(v)}</text>`});
    rows.forEach((v,i)=>{const y=yCenters[i]+Number(s.heatmapYLabelSize)*.34,labelX=s.heatmapRowLabelSide==='right'?x0+side+8:x0-8,anchor=s.heatmapRowLabelSide==='right'?'start':'end';body+=`<text x="${labelX}" y="${y}" text-anchor="${anchor}" font-size="${s.heatmapYLabelSize}" font-weight="${s.yTickWeight}" fill="${s.yTickColor}">${esc(v)}</text>`;
      cols.forEach((w,j)=>{
        if(s.heatmapTriangle!=='full'){if((s.heatmapTriangle==='lower'&&j>i)||(s.heatmapTriangle==='upper'&&j<i))return}
        const value=m.matrix[i]?.[j],p=m.pMatrix?.[i]?.[j],x=x0+j*cellW,yc=y0+i*cellH,gap=Math.min(Number(s.heatmapCellGap)||0,Math.min(cellW,cellH)*.16),isDiag=v===w,color=isDiag?s.heatmapDiagonalColor:heatColorScaled(value,m.min,m.center,m.max),style=s.heatmapCellStyle||'square';
        // v0.24.0 Corrplot：圆形 / 混合 / 纯数字 + 显著性星号
        const useCircle=style==='circle'||(style==='mixed'&&j>=i)||(style==='lowerCircle'&&j<=i),showShape=style!=='number'&&(useCircle||style==='square');
        if(showShape){
          if(useCircle){const R=Math.abs(value)<=0.02?0:Math.min(Math.max(cellW/2*Math.abs(value),.5),cellW/2-gap/2);if(R>0)body+=`<circle cx="${x+cellW/2}" cy="${yc+cellH/2}" r="${R}" fill="${color}" stroke="${s.heatmapGridStroke}" stroke-width="${s.heatmapGridStrokeWidth}"/>`}
          else body+=`<rect x="${x+gap/2}" y="${yc+gap/2}" width="${Math.max(0,cellW-gap)}" height="${Math.max(0,cellH-gap)}" fill="${color}" stroke="${s.heatmapGridStroke}" stroke-width="${s.heatmapGridStrokeWidth}"/>`;
        }
        const lowerCircleCell=style==='lowerCircle'&&j<=i;
        const starText=s.heatmapShowStars&&Number.isFinite(p)&&!((style==='lowerCircle'&&j>i)&&!s.heatmapUpperNumberStar)?hmCorrStars(p):'';
        const showValue=s.heatmapValueMode==='always'||(s.heatmapValueMode==='auto'&&rows.length<=12&&cols.length<=12);
        const showNum=showValue&&!((lowerCircleCell&&!s.heatmapLowerCircleNumber)||(style==='mixed'&&j<i));
        const starFs=Number(s.heatmapStarSize)||Number(s.heatmapValueSize);
        const starBelow=s.heatmapStarPosition==='below'&&starText;
        if(showNum){const rgb=hexRgb(color),lum=.299*rgb[0]+.587*rgb[1]+.114*rgb[2],numFs=Number(s.heatmapValueSize),nt=formatNumber(value,2),nx=x+cellW/2,ny=yc+cellH/2+numFs*.34,nfill=showShape&&style!=='number'?(lum<145?'white':'#222'):color;if(starText&&!starBelow){const numW=nt.length*numFs*.62,starX=nx+numW/2+numFs*.4;body+=`<text x="${nx}" y="${ny}" text-anchor="middle" font-size="${numFs}" fill="${nfill}">${nt}</text><text x="${starX}" y="${ny-numFs*.34+starFs*.46}" text-anchor="middle" font-size="${starFs}" fill="${style==='number'?color:'#333'}">${starText}</text>`}else{body+=`<text x="${nx}" y="${ny}" text-anchor="middle" font-size="${numFs}" fill="${nfill}">${nt}</text>`}}
        else if(starText&&s.heatmapStarPosition!=='below')body+=`<text x="${x+cellW/2}" y="${yc+cellH/2+starFs*.46}" text-anchor="middle" font-size="${starFs}" fill="${style==='number'?color:'#222'}">${starText}</text>`
        if(starBelow)body+=`<text x="${x+cellW/2}" y="${yc+cellH/2+starFs*1.6}" text-anchor="middle" font-size="${starFs}" font-weight="600" fill="#333">${starText}</text>`;
      }
      );
    });
    if(s.heatmapShowStars&&s.heatmapStarNote!==false){const noteFs=Number(s.heatmapStarNoteSize)||Math.max(8,Number(s.heatmapValueSize)-1),noteY=colLabelsBottom?y0+side+18+Number(s.heatmapXLabelSize)*1.35+noteFs:y0+side+14;body+=`<text x="${x0}" y="${noteY}" font-size="${noteFs}" fill="#666">* p≤0.05, ** p≤0.01, *** p≤0.001</text>`}
    return `<g data-gobject="heatmap-scale" class="chart-object">${body}</g>${heatmapColorBar(W,H,m)}`;
  }
  galleryHeatmap=function patchedPublicationHeatmap(W,H){
    const s=ensureHeatmapSciSettings(),m=heatmapModel();if(!m.rowLabels.length||!m.colLabels.length)return'';
    return m.correlation?correlationHeatmapSvg(W,H,s,m):clusteredHeatmapSvg(W,H,s,m);
  };

  ensureHeatmapSciSettings();
})();

/* ===== Integrated v0.10.9 heatmap display fix ===== */
/*
 * FoodLab Studio v0.10.9 — integrated heatmap dendrogram/label layout fix
 * Scope: heatmap display only. No clustering/statistics/import/other-chart logic changed.
 */
(() => {
  const VERSION = '0.10.10';

  function settings() {
    return (typeof state !== 'undefined' && state.gallery && state.gallery.settings)
      ? state.gallery.settings
      : null;
  }

  function ensureSettings() {
    const s = settings();
    if (!s) return null;

    if (!['linear', 'sqrt', 'balanced'].includes(s.heatmapDendrogramScale)) {
      s.heatmapDendrogramScale = 'sqrt';
    }
    if (!Number.isFinite(Number(s.heatmapDendrogramLabelGap))) {
      s.heatmapDendrogramLabelGap = 10;
    }
    s.heatmapDendrogramLabelGap = Math.max(0, Math.min(30, Number(s.heatmapDendrogramLabelGap)));

    // v0.10.8's clustered-heatmap import path resets the row-label size to 7.
    // Raise that old default once unless the user has explicitly changed the slider.
    if (!s.heatmapV0109UserYLabel && Number(s.heatmapYLabelSize) <= 7) {
      s.heatmapYLabelSize = 9;
    }
    if (!s.heatmapV0109UserXLabel && (!Number.isFinite(Number(s.heatmapXLabelSize)) || Number(s.heatmapXLabelSize) < 9)) {
      s.heatmapXLabelSize = 11;
    }

    return s;
  }

  function scaleDistance(d, mode) {
    const x = Math.max(0, Math.min(1, Number(d) || 0));
    if (mode === 'sqrt') return Math.sqrt(x);
    if (mode === 'balanced') return Math.log1p(99 * x) / Math.log(100);
    return x;
  }

  // Build a monotonic mapper from the ACTUAL merge levels in this tree.
  // The old mapping only transformed absolute distance (e.g. sqrt), therefore
  // an unusually large last linkage gap could still consume most of the tree.
  // Here we redistribute the available dendrogram extent across consecutive
  // merge levels and cap the visual share of any single gap.  Clustering,
  // linkage heights and leaf order are untouched; only SVG coordinates change.
  function buildMergeLevelMapper(levels, base, extent, mode, orientation) {
    if (mode === 'linear') return d => Math.max(0, Math.min(1, Number(d) || 0));

    const raw = [0];
    levels.forEach(level => {
      const d = Math.max(0, Math.min(1, (base - level) / extent));
      if (d > 1e-7) raw.push(d);
    });
    raw.push(1);
    raw.sort((a, b) => a - b);

    // De-duplicate merge heights; repeated merges at the same linkage height
    // should remain at exactly the same displayed coordinate.
    const xs = [];
    raw.forEach(v => {
      if (!xs.length || Math.abs(v - xs[xs.length - 1]) > 1e-6) xs.push(v);
    });
    if (xs.length <= 2) return d => scaleDistance(d, mode);

    const gamma = mode === 'balanced' ? 0.26 : 0.48;
    const requestedCap = orientation === 'top'
      ? (mode === 'balanced' ? 0.30 : 0.36)
      : (mode === 'balanced' ? 0.27 : 0.33);
    const gaps = [];
    for (let i = 1; i < xs.length; i++) gaps.push(Math.max(1e-9, xs[i] - xs[i - 1]));
    const weights = gaps.map(g => Math.pow(g, gamma));

    // A cap smaller than 1/N is mathematically impossible, so adapt only for
    // very tiny trees while keeping the intended cap for normal heatmaps.
    const maxShare = Math.max(requestedCap, 1 / gaps.length + 0.002);
    const shares = new Array(weights.length).fill(0);
    const free = new Set(weights.map((_, i) => i));
    let remaining = 1;

    // Water-filling: cap any oversized interval and redistribute the released
    // width/height among the other intervals in proportion to their weights.
    while (free.size) {
      const totalW = [...free].reduce((sum, i) => sum + weights[i], 0) || free.size;
      let cappedAny = false;
      for (const i of [...free]) {
        const proposed = remaining * (weights[i] / totalW);
        if (proposed > maxShare + 1e-9) {
          shares[i] = maxShare;
          remaining -= maxShare;
          free.delete(i);
          cappedAny = true;
        }
      }
      if (!cappedAny) {
        const denom = [...free].reduce((sum, i) => sum + weights[i], 0) || free.size;
        for (const i of free) shares[i] = remaining * (weights[i] / denom);
        remaining = 0;
        free.clear();
      }
    }

    const ys = [0];
    for (const share of shares) ys.push(ys[ys.length - 1] + share);
    ys[ys.length - 1] = 1;

    return d0 => {
      const d = Math.max(0, Math.min(1, Number(d0) || 0));
      if (d <= xs[0]) return ys[0];
      if (d >= xs[xs.length - 1]) return 1;
      let lo = 0, hi = xs.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= d) lo = mid; else hi = mid;
      }
      const span = xs[hi] - xs[lo] || 1;
      const t = (d - xs[lo]) / span;
      return ys[lo] + t * (ys[hi] - ys[lo]);
    };
  }

  const NUM = '[-+]?(?:\\d*\\.?\\d+)(?:[eE][-+]?\\d+)?';
  const TOP_RE = new RegExp(`^\\s*M\\s*(${NUM})[ ,]+(${NUM})\\s*V\\s*(${NUM})\\s*H\\s*(${NUM})\\s*V\\s*(${NUM})\\s*$`);
  const LEFT_RE = new RegExp(`^\\s*M\\s*(${NUM})[ ,]+(${NUM})\\s*H\\s*(${NUM})\\s*V\\s*(${NUM})\\s*H\\s*(${NUM})\\s*$`);

  function fmt(n) {
    const x = Math.abs(n) < 1e-9 ? 0 : n;
    return String(Number(x.toFixed(4)));
  }

  function remapDendrogramGroup(group, mode, topGap) {
    const paths = [...group.querySelectorAll('path[d]')];
    if (!paths.length) return;

    const firstD = paths[0].getAttribute('d') || '';
    const isTop = TOP_RE.test(firstD);
    const isLeft = !isTop && LEFT_RE.test(firstD);
    if (!isTop && !isLeft) return;

    const parsed = [];
    const axisValues = [];
    for (const path of paths) {
      const d = path.getAttribute('d') || '';
      const m = (isTop ? TOP_RE : LEFT_RE).exec(d);
      if (!m) continue;
      const v = m.slice(1).map(Number);
      parsed.push([path, v]);
      if (isTop) axisValues.push(v[1], v[2], v[4]);
      else axisValues.push(v[0], v[2], v[4]);
    }
    if (!parsed.length || !axisValues.length) return;

    const base = Math.max(...axisValues);
    const root = Math.min(...axisValues);
    const extent = base - root;
    if (!(extent > 0.001)) return;

    const mergeLevels = parsed.map(([, v]) => isTop ? v[2] : v[2]);
    const mapDistance = buildMergeLevelMapper(mergeLevels, base, extent, mode, isTop ? 'top' : 'left');
    const mapAxis = value => {
      const d = (base - value) / extent;
      return base - mapDistance(d) * extent;
    };

    // Move only the TOP dendrogram away from group text/annotation strip.
    // Do not let the root cross the top edge of the SVG.
    const shift = isTop ? Math.min(Math.max(0, Number(topGap) || 0), Math.max(0, root - 3)) : 0;

    for (const [path, v] of parsed) {
      if (isTop) {
        const y1 = mapAxis(v[1]) - shift;
        const ym = mapAxis(v[2]) - shift;
        const y2 = mapAxis(v[4]) - shift;
        path.setAttribute('d', `M ${fmt(v[0])} ${fmt(y1)} V ${fmt(ym)} H ${fmt(v[3])} V ${fmt(y2)}`);
      } else {
        const x1 = mapAxis(v[0]);
        const xm = mapAxis(v[2]);
        const x2 = mapAxis(v[4]);
        path.setAttribute('d', `M ${fmt(x1)} ${fmt(v[1])} H ${fmt(xm)} V ${fmt(v[3])} H ${fmt(x2)}`);
      }
    }
  }

  function forceLabelSizes(root, s) {
    if (!root || !s) return;
    const vars = new Set(((state.gallery.analysis && state.gallery.analysis.vars) || []).map(v => String(v)));
    const samples = new Set((state.gallery.rows || []).map((r, i) => String(r.SampleID || `S${i + 1}`)));
    const correlation = s.heatmapMode === 'correlation';
    const rowSize = Math.max(5, Number(s.heatmapYLabelSize) || 9);
    const colSize = Math.max(6, Number(s.heatmapXLabelSize) || 11);

    root.querySelectorAll('text').forEach(text => {
      const value = String(text.textContent || '').trim();
      if (!value) return;
      const rotated = /rotate\s*\(/i.test(text.getAttribute('transform') || '');
      if (rotated && (samples.has(value) || (correlation && vars.has(value)))) {
        text.setAttribute('font-size', String(colSize));
      } else if (!rotated && vars.has(value)) {
        text.setAttribute('font-size', String(rowSize));
      }
    });
  }

  function patchSvgFragment(fragment) {
    const s = ensureSettings();
    if (!s || !fragment || typeof DOMParser === 'undefined') return fragment;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${fragment}</svg>`, 'image/svg+xml');
      if (doc.querySelector('parsererror')) return fragment;
      const root = doc.documentElement;

      // dendrogramSvg() creates one nested <g fill="none" stroke="..."> per tree.
      root.querySelectorAll('g[fill="none"][stroke]').forEach(group => {
        remapDendrogramGroup(group, s.heatmapDendrogramScale, s.heatmapDendrogramLabelGap);
      });

      // Respect the user's row/column font-size settings exactly. This prevents
      // automatic-fit logic from silently shrinking labels below the chosen size.
      forceLabelSizes(root, s);

      const serializer = new XMLSerializer();
      return [...root.childNodes].map(node => serializer.serializeToString(node)).join('');
    } catch (err) {
      console.warn('[FoodLab heatmap layout patch] SVG post-process failed:', err);
      return fragment;
    }
  }

  // chart-fixes.js loads immediately before template-fixes.js in index.html.
  // Defer installation to the next macrotask so this wrapper is applied AFTER
  // template-fixes.js has finished installing its own heatmap wrappers.
  function installHeatmapV0109() {
    if (typeof window !== 'undefined' && window.__foodlabHeatmapV0109Installed) return;
    if (typeof window !== 'undefined') window.__foodlabHeatmapV0109Installed = true;

    ensureSettings();

    // Wrap only the heatmap renderer; all other chart rendering functions stay untouched.
    if (typeof galleryHeatmap === 'function') {
      const originalGalleryHeatmap = galleryHeatmap;
      galleryHeatmap = function heatmapV0109Layout(W, H) {
        ensureSettings();
        return patchSvgFragment(originalGalleryHeatmap(W, H));
      };
    }

    // Add only dendrogram display controls. Existing font sliders are retained;
    // their values are honoured exactly by forceLabelSizes().
    if (typeof gallerySpecificPropertyHtml === 'function') {
      const previousSpecificPropertyHtml = gallerySpecificPropertyHtml;
      gallerySpecificPropertyHtml = function heatmapV0109Properties(type, id) {
        ensureSettings();
        let html = previousSpecificPropertyHtml(type, id);
        if (type === 'heatmap' && id === 'heatmap-scale') {
          if (typeof gallerySection === 'function' && typeof gSelect === 'function' && typeof gRange === 'function') {
          }
        }
        return html;
      };
    }

    // Remember explicit user font-size choices so the old v0.10.8 default (7 pt)
    // is not forced back to 9 pt after the user deliberately selects 7.
    if (typeof document !== 'undefined') {
      document.addEventListener('input', event => {
        const el = event.target;
        if (!el || !el.dataset) return;
        const s = settings();
        if (!s) return;
        if (el.dataset.gsetting === 'heatmapYLabelSize') s.heatmapV0109UserYLabel = true;
        if (el.dataset.gsetting === 'heatmapXLabelSize') s.heatmapV0109UserXLabel = true;
      }, true);
    }

    console.info(`[FoodLab Studio ${VERSION}] integrated heatmap layout fix loaded`);
  }

  if (typeof setTimeout === 'function') setTimeout(installHeatmapV0109, 0);
  else installHeatmapV0109();
})();
