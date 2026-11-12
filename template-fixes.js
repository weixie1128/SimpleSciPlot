'use strict';

/*
 * FoodLab Studio v0.10.8 — human-friendly templates + heatmap data semantics
 *
 * Goals:
 * 1) Keep the existing app.js intact.
 * 2) Redesign gallery chart templates so users can fill wide, human-readable tables.
 * 3) Preserve backward compatibility: old long tables still import.
 * 4) Limit risk by patching only gallery-template generation / import flow.
 */
(() => {
  if (typeof state === 'undefined') return;

  const originalCurrentWorkflowSchema = typeof currentWorkflowSchema === 'function' ? currentWorkflowSchema : null;
  const originalRenderDesignPreview = typeof renderDesignPreview === 'function' ? renderDesignPreview : null;
  const originalRenderDataPreview = typeof renderDataPreview === 'function' ? renderDataPreview : null;
  const originalProcessGalleryImported = typeof processGalleryImported === 'function' ? processGalleryImported : null;
  const originalSyncWorkflowControls = typeof syncWorkflowControls === 'function' ? syncWorkflowControls : null;

  const q = sel => document.querySelector(sel);

  const FRIENDLY_SCHEMA_META = {
    hist: {
      kind: 'univariate',
      name: '多数据列宽表（推荐）',
      description: '表头直接写组名（A、B、C、D 只是占位，可改成你的真实组名），每一列一组，直接在下面填原始数值；不需要平行号/序号列，也不需要 SampleID。若旧文件仍带平行号列，导入时会自动忽略。',
      planSchema: '多数据列宽表'
    },
    kde: {
      kind: 'univariate',
      name: '分组宽表（推荐）',
      description: '每列一个 Group，模板默认使用 A、B、C、D 作为占位组名，用户可直接改成自己的真实组名。适用于 KDE、箱线图、小提琴图和直方图。兼容旧长表。',
      planSchema: '分组宽表'
    },
    box: {
      kind: 'univariate',
      name: '分组宽表（推荐）',
      description: '每列一个 Group，模板默认使用 A、B、C、D 作为占位组名。无需 SampleID，也无需重复 Group 列。兼容旧长表。',
      planSchema: '分组宽表'
    },
    violin: {
      kind: 'univariate',
      name: '分组宽表（推荐）',
      description: '每列一个 Group，直接填写原始值。适合样本较多时快速录入。兼容旧长表。',
      planSchema: '分组宽表'
    },
    scatter: {
      kind: 'xy',
      name: '分组 XY 宽表（推荐）',
      description: '每个 Group 使用一对列：A X/A Y、B X/B Y……；A、B、C、D 只是占位组名，用户可自行修改。无需 SampleID，也无需单独 Group 列。兼容旧长表。',
      planSchema: '分组 XY 宽表'
    },
    bubble: {
      kind: 'bubble',
      name: '分组 XY+Size 宽表（推荐）',
      description: '每个 Group 使用三列：A X/A Y/A Size、B X/B Y/B Size……；A、B、C、D 只是占位组名。无需 SampleID，也无需重复 Group 列。兼容旧长表。',
      planSchema: '分组 XY+Size 宽表'
    },
    stacked: {
      kind: 'composition',
      name: '组成宽表（推荐）',
      description: '第一列写组分/类别，后面每列一个 Group；模板使用 A、B、C、D 占位。比 Category-Group-Value 长表更适合人工录入。兼容旧长表。',
      planSchema: '组成宽表'
    },
    pie: {
      kind: 'composition',
      name: '组成宽表（推荐）',
      description: '第一列写组分/类别，后面每列一个 Group；模板使用 A、B、C、D 占位。单组饼图也可只保留 1 列数值。兼容旧长表。',
      planSchema: '组成宽表'
    },
    heatmap: {
      kind: 'matrix',
      name: '热图宽矩阵（按模式生成）',
      description: '相关性热图使用“Group（可选）+ 多数值变量”；聚类热图使用“Feature × Sample”宽矩阵。模板统一使用 A、B、C、D 作为组名占位符。',
      planSchema: '相关/聚类热图宽矩阵'
    },
    radar: {
      kind: 'radar',
      name: '雷达宽表（推荐）',
      description: '第一列写指标，后面每列一个 Group；模板使用 A、B、C、D 占位。无需反复填写 Group 和 Indicator。兼容旧长表。',
      planSchema: '雷达宽表'
    }
  };

  function normalize(h) {
    if (typeof normalizeHeader === 'function') return normalizeHeader(h);
    return String(h ?? '').trim().toLowerCase().replace(/[\s_()（）%]/g, '');
  }

  function text(v) {
    return String(v ?? '').trim();
  }

  function isFiniteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n);
  }

  function safeNum(v) {
    if (text(v) === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function isBlankRow(row) {
    return !row || row.every(cell => text(cell) === '');
  }

  function firstNonBlankRow(matrix) {
    for (let i = 0; i < matrix.length; i++) {
      if (!isBlankRow(matrix[i])) return i;
    }
    return -1;
  }

  function matrixToObjects(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = (matrix[start] || []).map(h => text(h));
    const out = [];
    for (let r = start + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (isBlankRow(row)) continue;
      const obj = {};
      let hasAny = false;
      header.forEach((h, c) => {
        if (!h) return;
        obj[h] = row[c] ?? '';
        if (text(row[c]) !== '') hasAny = true;
      });
      if (hasAny) out.push(obj);
    }
    return out;
  }

  function defaultGroups(minCount = 4) {
    // 图库模板只使用中性的 A/B/C/D 占位组名，避免预设任何实验角色。
    const fallback = ['A', 'B', 'C', 'D'];
    return fallback.slice(0, Math.max(1, Math.min(fallback.length, minCount)));
  }

  function currentGroups() {
    return defaultGroups(4);
  }

  function heatmapMode() {
    return state.gallery?.settings?.heatmapMode === 'clustered' ? 'clustered' : 'correlation';
  }

  function heatmapSchemaMeta() {
    if (heatmapMode() === 'clustered') {
      return {
        name: '聚类热图宽矩阵（Feature × Sample）',
        description: '第一列为 Feature/Compound/指标，后面每列为独立样本。模板用 A-1、A-2、A-3…D-3 表示 A/B/C/D 四个占位组的平行样本；用户可直接改成自己的组名和样本名。平台可自动 Row Z-score 并绘制真实聚类树。'
      };
    }
    return {
      name: '相关性热图多变量表',
      description: '第一列 Group 为可选分组信息，后面每列为一个连续变量；不需要 SampleID。模板用 A、B、C、D 作为中性占位组名。默认计算全部样本相关，也可在 Chart Studio 中选择某一个组。'
    };
  }

  function previewTemplate(type) {
    const groups = currentGroups();

    if (['hist', 'kde', 'box', 'violin'].includes(type)) {
      return {
        headers: [...groups],
        rows: [
          [5.42, 5.74, 5.63, 5.58],
          [5.55, 5.81, 5.70, 5.66],
          [5.61, 5.88, 5.76, 5.71],
          [5.48, 5.77, 5.68, 5.59],
          [5.58, 5.83, 5.73, 5.64],
          [5.64, 5.91, 5.80, 5.72]
        ]
      };
    }

    if (type === 'scatter') {
      const headers = ['序号'];
      groups.slice(0, 4).forEach(g => headers.push(`${g} X`, `${g} Y`));
      return {
        headers,
        rows: [
          [1, 1.00, 1.96, 4.60, 5.04, 5.70, 5.48],
          [2, 1.45, 2.48, 5.05, 5.02, 6.15, 5.96],
          [3, 1.90, 3.00, 5.50, 5.54, 6.60, 6.44],
          [4, 2.35, 2.98, 5.95, 6.06, 7.05, 6.92],
          [5, 2.80, 3.50, 6.40, 6.04, 7.50, 7.40],
          [6, 3.25, 4.02, 6.85, 6.56, 7.95, 7.88],
          [7, 3.70, 4.00, 7.30, 7.08, 8.40, 8.36]
        ]
      };
    }

    if (type === 'bubble') {
      const headers = ['序号'];
      groups.slice(0, 4).forEach(g => headers.push(`${g} X`, `${g} Y`, `${g} Size`));
      return {
        headers,
        rows: [
          [1, 1.00, 1.96, 12, 4.60, 5.04, 18, 5.70, 5.48, 16],
          [2, 1.45, 2.48, 13, 5.05, 5.02, 20, 6.15, 5.96, 17],
          [3, 1.90, 3.00, 14, 5.50, 5.54, 22, 6.60, 6.44, 18],
          [4, 2.35, 2.98, 15, 5.95, 6.06, 24, 7.05, 6.92, 19],
          [5, 2.80, 3.50, 16, 6.40, 6.04, 26, 7.50, 7.40, 20],
          [6, 3.25, 4.02, 17, 6.85, 6.56, 28, 7.95, 7.88, 22]
        ]
      };
    }

    if (['stacked', 'pie'].includes(type)) {
      return {
        headers: ['类别', ...groups],
        rows: [
          ['Moisture', 72.4, 70.1, 68.8],
          ['Protein', 18.6, 19.1, 19.7],
          ['Fat', 6.2, 7.4, 8.1],
          ['Ash', 1.3, 1.5, 1.6],
          ['Other', 1.5, 1.9, 1.8]
        ]
      };
    }

    if (type === 'heatmap') {
      if (heatmapMode() === 'clustered') {
        const sampleHeaders = ['A-1','A-2','A-3','B-1','B-2','B-3','C-1','C-2','C-3','D-1','D-2','D-3'];
        return {
          headers: ['Feature', ...sampleHeaders],
          rows: [
            ['Feature 1', 12.6, 11.8, 12.2, 5.1, 4.8, 5.4, 8.0, 8.4, 7.8, 3.1, 3.3, 2.9],
            ['Feature 2', 3.8, 4.1, 3.9, 15.2, 14.6, 15.8, 5.0, 5.3, 4.8, 7.2, 7.0, 7.5],
            ['Feature 3', 7.1, 6.8, 7.4, 6.2, 6.4, 6.0, 13.5, 12.9, 13.2, 4.0, 4.4, 4.1],
            ['Feature 4', 2.4, 2.7, 2.5, 4.9, 5.1, 4.7, 6.8, 7.2, 7.0, 14.1, 13.7, 14.5],
            ['Feature 5', 9.3, 9.0, 9.5, 8.8, 8.5, 8.9, 4.2, 4.0, 4.4, 3.6, 3.8, 3.5],
            ['Feature 6', 5.5, 5.2, 5.6, 3.1, 3.3, 3.0, 9.7, 10.0, 9.5, 8.2, 8.0, 8.4]
          ]
        };
      }
      return {
        headers: ['Group（可选）', 'Variable 1', 'Variable 2', 'Variable 3', 'Variable 4', 'Variable 5'],
        rows: [
          ['A', 72.0, 5.55, 0.21, 12.2, 34.0],
          ['A', 71.8, 5.58, 0.26, 12.0, 35.8],
          ['A', 71.3, 5.62, 0.30, 11.7, 37.6],
          ['B', 69.9, 5.76, 0.48, 10.7, 44.8],
          ['B', 69.5, 5.79, 0.53, 10.5, 46.5],
          ['B', 69.1, 5.83, 0.57, 10.2, 48.2],
          ['C', 68.5, 5.89, 0.64, 9.8, 50.1],
          ['C', 68.2, 5.92, 0.68, 9.5, 51.7],
          ['C', 67.8, 5.96, 0.72, 9.2, 53.0],
          ['D', 67.1, 6.01, 0.81, 8.7, 55.2],
          ['D', 66.8, 6.04, 0.85, 8.4, 56.4],
          ['D', 66.4, 6.08, 0.90, 8.1, 57.8]
        ]
      };
    }

    if (type === 'radar') {
      return {
        headers: ['指标', ...groups],
        rows: [
          ['Color', 7.2, 7.8, 6.9],
          ['Texture', 6.8, 7.6, 6.5],
          ['Flavor', 7.0, 7.4, 6.8],
          ['Juiciness', 6.6, 7.2, 6.1],
          ['Overall', 7.1, 7.7, 6.6]
        ]
      };
    }

    return null;
  }

  function patchPlanMeta() {
    try {
      if (typeof PLAN_CHART_META === 'undefined') return;
      Object.entries(FRIENDLY_SCHEMA_META).forEach(([id, meta]) => {
        if (PLAN_CHART_META[id]) PLAN_CHART_META[id].schema = meta.planSchema;
      });
    } catch (_) {}
  }

  if (originalCurrentWorkflowSchema) {
    currentWorkflowSchema = function patchedCurrentWorkflowSchema() {
      const base = originalCurrentWorkflowSchema();
      if (state.workflow?.mode !== 'gallery') return base;
      const meta = FRIENDLY_SCHEMA_META[state.workflow.chartType];
      if (!meta) return base;
      if (state.workflow.chartType === 'heatmap') {
        const hm = heatmapSchemaMeta();
        return { ...base, name: hm.name, description: hm.description };
      }
      return { ...base, name: meta.name, description: meta.description };
    };
  }

  function renderFriendlyGalleryPreview() {
    const tpl = previewTemplate(state.workflow.chartType);
    if (!tpl) {
      if (originalRenderDesignPreview) return originalRenderDesignPreview();
      return;
    }
    const schema = currentWorkflowSchema();
    const headers = tpl.headers;
    const rows = tpl.rows;
    const summary = q('#designSummaryText');
    const count = q('#templateRowCount');
    const table = q('#designPreviewTable');
    if (summary) summary.textContent = `${workflowChartLabel(state.workflow.chartType)} · ${schema.name} · 按人类可读宽表导入`;
    if (count) count.textContent = `${schema.name} · ${rows.length} 行示例`;
    if (table) {
      let html = `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
      rows.slice(0, 12).forEach(row => {
        html += `<tr>${headers.map((_, i) => `<td>${esc(row[i] ?? '')}</td>`).join('')}</tr>`;
      });
      html += '</tbody>';
      table.innerHTML = html;
    }
    if (typeof syncWorkflowControls === 'function') syncWorkflowControls();
  }

  if (originalRenderDesignPreview) {
    renderDesignPreview = function patchedRenderDesignPreview() {
      if (state.workflow?.mode === 'gallery' && FRIENDLY_SCHEMA_META[state.workflow.chartType]) {
        return renderFriendlyGalleryPreview();
      }
      return originalRenderDesignPreview();
    };
  }

  function matrixFromTemplate(type) {
    const tpl = previewTemplate(type);
    if (!tpl) return null;
    return [tpl.headers, ...tpl.rows];
  }

  function safeFileName(s) {
    return String(s || 'foodlab').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  }

  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function downloadFriendlyGalleryCsv() {
    const matrix = matrixFromTemplate(state.workflow.chartType);
    if (!matrix) return;
    const csv = matrix
      .map(row => row.map(cell => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','))
      .join('\n');
    const suffix = state.workflow.chartType === 'heatmap' ? (heatmapMode() === 'clustered' ? 'cluster_heatmap' : 'correlation_heatmap') : state.workflow.chartType;
    const file = `${safeFileName(state.design?.experimentName)}_${suffix}_friendly_template.csv`;
    downloadBlob(file, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    if (typeof toast === 'function') toast('已生成新版宽表 CSV 模板');
  }

  function downloadFriendlyGalleryXlsx() {
    const matrix = matrixFromTemplate(state.workflow.chartType);
    if (!matrix) return downloadFriendlyGalleryCsv();
    if (!window.XLSX) return downloadFriendlyGalleryCsv();

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(matrix);
    ws['!cols'] = matrix[0].map((h, i) => ({ wch: i === 0 ? (state.workflow.chartType === 'heatmap' && heatmapMode() === 'clustered' ? 24 : 14) : Math.max(12, String(h).length + 4) }));
    ws['!freeze'] = { xSplit: 1, ySplit: 1, topLeftCell: 'B2', activePane: 'bottomRight', state: 'frozen' };
    const dataSheetName = state.workflow.chartType === 'heatmap' && heatmapMode() === 'clustered' ? 'RawData' : 'Data';
    XLSX.utils.book_append_sheet(wb, ws, dataSheetName);

    const meta = state.workflow.chartType === 'heatmap' ? heatmapSchemaMeta() : (FRIENDLY_SCHEMA_META[state.workflow.chartType] || {});
    const heatmapExtra = state.workflow.chartType === 'heatmap'
      ? (heatmapMode() === 'clustered'
          ? 'Only enter raw values. Do not calculate Z-score manually; FoodLab can perform Row Z-score / Column Z-score / 0–1 scaling and hierarchical clustering.'
          : 'Group is optional. A/B/C/D are placeholders only. Delete the Group column if grouping is unnecessary; SampleID is not required.')
      : 'A/B/C/D are neutral placeholder group names; replace them with your real group names.';
    const guide = XLSX.utils.aoa_to_sheet([
      ['FoodLab Studio Friendly Template'],
      ['Chart', workflowChartLabel(state.workflow.chartType)],
      ['Layout', meta.name || 'Friendly wide table'],
      ['How to fill', meta.description || 'Fill the table directly.'],
      ['Group placeholders', 'A, B, C, D are examples only. Replace them with your real group names.'],
      ['Heatmap rule', heatmapExtra],
      ['Compatibility', 'The new wide template is recommended. Legacy layouts remain importable where possible.'],
      ['Reminder', 'Do not change the semantic meaning of the first row. Empty numeric cells are allowed.']
    ]);
    guide['!cols'] = [{ wch: 18 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, guide, 'Instructions');

    const suffix = state.workflow.chartType === 'heatmap' ? (heatmapMode() === 'clustered' ? 'cluster_heatmap' : 'correlation_heatmap') : state.workflow.chartType;
    const file = `${safeFileName(state.design?.experimentName)}_${suffix}_friendly_template.xlsx`;
    XLSX.writeFile(wb, file);
    if (typeof toast === 'function') toast('已生成新版宽表 Excel 模板');
  }

  function looksLikeIndexHeader(h) {
    const n = normalize(h);
    return [
      '序号', 'index', 'id', 'sampleid', '样品编号', '样本编号', '平行号', '重复号', 'rep', 'replicate', 'parallel'
    ].includes(n) || ['no', 'row'].includes(text(h).trim().toLowerCase());
  }

  function isLegacyLongMatrix(matrix, type) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return false;
    const headers = (matrix[start] || []).map(normalize);

    if (['hist', 'kde', 'box', 'violin'].includes(type)) {
      return headers.includes('group') && headers.includes('value');
    }
    if (['scatter', 'bubble'].includes(type)) {
      return headers.includes('group') && headers.includes('x') && headers.includes('y');
    }
    if (['stacked', 'pie'].includes(type)) {
      return headers.includes('group') && headers.includes('value') && (headers.includes('category') || headers.includes('component') || headers.includes('part'));
    }
    if (type === 'radar') {
      return headers.includes('group') && headers.includes('value') && (headers.includes('indicator') || headers.includes('metric') || headers.includes('variable'));
    }
    return false;
  }

  function parseWideUnivariate(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = matrix[start].map(h => text(h));
    const skipFirst = header.length > 1 && looksLikeIndexHeader(header[0]);
    const groupStart = skipFirst ? 1 : 0;
    const groups = header.slice(groupStart).map(text).filter(Boolean);
    if (!groups.length) return [];

    const out = [];
    for (let r = start + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (isBlankRow(row)) continue;
      groups.forEach((g, i) => {
        const value = row[groupStart + i];
        const n = safeNum(value);
        if (n !== null) out.push({ Group: g, Value: n });
      });
    }
    return out;
  }

  function splitGroupVariable(header) {
    const raw = text(header);
    const lower = raw.toLowerCase();
    const suffixes = [
      { key: 'size', re: /(.*?)(?:[\s_\-\/]+)?(?:size|bubble|z)$/i },
      { key: 'x', re: /(.*?)(?:[\s_\-\/]+)?x$/i },
      { key: 'y', re: /(.*?)(?:[\s_\-\/]+)?y$/i }
    ];
    for (const item of suffixes) {
      const m = raw.match(item.re);
      if (m) {
        const group = text(m[1]) || 'All';
        return { group, role: item.key };
      }
    }
    if (['x', 'y', 'size'].includes(lower)) return { group: 'All', role: lower };
    return null;
  }

  function parseWideXY(matrix, bubble = false) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = (matrix[start] || []).map(h => text(h));
    const mapping = new Map();

    header.forEach((h, idx) => {
      if (!h) return;
      if (idx === 0 && looksLikeIndexHeader(h)) return;
      const info = splitGroupVariable(h);
      if (!info) return;
      if (!mapping.has(info.group)) mapping.set(info.group, {});
      mapping.get(info.group)[info.role] = idx;
    });

    const out = [];
    [...mapping.entries()].forEach(([group, cols]) => {
      if (!(cols.x >= 0 && cols.y >= 0)) return;
      for (let r = start + 1; r < matrix.length; r++) {
        const row = matrix[r] || [];
        if (isBlankRow(row)) continue;
        const x = safeNum(row[cols.x]);
        const y = safeNum(row[cols.y]);
        if (x === null || y === null) continue;
        const item = { Group: group, X: x, Y: y };
        if (bubble && cols.size >= 0) {
          const size = safeNum(row[cols.size]);
          if (size !== null) item.Size = size;
        }
        out.push(item);
      }
    });

    return out;
  }

  function parseWideComposition(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = (matrix[start] || []).map(h => text(h));
    if (header.length < 2) return [];
    const groups = header.slice(1).map(text).filter(Boolean);
    const out = [];
    for (let r = start + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (isBlankRow(row)) continue;
      const category = text(row[0]);
      if (!category) continue;
      groups.forEach((g, i) => {
        const value = safeNum(row[i + 1]);
        if (value !== null) out.push({ Category: category, Group: g, Value: value });
      });
    }
    return out;
  }

  function parseWideRadar(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = (matrix[start] || []).map(h => text(h));
    if (header.length < 2) return [];
    const groups = header.slice(1).map(text).filter(Boolean);
    const out = [];
    for (let r = start + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (isBlankRow(row)) continue;
      const indicator = text(row[0]);
      if (!indicator) continue;
      groups.forEach((g, i) => {
        const value = safeNum(row[i + 1]);
        if (value !== null) out.push({ Indicator: indicator, Group: g, Value: value });
      });
    }
    return out;
  }

  function inferHeatmapSampleGroup(sampleName) {
    const raw = text(sampleName);
    if (!raw) return 'All';
    // A-1 / A_1 / A R1 / MSVN-1 / Group-R2 -> A / MSVN / Group
    const stripped = raw.replace(/(?:[\s_\-.]+(?:r|rep|replicate)?\s*\d+)$/i, '').trim();
    return stripped || raw;
  }

  function uniqueFeatureName(name, used) {
    const base = text(name) || 'Feature';
    if (!used.has(base)) { used.add(base); return base; }
    let i = 2;
    while (used.has(`${base} (${i})`)) i++;
    const out = `${base} (${i})`; used.add(out); return out;
  }

  function parseCorrelationHeatmap(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = (matrix[start] || []).map(text);
    if (header.length < 2) return [];
    const first = normalize(header[0]);
    const hasGroup = ['group','组','组别','分组','groupoptional','组别可选'].includes(first) || /group|组/.test(first);
    const varStart = hasGroup ? 1 : 0;
    const vars = header.slice(varStart).map(text).filter(Boolean);
    if (vars.length < 2) return [];
    const rows = [];
    for (let r = start + 1; r < matrix.length; r++) {
      const src = matrix[r] || [];
      if (isBlankRow(src)) continue;
      const obj = { Group: hasGroup ? (text(src[0]) || 'All') : 'All' };
      let numeric = 0;
      vars.forEach((v, i) => {
        const n = safeNum(src[varStart + i]);
        if (n !== null) { obj[v] = n; numeric++; }
      });
      if (numeric >= 2) rows.push(obj);
    }
    return rows;
  }

  function parseClusterHeatmap(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return [];
    const header = (matrix[start] || []).map(text);
    if (header.length < 3) return [];
    const sampleNames = header.slice(1).map(text).filter(Boolean);
    if (sampleNames.length < 2) return [];
    const samples = sampleNames.map(name => ({ SampleID: name, Group: inferHeatmapSampleGroup(name) }));
    const used = new Set();
    let featureCount = 0;
    for (let r = start + 1; r < matrix.length; r++) {
      const src = matrix[r] || [];
      if (isBlankRow(src)) continue;
      const featureRaw = text(src[0]);
      if (!featureRaw) continue;
      const feature = uniqueFeatureName(featureRaw, used);
      let numeric = 0;
      sampleNames.forEach((_, i) => {
        const n = safeNum(src[i + 1]);
        if (n !== null) { samples[i][feature] = n; numeric++; }
      });
      if (numeric >= 2) featureCount++;
    }
    if (featureCount < 2) return [];
    return samples.filter(s => Object.keys(s).length > 2);
  }

  function detectHeatmapLayout(matrix) {
    const start = firstNonBlankRow(matrix);
    if (start < 0) return heatmapMode();
    const header = (matrix[start] || []).map(text);
    const first = normalize(header[0]);
    if (['feature','features','compound','compounds','indicator','metric','variable','特征','化合物','指标'].includes(first)) return 'clustered';
    if (first === 'sampleid' && header.some(h => normalize(h) === 'group')) return 'legacy-correlation';
    if (/group|组/.test(first)) return 'correlation';
    return heatmapMode();
  }

  function renderHeatmapDataPreview() {
    const matrix = state.gallery.heatmapSourceMatrix;
    if (!Array.isArray(matrix) || !matrix.length) {
      if (originalRenderDataPreview) return originalRenderDataPreview();
      return;
    }
    const meta = q('#dataPreviewMeta');
    const table = q('#dataPreviewTable');
    const schema = heatmapSchemaMeta();
    const start = firstNonBlankRow(matrix);
    const rows = start >= 0 ? matrix.slice(start) : matrix;
    const header = rows[0] || [];
    const data = rows.slice(1);
    if (meta) meta.textContent = `${data.length} 行 × ${Math.max(0, header.length - 1)} 数据列 · ${schema.name}`;
    if (!table) return;
    let html = `<thead><tr>${header.map(h => `<th>${esc(text(h))}</th>`).join('')}</tr></thead><tbody>`;
    data.slice(0, 120).forEach(row => {
      html += `<tr>${header.map((_, i) => `<td>${esc(row[i] ?? '')}</td>`).join('')}</tr>`;
    });
    if (data.length > 120) html += `<tr><td colspan="${Math.max(1,header.length)}" class="empty-row">仅预览前 120 行，共 ${data.length} 行</td></tr>`;
    table.innerHTML = html + '</tbody>';
  }

  if (originalRenderDataPreview) {
    renderDataPreview = function patchedFriendlyDataPreview() {
      if (state.workflow?.mode === 'gallery' && state.workflow.chartType === 'heatmap' && Array.isArray(state.gallery.heatmapSourceMatrix)) {
        return renderHeatmapDataPreview();
      }
      return originalRenderDataPreview();
    };
  }

  function parseTextMatrix(textInput) {
    const raw = String(textInput || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = raw.split('\n').filter(line => line.trim() !== '');
    if (!lines.length) return [];
    const tabMode = lines.some(line => line.includes('\t'));
    const delim = tabMode ? '\t' : ',';
    return lines.map(line => line.split(delim).map(cell => cell.trim()));
  }

  function completeFriendlyImport(normalized, source) {
    state.gallery.type = state.workflow.chartType;
    state.gallery.rows = normalized;
    state.gallery.sourceName = source;
    if (typeof analyzeGalleryData === 'function') analyzeGalleryData();
    if (typeof renderDataPreview === 'function') renderDataPreview();
    if (typeof showValidation === 'function') {
      showValidation('success', `导入成功：${normalized.length} 行`, `${workflowChartLabel(state.workflow.chartType)} · ${currentWorkflowSchema().name} · ${source}`);
    }
    if (typeof toast === 'function') toast('数据已导入并完成初步分析');
  }

  function importFriendlyMatrix(matrix, source) {
    const type = state.workflow.chartType;
    if (type === 'heatmap') state.gallery.heatmapSourceMatrix = matrix.map(row => Array.isArray(row) ? row.slice() : row);
    if (!Array.isArray(matrix) || !matrix.length) {
      if (typeof showValidation === 'function') showValidation('error', '没有读取到有效数据', '文件为空或无法识别。');
      return;
    }

    if (isLegacyLongMatrix(matrix, type) && originalProcessGalleryImported) {
      return originalProcessGalleryImported(matrixToObjects(matrix), source);
    }

    let normalized = [];
    if (['hist', 'kde', 'box', 'violin'].includes(type)) normalized = parseWideUnivariate(matrix);
    else if (type === 'scatter') normalized = parseWideXY(matrix, false);
    else if (type === 'bubble') normalized = parseWideXY(matrix, true);
    else if (['stacked', 'pie'].includes(type)) normalized = parseWideComposition(matrix);
    else if (type === 'radar') normalized = parseWideRadar(matrix);
    else if (type === 'heatmap') {
      const layout = detectHeatmapLayout(matrix);
      if (layout === 'legacy-correlation' && originalProcessGalleryImported) {
        state.gallery.settings.heatmapMode = 'correlation';
        return originalProcessGalleryImported(matrixToObjects(matrix), source);
      }
      // v0.24.1: 用户已明确选择“圆形气泡（Corrplot）”时，导入数据不再
      // 因首列名称（Feature/特征等）被自动改回聚类热图。
      const hmSt = state.gallery.settings;
      const explicitCorrplot = hmSt.heatmapCellStyle === 'circle' && hmSt.heatmapShowStars && hmSt.heatmapMode === 'correlation';
      if (!explicitCorrplot) hmSt.heatmapMode = layout === 'clustered' ? 'clustered' : 'correlation';
      if (state.gallery.settings.heatmapMode === 'clustered') {
        if (!state.gallery.settings.heatmapClusteredDefaultsApplied) {
          state.gallery.settings.heatmapStandardize = 'rowZ';
          state.gallery.settings.heatmapCluster = 'rows';
          state.gallery.settings.heatmapDistance = 'euclidean';
          state.gallery.settings.heatmapLinkage = 'ward';
          state.gallery.settings.heatmapPalette = 'paperBlueYellowRed';
          state.gallery.settings.heatmapScaleMode = 'p20';
          state.gallery.settings.heatmapRowDendrogramSize = 112;
          state.gallery.settings.heatmapColDendrogramSize = 38;
          state.gallery.settings.heatmapDendrogramLineWidth = 0.68;
          state.gallery.settings.heatmapDendrogramColor = '#333333';
          state.gallery.settings.heatmapShowGroupNames = false;
          state.gallery.settings.heatmapAutoRowLabelFit = false;
          state.gallery.settings.heatmapAutoColLabelFit = false;
          state.gallery.settings.heatmapYLabelSize = 7;
          state.gallery.settings.heatmapXLabelSize = 11;
          state.gallery.settings.heatmapColumnLabelAngle = 45;
          state.gallery.settings.heatmapClusteredDefaultsApplied = true;
        }
        normalized = parseClusterHeatmap(matrix);
        const featureCount = Math.max(0, matrix.filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '')).length - 1);
        if (featureCount >= 35 && !state.gallery.settings.heatmapAutoCanvasV0108Applied) {
          const recommendedHeight = Math.min(1500, Math.max(760, Math.round(190 + featureCount * 10.5)));
          state.gallery.settings.height = Math.max(Number(state.gallery.settings.height) || 660, recommendedHeight);
          state.gallery.settings.heatmapAutoCanvasV0108Applied = true;
        }
      } else normalized = parseCorrelationHeatmap(matrix);
    }
    else if (originalProcessGalleryImported) return originalProcessGalleryImported(matrixToObjects(matrix), source);

    if (!normalized.length) {
      if (typeof showValidation === 'function') {
        showValidation('error', '没有读取到有效数据', `当前图形推荐使用“${currentWorkflowSchema().name}”。也兼容旧长表。`);
      }
      if (typeof toast === 'function') toast('没有读取到有效数据');
      return;
    }

    completeFriendlyImport(normalized, source);
  }

  async function readAnyFileAsMatrix(file) {
    if (!window.XLSX) throw new Error('Excel 组件未加载，请刷新页面后重试。');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const name = wb.SheetNames.includes('Data') ? 'Data' : (wb.SheetNames.includes('RawData') ? 'RawData' : wb.SheetNames[0]);
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true, blankrows: false });
  }

  function galleryFriendlyEnabled() {
    return state.workflow?.mode === 'gallery' && !!FRIENDLY_SCHEMA_META[state.workflow.chartType];
  }

  function interceptDownload(btnId, handler) {
    const el = q(btnId);
    if (!el) return;
    el.addEventListener('click', evt => {
      if (!galleryFriendlyEnabled()) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
      handler();
    }, true);
  }

  interceptDownload('#downloadCurrentXlsx', downloadFriendlyGalleryXlsx);
  interceptDownload('#downloadCurrentCsv', downloadFriendlyGalleryCsv);
  interceptDownload('#downloadXlsx', downloadFriendlyGalleryXlsx);
  interceptDownload('#downloadCsv', downloadFriendlyGalleryCsv);

  const parseBtn = q('#parsePasted');
  if (parseBtn) {
    parseBtn.addEventListener('click', evt => {
      if (!galleryFriendlyEnabled()) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
      const textArea = q('#dataText');
      const matrix = parseTextMatrix(textArea ? textArea.value : '');
      importFriendlyMatrix(matrix, '粘贴数据');
    }, true);
  }

  const clearBtn = q('#clearData');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      delete state.gallery.heatmapSourceMatrix;
    }, true);
  }

  const fileInput = q('#fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async evt => {
      if (!galleryFriendlyEnabled()) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
      const file = evt.target?.files?.[0];
      if (!file) return;
      try {
        const matrix = await readAnyFileAsMatrix(file);
        importFriendlyMatrix(matrix, file.name);
      } catch (err) {
        if (typeof showValidation === 'function') showValidation('error', '导入失败', err.message || '无法读取文件');
        if (typeof toast === 'function') toast(err.message || '导入失败');
      } finally {
        evt.target.value = '';
      }
    }, true);
  }

  const dropZone = q('#dropZone');
  if (dropZone) {
    dropZone.addEventListener('dragover', evt => {
      if (!galleryFriendlyEnabled()) return;
      evt.preventDefault();
    }, true);
    dropZone.addEventListener('drop', async evt => {
      if (!galleryFriendlyEnabled()) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
      const file = evt.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const matrix = await readAnyFileAsMatrix(file);
        importFriendlyMatrix(matrix, file.name);
      } catch (err) {
        if (typeof showValidation === 'function') showValidation('error', '导入失败', err.message || '无法读取文件');
        if (typeof toast === 'function') toast(err.message || '导入失败');
      }
    }, true);
  }

  function ensureHeatmapTemplateChooser() {
    const old = q('#heatmapTemplateChooser');
    if (state.workflow?.mode !== 'gallery' || state.workflow.chartType !== 'heatmap') {
      if (old) old.remove();
      return;
    }
    const card = q('.current-template-card.large');
    if (!card) return;
    let box = old;
    if (!box) {
      box = document.createElement('div');
      box.id = 'heatmapTemplateChooser';
      box.style.cssText = 'margin-top:12px;padding:10px 12px;border:1px solid #d8e1de;border-radius:8px;background:#f8fbfa;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
      box.innerHTML = '<b style="font-size:13px">热图数据类型</b><select id="heatmapTemplateModeSelect" style="min-width:240px;padding:7px 9px;border:1px solid #c8d2ce;border-radius:6px;background:#fff"><option value="correlation">相关性热图：样本 × 多变量</option><option value="corrplot">相关性热图：圆形气泡（Corrplot）</option><option value="clustered">聚类热图：Feature × Sample</option></select><small style="flex-basis:100%;color:#687783">圆形气泡 = 相关性热图 + 圆形 + 显著性星号，选中后可在图形属性面板继续微调。聚类热图不要整理成 SampleID/Group 长表。</small>';
      const first = card.querySelector('div');
      if (first && first.nextSibling) card.insertBefore(box, first.nextSibling); else card.appendChild(box);
      const select = box.querySelector('#heatmapTemplateModeSelect');
      select.addEventListener('change', () => {
        const mode = select.value === 'corrplot' ? 'correlation' : select.value;
        const changed = heatmapMode() !== mode;
        state.gallery.settings.heatmapMode = mode;
        if (select.value === 'corrplot') {
          state.gallery.settings.heatmapCellStyle = 'circle';
          state.gallery.settings.heatmapShowStars = true;
        }
        if (mode === 'correlation' && state.gallery.settings.heatmapClusteredDefaultsApplied) {
          // 从聚类热图切回相关热图：恢复 Corrplot 蓝红色阶 + 行列同步聚类排序，避免残留聚类色阶与单侧排序
          state.gallery.settings.heatmapPalette = 'blueWhiteRed';
          state.gallery.settings.heatmapScaleMode = 'auto';
          state.gallery.settings.heatmapCluster = 'both';
        }
        if (changed) {
          state.gallery.rows = [];
          state.gallery.analysis = null;
          state.gallery.sourceName = '';
          delete state.gallery.heatmapSourceMatrix;
        }
        if (select.value === 'clustered' && !state.gallery.settings.heatmapClusteredDefaultsApplied) {
          state.gallery.settings.heatmapStandardize = 'rowZ';
          state.gallery.settings.heatmapCluster = 'rows';
          state.gallery.settings.heatmapDistance = 'euclidean';
          state.gallery.settings.heatmapLinkage = 'ward';
          state.gallery.settings.heatmapPalette = 'paperBlueYellowRed';
          state.gallery.settings.heatmapScaleMode = 'p20';
          state.gallery.settings.heatmapRowDendrogramSize = 112;
          state.gallery.settings.heatmapColDendrogramSize = 38;
          state.gallery.settings.heatmapDendrogramLineWidth = 0.68;
          state.gallery.settings.heatmapDendrogramColor = '#333333';
          state.gallery.settings.heatmapShowGroupNames = false;
          state.gallery.settings.heatmapAutoRowLabelFit = false;
          state.gallery.settings.heatmapAutoColLabelFit = false;
          state.gallery.settings.heatmapYLabelSize = 7;
          state.gallery.settings.heatmapXLabelSize = 11;
          state.gallery.settings.heatmapColumnLabelAngle = 45;
          state.gallery.settings.heatmapClusteredDefaultsApplied = true;
        }
        if (originalSyncWorkflowControls) originalSyncWorkflowControls();
        renderFriendlyGalleryPreview();
        ensureHeatmapTemplateChooser();
      });
    }
    const select = box.querySelector('#heatmapTemplateModeSelect');
    if (select) select.value = (heatmapMode() === 'correlation' && state.gallery.settings.heatmapCellStyle === 'circle' && state.gallery.settings.heatmapShowStars) ? 'corrplot' : heatmapMode();
  }

  if (originalSyncWorkflowControls) {
    syncWorkflowControls = function patchedFriendlySyncWorkflowControls() {
      originalSyncWorkflowControls();
      if (state.workflow?.chartType === 'heatmap' && !(state.gallery.rows||[]).length && !state.gallery.sourceName) delete state.gallery.heatmapSourceMatrix;
      ensureHeatmapTemplateChooser();
    };
  }

  patchPlanMeta();
  try {
    if (typeof syncWorkflowControls === 'function') syncWorkflowControls();
    if (typeof renderPlanSelector === 'function') renderPlanSelector();
    if (typeof renderDesignPreview === 'function') renderDesignPreview();
  } catch (_) {}
})();
