/* SimpleSciPlot · 数据分析工具箱
 * 光谱预处理（Savitzky-Golay / 基线 / 归一化 / 导数）、峰分析与积分、非线性曲线拟合。
 * 纯前端实现，不依赖任何第三方库；数据源为当前光谱曲线、热分析曲线或实验图表分组。
 */
(function () {
  'use strict';

  const VERSION = '1.0';

  /* ==================== 数值计算 ==================== */

  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => r.slice().concat(b[i]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-14) return null;
      if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        if (!f) continue;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map((r, i) => r[n] / M[i][i]);
  }

  function inverse(A) {
    const n = A.length, out = [];
    for (let i = 0; i < n; i++) out.push(A[i].slice());
    const I = [];
    for (let i = 0; i < n; i++) { const row = new Array(n).fill(0); row[i] = 1; I.push(row); }
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(out[r][col]) > Math.abs(out[piv][col])) piv = r;
      if (Math.abs(out[piv][col]) < 1e-14) return null;
      if (piv !== col) { const t = out[piv]; out[piv] = out[col]; out[col] = t; const u = I[piv]; I[piv] = I[col]; I[col] = u; }
      const d = out[col][col];
      for (let c = 0; c < n; c++) { out[col][c] /= d; I[col][c] /= d; }
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = out[r][col];
        if (!f) continue;
        for (let c = 0; c < n; c++) { out[r][c] -= f * out[col][c]; I[r][c] -= f * I[col][c]; }
      }
    }
    return I;
  }

  function polyFit(x, y, order) {
    const n = order + 1, A = new Array(n).fill(0).map(() => new Array(n).fill(0)), b = new Array(n).fill(0);
    const xm = x.reduce((s, v) => s + v, 0) / x.length, xs = Math.max(1e-12, (Math.max(...x) - Math.min(...x))) || 1;
    const t = x.map(v => (v - xm) / xs);
    for (let i = 0; i < x.length; i++) {
      const p = [];
      let v = 1;
      for (let j = 0; j < n; j++) { p.push(v); v *= t[i]; }
      for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) A[r][c] += p[r] * p[c]; b[r] += p[r] * y[i]; }
    }
    const c = solve(A, b);
    if (!c) return { eval: () => NaN };
    return { raw: c, xm, xs, eval: (xv) => { const tv = (xv - xm) / xs; let s = 0; for (let j = c.length - 1; j >= 0; j--) s = s * tv + c[j]; return s; } };
  }

  function sgCoefficients(windowSize, order) {
    const m = Number(windowSize), h = (m - 1) / 2, k = Math.min(Number(order), m - 1);
    const A = [], N = new Array(k + 1).fill(0).map(() => new Array(k + 1).fill(0)), rhs = new Array(k + 1).fill(0);
    for (let t = -h; t <= h; t++) {
      const row = [];
      let v = 1;
      for (let j = 0; j <= k; j++) { row.push(v); v *= t; }
      A.push(row);
    }
    for (let i = 0; i < A.length; i++) {
      for (let r = 0; r <= k; r++) { for (let c = 0; c <= k; c++) N[r][c] += A[i][r] * A[i][c]; }
    }
    rhs[0] = 1;
    const v = solve(N, rhs);
    if (!v) return { half: h, coeffs: null };
    const coeffs = A.map(row => { let s = 0; for (let j = 0; j <= k; j++) s += row[j] * v[j]; return s; });
    return { half: h, coeffs };
  }

  function sgSmooth(y, windowSize, order) {
    let m = Math.min(Number(windowSize) || 7, y.length % 2 ? y.length : y.length - 1);
    if (m < 3) return y.slice();
    if (m % 2 === 0) m -= 1;
    const { half, coeffs } = sgCoefficients(m, order);
    if (!coeffs) return y.slice();
    const out = y.slice();
    for (let i = half; i < y.length - half; i++) {
      let s = 0;
      for (let k = -half; k <= half; k++) s += coeffs[k + half] * y[i + k];
      out[i] = s;
    }
    return out;
  }

  function alsBaseline(y, lambda, p, outer) {
    const n = y.length, iters = outer || 10;
    let w = new Float64Array(n).fill(1), z = Float64Array.from(y);
    const DtD = (v) => {
      const d = new Float64Array(n), out = new Float64Array(n);
      for (let i = 0; i < n - 2; i++) d[i] = v[i + 2] - 2 * v[i + 1] + v[i];
    for (let i = 0; i < n - 2; i++) { out[i] += d[i]; out[i + 1] -= 2 * d[i]; out[i + 2] += d[i]; }
      return out;
    };
    const matvec = (v) => { const o = new Float64Array(n); const dd = DtD(v); for (let i = 0; i < n; i++) o[i] = w[i] * v[i] + lambda * dd[i] + 1e-9 * v[i]; return o; };
    for (let t = 0; t < iters; t++) {
      // 共轭梯度求解 (W + λDᵀD) z = W y
      let xv = z.slice(), r = new Float64Array(n), pv = new Float64Array(n), Av = new Float64Array(n);
      for (let i = 0; i < n; i++) { Av[i] = w[i] * z[i]; r[i] = w[i] * y[i] - Av[i]; }
      pv.set(r);
      let rs = 0; for (let i = 0; i < n; i++) rs += r[i] * r[i];
      const tol = 1e-10 * (rs || 1);
      for (let it = 0; it < 60 && rs > tol; it++) {
        const ap = matvec(pv);
        let pAp = 0; for (let i = 0; i < n; i++) pAp += pv[i] * ap[i];
        if (!pAp || !isFinite(pAp)) break;
        const alpha = rs / pAp;
        for (let i = 0; i < n; i++) { xv[i] += alpha * pv[i]; r[i] -= alpha * ap[i]; }
        let rs2 = 0; for (let i = 0; i < n; i++) rs2 += r[i] * r[i];
        const beta = rs2 / rs; rs = rs2;
        for (let i = 0; i < n; i++) pv[i] = r[i] + beta * pv[i];
      }
      z = xv;
      for (let i = 0; i < n; i++) w[i] = y[i] > z[i] ? p : 1 - p;
    }
    return Array.from(z);
  }

  function normalizeY(y, mode, x) {
    if (mode === 'none' || !mode) return y.slice();
    if (mode === 'max') { const m = Math.max(...y.map(Math.abs)) || 1; return y.map(v => v / m); }
    if (mode === 'minmax') { const lo = Math.min(...y), hi = Math.max(...y), d = (hi - lo) || 1; return y.map(v => (v - lo) / d); }
    if (mode === 'area') {
      let area = 0;
      for (let i = 1; i < y.length; i++) area += Math.abs((y[i] + y[i - 1]) / 2) * ((x ? x[i] - x[i - 1] : 1) || 1);
      area = area || 1;
      return y.map(v => v / area);
    }
    if (mode === 'snv') { const m = y.reduce((s, v) => s + v, 0) / y.length; const sd = Math.sqrt(y.reduce((s, v) => s + (v - m) * (v - m), 0) / (y.length - 1 || 1)) || 1; return y.map(v => (v - m) / sd); }
    return y.slice();
  }

  function derivative(x, y, order) {
    const n = y.length, out = new Array(n).fill(NaN);
    if (order === 1) {
      for (let i = 0; i < n; i++) {
        const a = i === 0 ? 0 : i - 1, b = i === n - 1 ? n - 1 : i + 1, dx = x[b] - x[a];
        if (Math.abs(dx) > 1e-12) out[i] = (y[b] - y[a]) / dx;
      }
    } else if (order === 2) {
      for (let i = 1; i < n - 1; i++) {
        const h1 = x[i] - x[i - 1], h2 = x[i + 1] - x[i], h = (h1 + h2) / 2;
        out[i] = (2 / (h1 + h2)) * ((y[i + 1] - y[i]) / h2 - (y[i] - y[i - 1]) / h1);
      }
    }
    return out;
  }

  function trapezoid(x, y, i0, i1) {
    let s = 0;
    for (let i = i0 + 1; i <= i1; i++) s += (y[i] + y[i - 1]) / 2 * (x[i] - x[i - 1]);
    return s;
  }

  function aucRange(x, y, x1, x2) {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    let s = 0;
    for (let i = 1; i < x.length; i++) {
      const a = x[i - 1], b = x[i];
      if (b < lo || a > hi) continue;
      const ya = y[i - 1], yb = y[i];
      const segLo = Math.max(a, lo), segHi = Math.min(b, hi);
      if (segHi <= segLo) continue;
      const slope = Math.abs(b - a) > 1e-12 ? (yb - ya) / (b - a) : 0;
      const fa = ya + slope * (segLo - a), fb = ya + slope * (segHi - a);
      s += (fa + fb) / 2 * (segHi - segLo);
    }
    return s;
  }

  function findPeaks(x, y, opts) {
    const o = Object.assign({ minPromRatio: 0.05, minHeightRatio: 0.03, minDistancePct: 0.02 }, opts || {});
    const n = y.length;
    if (n < 3) return [];
    const yMin = Math.min(...y), yMax = Math.max(...y), span = (yMax - yMin) || 1;
    const minProm = span * o.minPromRatio, minH = yMin + span * o.minHeightRatio;
    const minDX = (Math.max(...x) - Math.min(...x)) * o.minDistancePct;
    const raws = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(y[i] > y[i - 1] && y[i] >= y[i + 1])) continue;
      if (y[i] < minH) continue;
      let lmin = y[i], j = i - 1;
      while (j >= 0 && y[j] < y[i]) { if (y[j] < lmin) lmin = y[j]; j--; }
      let rmin = y[i], k = i + 1;
      while (k < n && y[k] < y[i]) { if (y[k] < rmin) rmin = y[k]; k++; }
      const prom = y[i] - Math.max(lmin, rmin);
      if (prom < minProm) continue;
      raws.push({ index: i, x: x[i], y: y[i], prom, leftIdx: j, rightIdx: k });
    }
    // 最小间距：冲突时保留突出度更高的峰
    raws.sort((a, b) => b.prom - a.prom);
    const kept = [];
    raws.forEach(pk => { if (kept.every(q => Math.abs(q.x - pk.x) >= minDX)) kept.push(pk); });
    kept.sort((a, b) => a.x - b.x);
    return kept.map(pk => {
      const base = Math.max(y[Math.max(0, pk.leftIdx)], y[Math.min(n - 1, pk.rightIdx)]);
      const half = base + (pk.y - base) / 2;
      let l = pk.index, r = pk.index;
      while (l > 0 && y[l] > half) l--;
      while (r < n - 1 && y[r] > half) r++;
      const interp = (i0, i1) => {
        const ya = y[i0], yb = y[i1];
        if (!Number.isFinite(ya) || !Number.isFinite(yb) || Math.abs(yb - ya) < 1e-15) return x[i1];
        return x[i0] + (half - ya) / (yb - ya) * (x[i1] - x[i0]);
      };
      const xl = interp(l, Math.min(n - 1, l + 1)), xr = interp(r, Math.max(0, r - 1));
      const fwhm = Math.abs(xr - xl) || NaN;
      const i0 = Math.max(0, pk.leftIdx + 1), i1 = Math.min(n - 1, pk.rightIdx - 1);
      const area = i1 > i0 ? Math.abs(trapezoid(x, y, i0, i1)) : NaN;
      return { index: pk.index, x: pk.x, y: pk.y, prominence: pk.prom, fwhm, area, leftIdx: i0, rightIdx: i1 };
    });
  }

  function lmFit(x, y, model, p0, opts) {
    const o = Object.assign({ maxIter: 80 }, opts || {});
    let p = p0.slice(), lambda = 1e-3;
    const evalSSE = (pp) => { let s = 0; for (let i = 0; i < x.length; i++) { const r = y[i] - model(x[i], pp); if (!isFinite(r)) return Infinity; s += r * r; } return s; };
    let sse = evalSSE(p);
    const m = p.length;
    let J = null;
    for (let it = 0; it < o.maxIter; it++) {
      J = new Array(x.length);
      const h = p.map(v => Math.max(1e-8, Math.abs(v) * 1e-5));
      for (let i = 0; i < x.length; i++) {
        const row = new Array(m);
        for (let j = 0; j < m; j++) {
          const a = p.slice(), b = p.slice();
          a[j] += h[j]; b[j] -= h[j];
          row[j] = (model(x[i], a) - model(x[i], b)) / (2 * h[j]);
        }
        J[i] = row;
      }
      const JtJ = new Array(m).fill(0).map(() => new Array(m).fill(0));
      const Jtr = new Array(m).fill(0);
      for (let i = 0; i < x.length; i++) {
        const r = y[i] - model(x[i], p);
        for (let a = 0; a < m; a++) {
          Jtr[a] += J[i][a] * r;
          for (let b = 0; b < m; b++) JtJ[a][b] += J[i][a] * J[i][b];
        }
      }
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
        const delta = solve(A, Jtr);
        if (!delta) { lambda *= 10; continue; }
        const cand = p.map((v, i) => v + delta[i]);
        const candSSE = evalSSE(cand);
        if (isFinite(candSSE) && candSSE < sse) {
          p = cand; sse = candSSE; lambda = Math.max(1e-12, lambda / 10); improved = true; break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    const n = x.length;
    const JtJ = new Array(m).fill(0).map(() => new Array(m).fill(0));
    for (let i = 0; i < x.length; i++) for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) JtJ[a][b] += J[i][a] * J[i][b];
    const inv = inverse(JtJ);
    const s2 = n > m ? sse / (n - m) : NaN;
    const se = p.map((_, j) => (inv && isFinite(s2) ? Math.sqrt(Math.max(0, s2 * inv[j][j])) : NaN));
    const meanY = y.reduce((s, v) => s + v, 0) / n;
    const sst = y.reduce((s, v) => s + (v - meanY) * (v - meanY), 0) || 1;
    return { params: p, se, sse, r2: 1 - sse / sst, rmse: Math.sqrt(sse / n), n, fitted: x.map(xv => model(xv, p)) };
  }

  const MODELS = {
    linear: { label: '线性 y = a + b·x', names: ['a', 'b'], fn: (x, p) => p[0] + p[1] * x, init: (x, y) => { const a = x[0], b = x[x.length - 1], n = y.length; return [y[0], (n > 1 && b !== a) ? (y[n - 1] - y[0]) / (b - a) : 0]; } },
    quad: { label: '二次 y = a + b·x + c·x²', names: ['a', 'b', 'c'], fn: (x, p) => p[0] + p[1] * x + p[2] * x * x, init: (x, y) => polyInit(x, y, 2) },
    cubic: { label: '三次多项式', names: ['a', 'b', 'c', 'd'], fn: (x, p) => p[0] + p[1] * x + p[2] * x * x + p[3] * x * x * x, init: (x, y) => polyInit(x, y, 3) },
    exp: { label: '指数 y = a·exp(b·x) + c', names: ['a', 'b', 'c'], fn: (x, p) => p[0] * Math.exp(p[1] * x) + p[2], init: (x, y) => { const lo = Math.min(...y), hi = Math.max(...y), spanX = (Math.max(...x) - Math.min(...x)) || 1, up = y[y.length - 1] >= y[0] ? 1 : -1; return [up > 0 ? hi - lo : lo - hi, up * 2.5 / spanX, up > 0 ? lo : hi]; } },
    power: { label: '幂函数 y = a·x^b + c', names: ['a', 'b', 'c'], fn: (x, p) => p[0] * Math.pow(Math.max(1e-12, x), p[1]) + p[2], init: (x, y) => { const lo = Math.min(...y), hi = Math.max(...y); return [Math.max(1e-9, hi - lo), 1, lo]; } },
    gauss1: { label: '单高斯峰 y = c + h·exp(-(x-μ)²/(2σ²))', names: ['c', 'h', 'μ', 'σ'], fn: (x, p) => p[0] + p[1] * Math.exp(-0.5 * Math.pow((x - p[2]) / (Math.abs(p[3]) || 1), 2)), init: (x, y) => { const i = y.indexOf(Math.max(...y)), spanX = Math.max(...x) - Math.min(...x); return [Math.min(...y), Math.max(...y) - Math.min(...y), x[i], spanX / 6 || 1]; } },
    custom: { label: '自定义表达式', names: [], fn: null, init: null }
  };

  function polyInit(x, y, order) {
    const size = order + 1;
    const A = new Array(size).fill(0).map(() => new Array(size).fill(0)), b = new Array(size).fill(0);
    const xm = x.reduce((s, v) => s + v, 0) / x.length, xs = Math.max(1e-12, Math.max(...x) - Math.min(...x)) || 1;
    for (let i = 0; i < x.length; i++) {
      const t = (x[i] - xm) / xs, row = []; let v = 1;
      for (let j = 0; j < size; j++) { row.push(v); v *= t; }
      for (let r = 0; r < size; r++) { for (let c = 0; c < size; c++) A[r][c] += row[r] * row[c]; b[r] += row[r] * y[i]; }
    }
    const c = solve(A, b);
    if (!c) return new Array(size).fill(0);
    // 归一化变量系数 -> 原始变量系数（用 Horner 展开在若干点采样后重新拟合）
    const sample = []; const M = Math.max(size * 3, 24);
    for (let i = 0; i < M; i++) {
      const xv = Math.min(...x) + (Math.max(...x) - Math.min(...x)) * i / (M - 1);
      const tv = (xv - xm) / xs; let s = 0;
      for (let j = c.length - 1; j >= 0; j--) s = s * tv + c[j];
      sample.push([xv, s]);
    }
    const A2 = new Array(size).fill(0).map(() => new Array(size).fill(0)), b2 = new Array(size).fill(0);
    sample.forEach(([xv, yv]) => {
      const row = []; let v = 1;
      for (let j = 0; j < size; j++) { row.push(v); v *= xv; }
      for (let r = 0; r < size; r++) { for (let cc = 0; cc < size; cc++) A2[r][cc] += row[r] * row[cc]; b2[r] += row[r] * yv; }
    });
    return solve(A2, b2) || new Array(size).fill(0);
  }

  function compileExpression(expr) {
    const src = String(expr || '').replace(/\^/g, '**');
    if (!src || /[^\w\s+\-*/%().,]/.test(src)) return null;
    const allowed = new Set(['x', 'exp', 'log', 'log10', 'log2', 'sqrt', 'cbrt', 'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'pow', 'min', 'max', 'floor', 'ceil', 'round', 'hypot', 'PI', 'E']);
    const ids = src.match(/[a-zA-Z_][\w]*/g) || [];
    if (ids.some(id => !/^p\d+$/.test(id) && !allowed.has(id))) return null;
    const count = Math.max(1, exprParamCount(src));
    const decl = Array.from({ length: count }, (_, i) => `const p${i + 1}=p[${i}];`).join('');
    try {
      const fn = new Function('x', 'p', 'with(Math){' + decl + 'return (' + src + ')}');
      return { count, fn };
    } catch (e) { return null; }
  }

  function exprParamCount(expr) {
    const m = String(expr || '').match(/p(\d+)/g) || [];
    return m.length ? Math.max(...m.map(s => Number(s.slice(1))) || [0]) : 0;
  }

  /* ==================== 数据接入 ==================== */

  function safeState() { try { return state; } catch (e) { return null; } }

  function toAscending(points) {
    const src = (points || []).map((p, i) => ({ x: +p.x, y: +p.y, i: p.i !== undefined ? p.i : i })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const sorted = src.slice().sort((a, b) => a.x - b.x);
    return { sorted, mapping: sorted.map(p => p.i) };
  }

  function scatterBack(sortedY, mapping, length) {
    const out = new Array(length).fill(NaN);
    sortedY.forEach((v, k) => { out[mapping[k]] = v; });
    return out;
  }

  function getSources() {
    const s = safeState(), out = [];
    try {
      const sp = s && s.spectrum && s.spectrum.data && s.spectrum.data.series;
      if (Array.isArray(sp) && sp.length) sp.forEach((ser, i) => out.push({ key: 'sp:' + i, name: ser.name || ('曲线 ' + (i + 1)), points: ser.points, source: 'spectrum', ref: ser }));
    } catch (e) {}
    try {
      const th = s && s.thermal && s.thermal.data;
      if (out.length === 0 && th) {
        (th.leftSeries || []).forEach((ser, i) => out.push({ key: 'th:' + i, name: ser.name || ser.group || ('曲线 ' + (i + 1)), points: ser.points, source: 'thermal', ref: ser }));
        (th.rightSeries || []).forEach((ser, i) => out.push({ key: 'th:' + i, name: ser.name || ('曲线 ' + (i + 1)), points: ser.points, source: 'thermal', ref: ser }));
      }
    } catch (e) {}
    try {
      if (out.length === 0 && s && Array.isArray(s.chartData) && s.chartData.length) {
        const groups = new Map();
        s.chartData.forEach(row => {
          const g = String(row.group || 'Series');
          if (!groups.has(g)) groups.set(g, []);
          const yv = Number.isFinite(+row.mean) ? +row.mean : +row.y;
          if (Number.isFinite(+row.x) && Number.isFinite(yv)) groups.get(g).push({ x: +row.x, y: yv });
        });
        let i = 0;
        groups.forEach((pts, g) => { out.push({ key: 'cd:' + i, name: g, points: pts, source: 'chart' }); i++; });
      }
    } catch (e) {}
    return out;
  }

  /* ==================== 预处理链 ==================== */

  function preprocess(pts, cfg) {
    const { sorted, mapping } = toAscending(pts);
    const x = sorted.map(p => p.x), y0 = sorted.map(p => p.y);
    let y = y0.slice(), steps = [];
    if (cfg.sg && Number(cfg.sgWindow) >= 3) { y = sgSmooth(y, cfg.sgWindow, cfg.sgOrder); steps.push(`SG 平滑（窗口 ${cfg.sgWindow}，${cfg.sgOrder} 阶）`); }
    if (cfg.base && cfg.base !== 'none') {
      if (cfg.base === 'poly') { const f = polyFit(x, y, Math.max(1, Number(cfg.baseOrder) || 3)); y = y.map((v, i) => v - f.eval(x[i])); steps.push(`多项式基线（${cfg.baseOrder} 阶）`); }
      else if (cfg.base === 'als') { const base = alsBaseline(y, Math.pow(10, Number(cfg.alsLog) || 5), Math.max(1e-4, Number(cfg.alsP) || 0.01)); y = y.map((v, i) => v - base[i]); steps.push(`ALS 基线（λ=1e${cfg.alsLog}，p=${cfg.alsP}）`); }
    }
    if (cfg.norm && cfg.norm !== 'none') { y = normalizeY(y, cfg.norm, x); steps.push({ max: '最大值归一', minmax: '最小-最大归一', area: '面积归一', snv: 'SNV 标准正态变换' }[cfg.norm] || cfg.norm); }
    if (cfg.deriv && cfg.deriv !== 'none') { const d = derivative(x, y, Number(cfg.deriv)); y = d.map(v => (Number.isFinite(v) ? v : 0)); steps.push(Number(cfg.deriv) === 2 ? '二阶导数' : '一阶导数'); }
    return { x, y, y0, steps, restore: (ys) => scatterBack(ys, mapping, pts.length) };
  }

  /* ==================== 界面 ==================== */

  let ui = null, activeTab = 'prep', sourceKey = null, cache = {};

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function num(v, d) { if (!Number.isFinite(v)) return '—'; const a = Math.abs(v); if (a !== 0 && (a < 0.001 || a >= 1e6)) return v.toExponential(d == null ? 2 : d); return v.toFixed(d == null ? 3 : d); }

  function build() {
    if (ui) return ui;
    const overlay = document.createElement('div');
    overlay.className = 'st-overlay';
    overlay.innerHTML = `
      <div class="st-panel" role="dialog" aria-label="数据分析工具箱">
        <header class="st-head">
          <div><b>数据分析工具箱</b><small>预处理 · 峰分析 · 曲线拟合 · v${VERSION}</small></div>
          <div class="st-head-right">
            <label class="st-src">曲线
              <select id="stSource"></select>
            </label>
            <button class="st-icon" id="stClose" title="关闭">×</button>
          </div>
        </header>
        <nav class="st-tabs">
          <button data-sttab="prep" class="active">① 预处理</button>
          <button data-sttab="peak">② 峰分析与积分</button>
          <button data-sttab="fit">③ 曲线拟合</button>
        </nav>
        <section class="st-body">
          <div class="st-pane" data-stpane="prep">
            <div class="st-controls">
              <fieldset><legend>Savitzky–Golay 平滑</legend>
                <label class="st-check"><input type="checkbox" id="stSgOn">启用平滑</label>
                <label>窗口点数<input type="number" id="stSgWindow" min="3" max="61" step="2" value="11"></label>
                <label>多项式阶数<input type="number" id="stSgOrder" min="2" max="6" step="1" value="2"></label>
              </fieldset>
              <fieldset><legend>基线校正</legend>
                <label>方法<select id="stBase"><option value="none">不校正</option><option value="poly">多项式基线</option><option value="als">ALS 自动基线</option></select></label>
                <label>多项式阶数<input type="number" id="stBaseOrder" min="1" max="8" step="1" value="3"></label>
                <label>ALS λ（10 的幂）<input type="number" id="stAlsLog" min="1" max="9" step="1" value="5"></label>
                <label>ALS 非对称 p<input type="number" id="stAlsP" min="0.0001" max="0.5" step="0.0001" value="0.01"></label>
              </fieldset>
              <fieldset><legend>归一化</legend>
                <label>方式<select id="stNorm"><option value="none">不归一化</option><option value="max">最大值归一</option><option value="minmax">最小-最大归一</option><option value="area">面积归一</option><option value="snv">SNV 标准正态</option></select></label>
              </fieldset>
              <fieldset><legend>导数</legend>
                <label>阶数<select id="stDeriv"><option value="none">不计算</option><option value="1">一阶导数</option><option value="2">二阶导数</option></select></label>
              </fieldset>
              <div class="st-note" id="stChainNote">处理顺序：平滑 → 基线 → 归一化 → 导数</div>
              <div class="st-actions">
                <button class="st-btn primary" id="stApply">应用到图形</button>
                <button class="st-btn" id="stRestore">还原原始数据</button>
                <button class="st-btn" id="stExportPrep">导出处理后 CSV</button>
              </div>
            </div>
            <div class="st-view">
              <div class="st-plot" id="stPrepPlot"></div>
              <div class="st-stat" id="stPrepStat"></div>
            </div>
          </div>
          <div class="st-pane hidden" data-stpane="peak">
            <div class="st-controls">
              <fieldset><legend>自动寻峰</legend>
                <label>最小突出度（占 Y 量程）<input type="number" id="stPeakProm" min="0.001" max="0.9" step="0.01" value="0.05"></label>
                <label>最小峰高（占 Y 量程）<input type="number" id="stPeakHeight" min="0.001" max="0.9" step="0.01" value="0.03"></label>
                <label>最小峰间距（占 X 量程）<input type="number" id="stPeakDist" min="0.001" max="0.5" step="0.005" value="0.02"></label>
              </fieldset>
              <fieldset><legend>多峰拟合</legend>
                <label>峰形状<select id="stPeakModel"><option value="gauss">高斯</option><option value="lorentz">洛伦兹</option></select></label>
                <label>最多峰数<input type="number" id="stPeakMax" min="1" max="10" step="1" value="6"></label>
                <div class="st-actions"><button class="st-btn primary" id="stPeakFit">按寻峰结果拟合</button></div>
              </fieldset>
              <fieldset><legend>区间积分</legend>
                <label>X 起<input type="number" id="stAucFrom" step="any"></label>
                <label>X 止<input type="number" id="stAucTo" step="any"></label>
                <div class="st-actions"><button class="st-btn" id="stAucCalc">计算 AUC</button></div>
              </fieldset>
              <div class="st-actions"><button class="st-btn" id="stExportPeak">导出峰表 CSV</button></div>
            </div>
            <div class="st-view">
              <div class="st-plot" id="stPeakPlot"></div>
              <div class="st-stat" id="stPeakStat"></div>
              <div class="st-table-wrap"><table class="st-table" id="stPeakTable"></table></div>
              <div class="st-table-wrap"><table class="st-table" id="stPeakFitTable"></table></div>
            </div>
          </div>
          <div class="st-pane hidden" data-stpane="fit">
            <div class="st-controls">
              <fieldset><legend>拟合区间</legend>
                <label>X 起<input type="number" id="stFitFrom" step="any"></label>
                <label>X 止<input type="number" id="stFitTo" step="any"></label>
              </fieldset>
              <fieldset><legend>拟合函数</legend>
                <label>函数<select id="stFitModel"></select></label>
                <label id="stExprRow" class="hidden">自定义表达式<input type="text" id="stFitExpr" value="p1*exp(-p2*x)+p3" spellcheck="false"></label>
                <label id="stInitRow" class="hidden">初始值（逗号分隔）<input type="text" id="stFitInit" value="1,1,1" spellcheck="false"></label>
                <div class="st-actions"><button class="st-btn primary" id="stFitRun">开始拟合</button></div>
              </fieldset>
              <div class="st-actions"><button class="st-btn" id="stExportFit">导出拟合结果 CSV</button></div>
            </div>
            <div class="st-view">
              <div class="st-plot" id="stFitPlot"></div>
              <div class="st-plot st-plot-sm" id="stResidPlot"></div>
              <div class="st-stat" id="stFitStat"></div>
              <div class="st-table-wrap"><table class="st-table" id="stFitTable"></table></div>
            </div>
          </div>
        </section>
      </div>`;
    document.body.appendChild(overlay);
    ui = {
      overlay,
      panel: overlay.querySelector('.st-panel'),
      src: overlay.querySelector('#stSource'),
      tabs: [...overlay.querySelectorAll('[data-sttab]')],
      panes: [...overlay.querySelectorAll('[data-stpane]')]
    };
    bindEvents();
    return ui;
  }

  function readCfg() {
    const g = id => ui.overlay.querySelector(id);
    return {
      sg: g('#stSgOn').checked, sgWindow: +g('#stSgWindow').value, sgOrder: +g('#stSgOrder').value,
      base: g('#stBase').value, baseOrder: +g('#stBaseOrder').value, alsLog: +g('#stAlsLog').value, alsP: +g('#stAlsP').value,
      norm: g('#stNorm').value, deriv: g('#stDeriv').value
    };
  }

  function currentSource() {
    const list = getSources();
    if (!list.length) return null;
    const hit = list.find(s => s.key === sourceKey) || list[0];
    sourceKey = hit.key;
    return hit;
  }

  function refreshSourceOptions() {
    const list = getSources();
    ui.src.innerHTML = list.length ? list.map(s => `<option value="${esc(s.key)}">${esc(s.name)}（${s.points.length} 点）</option>`).join('') : '<option value="">无可用数据</option>';
    if (list.length && (!sourceKey || !list.some(s => s.key === sourceKey))) sourceKey = list[0].key;
    if (sourceKey) ui.src.value = sourceKey;
    return list;
  }

  function processed() {
    const src = currentSource();
    if (!src) return null;
    const cfg = readCfg();
    const any = cfg.sg || cfg.base !== 'none' || cfg.norm !== 'none' || cfg.deriv !== 'none';
    const res = preprocess(src.points, cfg);
    res.src = src;
    res.active = any;
    return res;
  }

  function plotSvg(series, opt) {
    const o = Object.assign({ w: 520, h: 250, pad: 34, ymin: null, ymax: null, markers: [] }, opt || {});
    const all = series.flatMap(s => s.points);
    if (!all.length) return '<div class="st-empty">暂无可绘制的数据</div>';
    let [x0, x1] = [Math.min(...all.map(p => p.x)), Math.max(...all.map(p => p.x))];
    let ys = all.map(p => p.y);
    let [y0, y1] = [o.ymin == null ? Math.min(...ys) : o.ymin, o.ymax == null ? Math.max(...ys) : o.ymax];
    if (!isFinite(x0) || !isFinite(x1) || x1 === x0) x1 = x0 + 1;
    if (!isFinite(y0) || !isFinite(y1) || y1 === y0) y1 = y0 + 1;
    const W = o.w, H = o.h, P = o.pad;
    const X = v => P + (v - x0) / (x1 - x0) * (W - P * 1.4);
    const Y = v => H - P - (v - y0) / (y1 - y0) * (H - P * 1.6);
    const ticksX = 5, ticksY = 4;
    let grid = '';
    for (let i = 0; i <= ticksX; i++) { const xv = x0 + (x1 - x0) * i / ticksX; grid += `<line x1="${X(xv).toFixed(1)}" y1="${P}" x2="${X(xv).toFixed(1)}" y2="${H - P}" stroke="#eef2f4"/><text x="${X(xv).toFixed(1)}" y="${H - P + 14}" font-size="10" fill="#8496a0" text-anchor="middle">${num(xv, 2)}</text>`; }
    for (let i = 0; i <= ticksY; i++) { const yv = y0 + (y1 - y0) * i / ticksY; grid += `<line x1="${P * 0.85}" y1="${Y(yv).toFixed(1)}" x2="${W - P * 0.5}" y2="${Y(yv).toFixed(1)}" stroke="#eef2f4"/><text x="${P * 0.8}" y="${(Y(yv) + 3).toFixed(1)}" font-size="10" fill="#8496a0" text-anchor="end">${num(yv, 2)}</text>`; }
    const paths = series.map(s => {
      const pts = s.points.slice().sort((a, b) => a.x - b.x);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color || '#0d6b55'}" stroke-width="${s.width || 1.6}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
    }).join('');
    const marks = (o.markers || []).map(m => `<g><line x1="${X(m.x).toFixed(1)}" y1="${P}" x2="${X(m.x).toFixed(1)}" y2="${H - P}" stroke="#e3a33a" stroke-dasharray="3 3"/><circle cx="${X(m.x).toFixed(1)}" cy="${Y(m.y).toFixed(1)}" r="3" fill="#e07b2a"/></g>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="st-svg">${grid}<path d="M${P} ${H - P} H${W - P * 0.5}" stroke="#c9d4da"/><path d="M${P} ${P} V${H - P}" stroke="#c9d4da"/>${paths}${marks}</svg>`;
  }

  function renderPrep() {
    const res = processed();
    const plot = ui.overlay.querySelector('#stPrepPlot');
    const stat = ui.overlay.querySelector('#stPrepStat');
    if (!res) { plot.innerHTML = '<div class="st-empty">请先导入光谱、热分析或实验数据。</div>'; stat.textContent = ''; return; }
    const orig = res.x.map((xv, i) => ({ x: xv, y: res.y0[i] }));
    const proc = res.x.map((xv, i) => ({ x: xv, y: res.y[i] }));
    plot.innerHTML = plotSvg([
      { points: orig, color: '#a9b6bd', width: 1.2 },
      { points: proc, color: '#0d6b55', width: 1.8 }
    ]);
    const y0min = Math.min(...res.y0), y0max = Math.max(...res.y0), pmin = Math.min(...res.y), pmax = Math.max(...res.y);
    stat.innerHTML = `<b>${esc(res.src.name)}</b><span>原始：${num(y0min)} ~ ${num(y0max)}</span><span>处理后：${num(pmin)} ~ ${num(pmax)}</span><span>${res.steps.length ? esc(res.steps.join(' → ')) : '未启用任何处理步骤（灰线=原始）'}</span>`;
    cache.prep = res;
  }

  function renderPeaks() {
    const res = processed();
    const plot = ui.overlay.querySelector('#stPeakPlot');
    const stat = ui.overlay.querySelector('#stPeakStat');
    const table = ui.overlay.querySelector('#stPeakTable');
    const fitTable = ui.overlay.querySelector('#stPeakFitTable');
    if (!res) { plot.innerHTML = '<div class="st-empty">请先导入数据。</div>'; table.innerHTML = ''; fitTable.innerHTML = ''; stat.textContent = ''; return; }
    const g = id => ui.overlay.querySelector(id);
    const peaks = findPeaks(res.x, res.y, { minPromRatio: +g('#stPeakProm').value, minHeightRatio: +g('#stPeakHeight').value, minDistancePct: +g('#stPeakDist').value });
    cache.peaks = peaks;
    plot.innerHTML = plotSvg([{ points: res.x.map((xv, i) => ({ x: xv, y: res.y[i] })), color: '#0d6b55', width: 1.8 }], { markers: peaks.map(p => ({ x: p.x, y: p.y })) });
    const total = peaks.reduce((s, p) => s + (Number.isFinite(p.area) ? Math.abs(p.area) : 0), 0);
    stat.innerHTML = `<span>检出峰：<b>${peaks.length}</b> 个</span><span>峰面积合计：${num(total)}</span><span>${res.steps.length ? '基于预处理后的曲线' : '基于原始曲线'}</span>`;
    table.innerHTML = peaks.length
      ? `<thead><tr><th>#</th><th>位置</th><th>峰高</th><th>突出度</th><th>FWHM</th><th>峰面积</th></tr></thead><tbody>${peaks.map((p, i) => `<tr><td>${i + 1}</td><td>${num(p.x)}</td><td>${num(p.y)}</td><td>${num(p.prominence)}</td><td>${num(p.fwhm)}</td><td>${num(p.area)}</td></tr>`).join('')}</tbody>`
      : `<tbody><tr><td class="st-empty-cell">没有检出峰，可降低突出度/峰高阈值再试。</td></tr></tbody>`;
    if (g('#stAucFrom').value === '' && res.x.length) { g('#stAucFrom').value = num(res.x[0], 2); g('#stAucTo').value = num(res.x[res.x.length - 1], 2); }
  }

  function runPeakFit() {
    const res = cache.prep || processed();
    if (!res || !res.x.length) return;
    const g = id => ui.overlay.querySelector(id);
    const peaks = cache.peaks || findPeaks(res.x, res.y, { minPromRatio: +g('#stPeakProm').value, minHeightRatio: +g('#stPeakHeight').value, minDistancePct: +g('#stPeakDist').value });
    const wanted = peaks.slice().sort((a, b) => b.prominence - a.prominence).slice(0, Math.max(1, +g('#stPeakMax').value));
    const shape = g('#stPeakModel').value;
    const isGauss = shape === 'gauss';
    const base = Math.min(...res.y);
    const p0 = [base];
    const xSpan = Math.max(...res.x) - Math.min(...res.x);
    wanted.forEach(p => {
      const fwhm = Number.isFinite(p.fwhm) ? Math.abs(p.fwhm) : xSpan / 20;
      p0.push(Math.max(1e-9, p.y - base), p.x, isGauss ? fwhm / 2.3548 : fwhm / 2);
    });
    const model = isGauss
      ? (xv, pp) => { let yv = pp[0]; for (let k = 1; k + 2 < pp.length; k += 3) { const h = pp[k], mu = pp[k + 1], s = Math.abs(pp[k + 2]) || 1e-9; yv += h * Math.exp(-0.5 * Math.pow((xv - mu) / s, 2)); } return yv; }
      : (xv, pp) => { let yv = pp[0]; for (let k = 1; k + 2 < pp.length; k += 3) { const h = pp[k], mu = pp[k + 1], ga = Math.abs(pp[k + 2]) || 1e-9; yv += h / (1 + Math.pow((xv - mu) / ga, 2)); } return yv; };
    const fit = lmFit(res.x, res.y, model, p0, { maxIter: 120 });
    const fitSeries = res.x.map((xv, i) => ({ x: xv, y: fit.fitted[i] }));
    ui.overlay.querySelector('#stPeakPlot').innerHTML = plotSvg([
      { points: res.x.map((xv, i) => ({ x: xv, y: res.y[i] })), color: '#b9c4ca', width: 1.2 },
      { points: fitSeries, color: '#cf5b2e', width: 1.6, dash: '4 3' }
    ], { markers: wanted.map(p => ({ x: p.x, y: p.y })) });
    const rows = [];
    for (let k = 1; k + 2 < fit.params.length; k += 3) {
      const h = fit.params[k], mu = fit.params[k + 1], w = Math.abs(fit.params[k + 2]) || NaN;
      const fwhm = isGauss ? 2.3548 * w : 2 * w;
      const area = isGauss ? h * w * Math.sqrt(2 * Math.PI) : h * Math.PI * w;
      rows.push({ mu, h, fwhm, area, seMu: fit.se[k + 1], seH: fit.se[k], seW: fit.se[k + 2] });
    }
    cache.peakFit = { rows, r2: fit.r2, rmse: fit.rmse, shape };
    const tbl = ui.overlay.querySelector('#stPeakFitTable');
    tbl.innerHTML = `<thead><tr><th>峰</th><th>中心 ± SE</th><th>峰高 ± SE</th><th>FWHM</th><th>峰面积</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${num(r.mu)} ± ${num(r.seMu)}</td><td>${num(r.h)} ± ${num(r.seH)}</td><td>${num(r.fwhm)}</td><td>${num(r.area)}</td></tr>`).join('')}</tbody>`;
    setStat('#stPeakStat', `<span>参与拟合峰：<b>${wanted.length}</b> 个（${isGauss ? '高斯' : '洛伦兹'}）</span><span>R² = <b>${num(fit.r2, 4)}</b></span><span>RMSE = ${num(fit.rmse, 4)}</span>`);
  }

  function renderFit() {
    const res = processed();
    const plot = ui.overlay.querySelector('#stFitPlot');
    if (!res) { plot.innerHTML = '<div class="st-empty">请先导入数据。</div>'; return; }
    const g = id => ui.overlay.querySelector(id);
    if (g('#stFitFrom').value === '') { g('#stFitFrom').value = num(res.x[0], 2); g('#stFitTo').value = num(res.x[res.x.length - 1], 2); }
    plot.innerHTML = plotSvg([{ points: res.x.map((xv, i) => ({ x: xv, y: res.y[i] })), color: '#0d6b55', width: 1.8 }]);
  }

  function modelsIntoSelect() {
    const sel = ui.overlay.querySelector('#stFitModel');
    sel.innerHTML = Object.keys(MODELS).map(k => `<option value="${k}">${esc(MODELS[k].label)}</option>`).join('');
    sel.value = 'linear';
    sel.dispatchEvent(new Event('change'));
  }

  function runFit() {
    const res = cache.prep || processed();
    if (!res || !res.x.length) return;
    const g = id => ui.overlay.querySelector(id);
    const lo = parseFloat(g('#stFitFrom').value), hi = parseFloat(g('#stFitTo').value);
    const xs = [], ys = [];
    res.x.forEach((xv, i) => { if (Number.isFinite(xv) && (!Number.isFinite(lo) || xv >= Math.min(lo, hi)) && (!Number.isFinite(hi) || xv <= Math.max(lo, hi))) { xs.push(xv); ys.push(res.y[i]); } });
    if (xs.length < 3) { setStat('#stFitStat', '拟合区间内数据点不足（<3 个）。'); return; }
    const key = g('#stFitModel').value;
    let model = MODELS[key].fn, names = MODELS[key].names.slice(), p0 = [];
    if (key === 'custom') {
      const expr = g('#stFitExpr').value;
      const compiled = compileExpression(expr);
      if (!compiled) { setStat('#stFitStat', '自定义表达式无法解析，请只用 x、p1..pn 和四则运算/Math 函数。'); return; }
      model = compiled.fn;
      const count = compiled.count;
      names = Array.from({ length: count }, (_, i) => 'p' + (i + 1));
      p0 = String(g('#stFitInit').value || '').split(',').map(v => parseFloat(v.trim())).filter(v => Number.isFinite(v)).slice(0, count);
      while (p0.length < count) p0.push(1);
    } else {
      const xmin = Math.min(...xs), xmax = Math.max(...xs);
      p0 = key === 'linear' ? [ys[0], (ys[ys.length - 1] - ys[0]) / ((xmax - xmin) || 1)]
        : key === 'quad' ? polyInit(xs, ys, 2)
          : key === 'cubic' ? polyInit(xs, ys, 3)
            : key === 'gauss1' ? (() => { const i = ys.indexOf(Math.max(...ys)); const base = Math.min(...ys); return [base, ys[i] - base, xs[i], (xmax - xmin) / 6 || 1]; })()
              : MODELS[key].init(xs, ys);
      if (!Array.isArray(p0) || !p0.length || p0.some(v => !Number.isFinite(v))) p0 = new Array(names.length).fill(1);
    }
    const t0 = performance.now();
    const fit = lmFit(xs, ys, model, p0, { maxIter: 160 });
    const dt = performance.now() - t0;
    cache.fit = { fit, names, xs, ys, model, key, dt };
    const curve = xs.map((xv, i) => ({ x: xv, y: fit.fitted[i] }));
    ui.overlay.querySelector('#stFitPlot').innerHTML = plotSvg([
      { points: xs.map((xv, i) => ({ x: xv, y: ys[i] })), color: '#7d8c94', width: 1.2 },
      { points: curve, color: '#cf5b2e', width: 1.8, dash: '5 3' }
    ], { w: 520, h: 250 });
    const resid = xs.map((xv, i) => ({ x: xv, y: ys[i] - fit.fitted[i] }));
    ui.overlay.querySelector('#stResidPlot').innerHTML = plotSvg([{ points: resid, color: '#4c78a8', width: 1.4 }], { w: 520, h: 120, pad: 26 });
    const cols = ['参数', '估计值', '标准误'];
    ui.overlay.querySelector('#stFitTable').innerHTML = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${names.map((nm, i) => `<tr><td>${esc(nm)}</td><td>${num(fit.params[i], 5)}</td><td>${num(fit.se[i], 5)}</td></tr>`).join('')}<tr><td>R²</td><td>${num(fit.r2, 4)}</td><td></td></tr><tr><td>RMSE</td><td>${num(fit.rmse, 4)}</td><td></td></tr><tr><td>点数 / 耗时</td><td>${fit.n}</td><td>${num(dt, 1)} ms</td></tr></tbody>`;
    const eq = key === 'custom' ? g('#stFitExpr').value : MODELS[key].label;
    setStat('#stFitStat', `函数：${eq}`);
  }

  function setStat(sel, text) { const el = ui.overlay.querySelector(sel); if (el) el.innerHTML = text; }

  function bindEvents() {
    const ov = ui.overlay;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#stClose').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    ui.tabs.forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.sttab)));
    ui.src.addEventListener('change', () => { sourceKey = ui.src.value; refreshAll(); });
    ov.querySelectorAll('.st-controls input, .st-controls select').forEach(el => {
      el.addEventListener('change', () => { if (el.id === 'stFitModel') { ov.querySelector('#stExprRow').classList.toggle('hidden', el.value !== 'custom'); ov.querySelector('#stInitRow').classList.toggle('hidden', el.value !== 'custom'); } refreshAll(); });
      if (el.type === 'number') el.addEventListener('input', () => { clearTimeout(el.__t); el.__t = setTimeout(refreshAll, 380); });
    });
    ov.querySelector('#stApply').addEventListener('click', applyToChart);
    ov.querySelector('#stRestore').addEventListener('click', restoreChart);
    ov.querySelector('#stExportPrep').addEventListener('click', () => {
      const res = cache.prep; if (!res) return toastMsg('没有可导出的数据');
      downloadCsv(`${res.src.name}_processed.csv`, [['x', 'original', 'processed'], ...res.x.map((xv, i) => [xv, res.y0[i], res.y[i]])]);
    });
    ov.querySelector('#stPeakFit').addEventListener('click', () => { if (!cache.peaks) renderPeaks(); runPeakFit(); });
    ov.querySelector('#stAucCalc').addEventListener('click', () => {
      const res = cache.prep || processed(); if (!res) return;
      const a = parseFloat(ov.querySelector('#stAucFrom').value), b = parseFloat(ov.querySelector('#stAucTo').value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return toastMsg('请填写积分区间');
      const area = aucRange(res.x, res.y, a, b);
      setStat('#stPeakStat', `<span>区间 ${num(Math.min(a, b))} → ${num(Math.max(a, b))} 的 AUC = <b>${num(area, 6)}</b></span>`);
      cache.auc = area;
    });
    ov.querySelector('#stExportPeak').addEventListener('click', () => {
      const peaks = cache.peaks || []; if (!peaks.length) return toastMsg('请先自动寻峰');
      downloadCsv('peak_table.csv', [['#', 'x', 'height', 'prominence', 'fwhm', 'area'], ...peaks.map((p, i) => [i + 1, p.x, p.y, p.prominence, p.fwhm, p.area])]);
    });
    ov.querySelector('#stFitRun').addEventListener('click', runFit);
    ov.querySelector('#stExportFit').addEventListener('click', () => {
      const f = cache.fit; if (!f) return toastMsg('请先运行拟合');
      downloadCsv('curve_fit.csv', [['parameter', 'value', 'se'], ...f.names.map((n, i) => [n, f.fit.params[i], f.fit.se[i]]), ['R2', f.fit.r2, ''], ['RMSE', f.fit.rmse, ''], ['n', f.fit.n, '']]);
    });
    modelsIntoSelect();
  }

  function onKey(e) { if (e.key === 'Escape' && ui && !ui.overlay.classList.contains('hidden')) close(); }

  function setTab(tab) {
    activeTab = tab;
    ui.tabs.forEach(b => b.classList.toggle('active', b.dataset.sttab === tab));
    ui.panes.forEach(p => p.classList.toggle('hidden', p.dataset.stpane !== tab));
    refreshAll();
  }

  function refreshAll() {
    if (!ui) return;
    if (activeTab === 'prep') renderPrep();
    else if (activeTab === 'peak') renderPeaks();
    else renderFit();
  }

  function toastMsg(text) { try { if (typeof toast === 'function') toast(text); } catch (e) {} }

  function downloadCsv(name, rows) {
    const csv = rows.map(r => r.map(v => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function applyToChart() {
    const res = cache.prep || processed();
    if (!res) return toastMsg('没有可应用的数据');
    if (!res.active) return toastMsg('请先启用至少一个处理步骤');
    const src = res.src;
    if (src.source !== 'spectrum' || !src.ref) return toastMsg('目前仅支持把处理结果写回光谱曲线');
    const st = safeState();
    try {
      if (!st.spectrum.__stBackup) st.spectrum.__stBackup = new Map();
      if (!st.spectrum.__stBackup.has(src.ref.name)) st.spectrum.__stBackup.set(src.ref.name, src.ref.points.map(p => ({ ...p })));
      const mapped = res.restore(res.y);
      src.ref.points = src.ref.points.map((p, i) => ({ ...p, y: Number.isFinite(mapped[i]) ? mapped[i] : p.y }));
      if (typeof renderSpectrumStudio === 'function') renderSpectrumStudio();
      toastMsg('处理结果已写入图形，可用「还原原始数据」恢复');
      refreshSourceOptions();
    } catch (e) { toastMsg('写回失败：' + (e && e.message)); }
  }

  function restoreChart() {
    const st = safeState();
    const backup = st && st.spectrum && st.spectrum.__stBackup;
    if (!backup || !backup.size) return toastMsg('没有可还原的原始数据');
    try {
      const series = (st.spectrum.data && st.spectrum.data.series) || [];
      series.forEach(s => { if (backup.has(s.name)) s.points = backup.get(s.name).map(p => ({ ...p })); });
      backup.clear();
      if (typeof renderSpectrumStudio === 'function') renderSpectrumStudio();
      toastMsg('已还原原始光谱');
      refreshSourceOptions();
    } catch (e) { toastMsg('还原失败：' + (e && e.message)); }
  }

  function open() {
    build();
    ui.overlay.classList.remove('hidden');
    document.body.classList.add('st-lock');
    refreshSourceOptions();
    cache = {};
    setTab(activeTab || 'prep');
    refreshAll();
  }

  function close() {
    if (!ui) return;
    ui.overlay.classList.add('hidden');
    document.body.classList.remove('st-lock');
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#openSpectralTools');
    if (btn) { e.preventDefault(); open(); }
  });

  window.SpectralTools = { open, close, version: VERSION, __math: { solve, polyFit, sgCoefficients, sgSmooth, alsBaseline, normalizeY, derivative, trapezoid, aucRange, findPeaks, lmFit, compileExpression, exprParamCount, polyInit, MODELS } };
})();
