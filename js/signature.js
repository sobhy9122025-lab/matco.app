/* =========================================================
   التوقيع الشخصي — يظهر أسفل الشاشات وفي نهاية التقارير المطبوعة
   (الاسم والمسمى يُعدَّلان من js/config.js ← SIGNATURE)
   ========================================================= */
(() => {
  "use strict";
  const CFG = (window.APP_CONFIG || {}).SIGNATURE || {};
  const NAME = CFG.name || "Mohamed Sobhy";
  const TITLE = CFG.title || "Head of Budgeting & Financial Analysis";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // الشعار: مربع بتدرّج أحمر، بداخله أعمدة نمو وسهم صاعد ونجمة صغيرة
  function emblem(size) {
    return `<svg class="sig-emblem" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="sigG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f05252"/><stop offset="1" stop-color="#9b1c1c"/></linearGradient>
        <linearGradient id="sigS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#sigG)"/>
      <rect x="1.5" y="1.5" width="37" height="18" rx="10" fill="url(#sigS)"/>
      <rect x="9" y="24" width="5" height="8" rx="1.6" fill="#fff" opacity=".75"/>
      <rect x="17.5" y="20" width="5" height="12" rx="1.6" fill="#fff" opacity=".88"/>
      <rect x="26" y="15" width="5" height="17" rx="1.6" fill="#fff"/>
      <path d="M8.5 19.5 L15.5 13.5 L20.5 16.5 L29.5 8.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M25.6 8.2 L30.4 8.2 L30.4 13" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M33.2 23.6 l.9 1.9 2 .3 -1.45 1.4 .35 2 -1.8-.95 -1.8.95 .35-2 -1.45-1.4 2-.3z" fill="#fde68a"/>
    </svg>`;
  }

  // نسخة الشاشة
  function screenHTML() {
    return `<div class="sig-card" dir="ltr">${emblem(26)}<div class="sig-text"><b>${esc(NAME)}</b><span>${esc(TITLE)}</span></div></div>`;
  }

  // نسخة التقرير المطبوع (صغيرة وبألوان ثابتة)
  function printHTML() {
    return `<span class="sig-print" dir="ltr">${emblem(15)}<span><b>${esc(NAME)}</b><small>${esc(TITLE)}</small></span></span>`;
  }

  const PRINT_CSS = `
      footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: start !important; }
      .sig-print { display: inline-flex; align-items: center; gap: 4px; color: #334155; font-family: "Segoe UI", Arial, sans-serif; }
      .sig-print b { display: block; font-size: 7.5px; color: #0f172a; line-height: 1.1; }
      .sig-print small { display: block; font-size: 6.5px; color: #64748b; line-height: 1.1; }`;

  function mount() {
    document.querySelectorAll("[data-signature]").forEach((el) => { el.innerHTML = screenHTML(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

  window.SIGNATURE = { screenHTML, printHTML, PRINT_CSS, emblem };
})();
