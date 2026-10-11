'use strict';
/*
 * FoodLab Studio — boot guard (introduced in v0.15.4, current build v0.19.0)
 *
 * This file MUST be loaded BEFORE app.js. It exists to protect the single
 * point of failure at the top of app.js:
 *
 *   const state = { design: structuredClone(defaultDesign), ... }
 *
 * app.js is one classic script. If anything throws while that top-level
 * `state` initialiser runs, the browser aborts the WHOLE file: no event
 * binding, no init(), no patch chain. The result is a blank, silent page.
 *
 * Three jobs:
 *   1. structuredClone fallback, so old browsers cannot abort app.js
 *   2. a visible error surface, so a broken page is never silent again
 *   3. one authoritative version label for the sidebar footer
 *
 * Scope note: no chart, statistic or export logic is touched.
 */
(() => {
  const VERSION = window.FOODLAB_BUILD || '0.99.2';
  const LABEL = 'v' + VERSION;

  /* ---------------------------------------------------------------- 1. clone */
  if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = function foodlabStructuredCloneFallback(value, seen) {
      if (value === null || typeof value !== 'object') return value;
      if (value instanceof Date) return new Date(value.getTime());
      if (value instanceof RegExp) return new RegExp(value.source, value.flags);
      if (seen instanceof WeakMap && seen.has(value)) return seen.get(value);
      if (!(seen instanceof WeakMap)) seen = new WeakMap();
      if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const item of value) out.push(globalThis.structuredClone(item, seen));
        return out;
      }
      if (value instanceof Map) {
        const out = new Map();
        seen.set(value, out);
        value.forEach((v, k) => out.set(globalThis.structuredClone(k, seen), globalThis.structuredClone(v, seen)));
        return out;
      }
      if (value instanceof Set) {
        const out = new Set();
        seen.set(value, out);
        value.forEach(v => out.add(globalThis.structuredClone(v, seen)));
        return out;
      }
      const out = {};
      seen.set(value, out);
      for (const key of Object.keys(value)) out[key] = globalThis.structuredClone(value[key], seen);
      return out;
    };
  }

  /* --------------------------------------------------------------- 2. errors */
  const seenErrors = new Set();

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function report(message, detail) {
    const key = `${message}|${detail}`;
    if (seenErrors.has(key) || seenErrors.size >= 3) return;
    seenErrors.add(key);
    try {
      let box = document.getElementById('foodlabBootError');
      if (!box) {
        box = document.createElement('div');
        box.id = 'foodlabBootError';
        box.setAttribute('role', 'alert');
        box.style.cssText = [
          'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
          'background:#7f1d1d', 'color:#fff', 'padding:10px 44px 10px 14px',
          'font:13px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif',
          'box-shadow:0 -2px 12px rgba(0,0,0,.28)', 'white-space:pre-wrap',
          'max-height:38vh', 'overflow:auto'
        ].join(';');
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.setAttribute('aria-label', '关闭错误提示');
        close.style.cssText = 'position:absolute;top:6px;right:10px;background:none;border:0;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 6px';
        close.addEventListener('click', () => box.remove());
        box.appendChild(close);
        (document.body || document.documentElement).appendChild(box);
      }
      const line = document.createElement('div');
      line.innerHTML = `<b>FoodLab Studio 运行出错</b>  ${escapeHtml(message)}${detail ? `<br><span style="opacity:.85">${escapeHtml(detail)}</span>` : ''}<br><span style="opacity:.75">请先按 Ctrl+F5 强制刷新；若仍出现，把这段文字反馈给开发者。</span>`;
      box.appendChild(line);
    } catch (_err) { /* never let the reporter itself throw */ }
  }

  window.addEventListener('error', event => {
    const target = event.target;
    // resource (script/link) load failures do not bubble as ErrorEvent
    if (target && target !== window && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      report(`无法加载资源：${target.src || target.href}`);
      return;
    }
    const where = event.filename ? `${event.filename}:${event.lineno || 0}` : '未知位置';
    report(event.message || '未知脚本错误', where);
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    report('未处理的异步错误', reason && (reason.stack || reason.message) || String(reason));
  });

  /* -------------------------------------------------------------- 3. version */
  function syncVersion() {
    document.documentElement.dataset.foodlabBuild = VERSION;
    const foot = document.querySelector('.sidebar-foot');
    if (foot) foot.textContent = LABEL;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVersion, { once: true });
  } else {
    syncVersion();
  }
  // v0.14.9 … v0.15.3 each overwrite the footer while they install and settle.
  // Re-assert the unified label once everything has finished.
  window.addEventListener('load', () => {
    requestAnimationFrame(() => setTimeout(syncVersion, 0));
  }, { once: true });
})();
