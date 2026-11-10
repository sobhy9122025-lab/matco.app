/* =========================================================
   الدخول والخروج المتعدد — قراءة ملف الحركات (Transaction)
   أول بصمة في اليوم = الوصول، وآخر بصمة = المغادرة،
   وكل بصمتين بينهما = خروج ثم عودة.
   ========================================================= */
(() => {
  "use strict";
  const R = window.ATT_RULES;

  // ---------------- أدوات الوقت والتاريخ ----------------
  const pad = (n) => String(n).padStart(2, "0");
  const hmToSec = (s) => { const [h, m] = String(s).split(":").map(Number); return (h * 60 + (m || 0)) * 60; };
  const secToHM = (s) => (s == null ? "" : `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`);
  const minToHM = (m) => { m = Math.round(m || 0); const sg = m < 0 ? "-" : ""; m = Math.abs(m); return `${sg}${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const utc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const dow = (iso) => utc(iso).getUTCDay();
  const fmtD = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  const DAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const between = (iso, a, b) => iso >= a && iso <= b;
  const holidayOf = (iso) => R.HOLIDAYS.find((h) => between(iso, h.from, h.to));
  const isRamadan = (iso) => between(iso, R.RAMADAN.from, R.RAMADAN.to);
  // صيغة العدد مع كلمة «يوم»: يوم واحد، يومان، 3 أيام، 11 يومًا
  const days = (n) => (n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n >= 3 && n <= 10 ? `${n} أيام` : `${n} يومًا`);
  const DUP_SECONDS = 120; // البصمات المتكررة خلال دقيقتين تُعدّ بصمة واحدة

  // ---------------- قراءة الملف ----------------
  const ALIASES = {
    "employee id": "id", "emp id": "id", "employee no": "id", "employee no.": "id", "employee number": "id", "personnel number": "id",
    "ac-no.": "id", "ac-no": "id", "user id": "id", "userid": "id", "enroll id": "id", "الرقم الوظيفي": "id", "رقم الموظف": "id",
    "first name": "name", "name": "name", "employee name": "name", "الاسم": "name", "اسم الموظف": "name",
    "department": "dept", "dept": "dept", "القسم": "dept",
    "date": "date", "التاريخ": "date", "punch date": "date", "attendance date": "date",
    "time": "time", "punch time": "time", "check time": "time", "clock time": "time", "log time": "time", "الوقت": "time", "وقت البصمة": "time",
    "datetime": "datetime", "date time": "datetime", "date/time": "datetime", "date & time": "datetime",
  };

  async function readFile(file) {
    const E = window.ATT_ENGINE;
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    const norm = (h) => String(h).trim().toLowerCase().replace(/\s+/g, " ");
    let hdr = -1;
    for (let i = 0; i < Math.min(30, grid.length); i++) {
      const t = grid[i].map((c) => ALIASES[norm(c)]);
      if (t.includes("id") && (t.includes("time") || t.includes("datetime"))) { hdr = i; break; }
    }
    if (hdr < 0) throw new Error("لم أجد في الملف عمود رقم الموظف (Employee ID) وعمود الوقت (Time). تأكد أنه ملف الحركات (Transaction) من جهاز البصمة.");
    const cols = {};
    grid[hdr].forEach((h, i) => { const t = ALIASES[norm(h)]; if (t && cols[t] === undefined) cols[t] = i; });
    const out = [];
    for (const r of grid.slice(hdr + 1)) {
      const id = String(r[cols.id] ?? "").trim().replace(/\.0+$/, "");
      if (!id) continue;
      const tv = cols.time !== undefined ? r[cols.time] : r[cols.datetime];
      const t = E.parsePunch(tv);
      const date = (cols.date !== undefined ? E.parseDateCell(r[cols.date]) : "") || E.parseDateCell(cols.datetime !== undefined ? r[cols.datetime] : tv);
      if (!date || t == null) continue;
      out.push({ id, date, t, name: cols.name !== undefined ? String(r[cols.name] ?? "").trim() : "", dept: cols.dept !== undefined ? String(r[cols.dept] ?? "").trim() : "" });
    }
    if (!out.length) throw new Error("الملف لا يحتوي على بصمات صالحة");
    return out;
  }

  // ---------------- الحساب ----------------
  function workWindow(iso) {
    if (isRamadan(iso)) return { start: hmToSec(R.RAMADAN.start), end: hmToSec(R.RAMADAN.end) };
    return { start: hmToSec(window.APP.settings().start), end: hmToSec(R.DEFAULT_END) };
  }

  function computeDay(date, times) {
    const sorted = times.slice().sort((a, b) => a - b);
    const ps = [];
    for (const t of sorted) if (!ps.length || t - ps[ps.length - 1] > DUP_SECONDS) ps.push(t);
    const win = workWindow(date);
    const off = dow(date) === 5 || !!holidayOf(date);
    const d = { date, raw: sorted.length, punches: ps, win, off, arrive: ps[0], leave: ps.length > 1 ? ps[ps.length - 1] : null,
      exits: [], unmatched: null, span: 0, outside: 0, outsideShift: 0, inside: 0, incomplete: ps.length < 2, late: 0, early: 0, delay: 0 };
    // تأخير الوصول: بعد بداية الدوام + دقائق السماح (نفس قاعدة تقرير البصمة)
    const limit = win.start + (+window.APP.settings().grace || 0) * 60;
    if (!off && ps[0] > limit) d.late = Math.floor((ps[0] - limit) / 60);
    if (ps.length >= 2) {
      const mid = ps.slice(1, -1);
      for (let i = 0; i + 1 < mid.length; i += 2) {
        const from = mid[i], to = mid[i + 1];
        const clip = off ? 0 : Math.max(0, Math.min(to, win.end) - Math.max(from, win.start));
        d.exits.push({ from, to, min: Math.round((to - from) / 60), shiftMin: Math.round(clip / 60) });
      }
      if (mid.length % 2) { d.unmatched = mid[mid.length - 1]; d.incomplete = true; }
      d.span = Math.round((d.leave - d.arrive) / 60);
      d.outside = d.exits.reduce((s, x) => s + x.min, 0);
      d.outsideShift = d.exits.reduce((s, x) => s + x.shiftMin, 0);
      d.inside = d.span - d.outside;
      if (!off && d.leave < win.end) d.early = Math.floor((win.end - d.leave) / 60);
    }
    d.delay = d.late + d.early + d.outsideShift; // إجمالي تأخيرات اليوم
    return d;
  }

  function compute(rows) {
    const A = window.APP;
    const byEmp = new Map();
    for (const r of rows) {
      if (dow(r.date) === 6) continue; // يوم السبت لا يدخل في الدخول والخروج
      if (!byEmp.has(r.id)) byEmp.set(r.id, { id: r.id, nameAtt: r.name, deptAtt: r.dept, days: new Map() });
      const e = byEmp.get(r.id);
      if (!e.days.has(r.date)) e.days.set(r.date, []);
      e.days.get(r.date).push(r.t);
    }
    const res = [];
    for (const e of byEmp.values()) {
      const emp = A.state.employees.get(e.id) || {};
      const days = [...e.days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, ts]) => computeDay(d, ts));
      const full = days.filter((d) => !d.incomplete || d.leave != null);
      const sum = (k, list = days) => list.reduce((s, d) => s + d[k], 0);
      const insideDays = days.filter((d) => d.leave != null);
      res.push({
        id: e.id, name: emp.name || e.nameAtt, nameEn: emp.nameEn || "", dept: emp.dept || e.deptAtt, job: emp.job || "", inEmployees: !!emp.id,
        days, from: days[0].date, to: days[days.length - 1].date,
        dayCount: days.length, totInside: sum("inside", insideDays), avgInside: insideDays.length ? Math.round(sum("inside", insideDays) / insideDays.length) : 0,
        totLate: sum("late"), totEarly: sum("early"), totDelay: sum("delay"),
        lateDays: days.filter((d) => d.late).length, earlyDays: days.filter((d) => d.early).length, delayDays: days.filter((d) => d.delay).length,
        totOutside: sum("outside"), totOutsideShift: sum("outsideShift"), exits: days.reduce((s, d) => s + d.exits.length, 0),
        exitDays: days.filter((d) => d.exits.length).length, incompleteDays: days.filter((d) => d.incomplete).length,
        rawPunches: sum("raw"), usedPunches: days.reduce((s, d) => s + d.punches.length, 0), full: full.length,
      });
    }
    return res.sort((a, b) => b.totDelay - a.totDelay);
  }

  // ---------------- الصفحة ----------------
  const view = { results: null, selected: null, fileName: "", lastFile: null };
  const $ = (s, r = document) => r.querySelector(s);

  function render(root) {
    const A = window.APP, esc = A.esc;
    if (!A.canMovement()) { location.hash = "#leaves"; return; }
    root.innerHTML = `
      <div class="page-head">
        <div><h2>🚶 الدخول والخروج المتعدد</h2><p>ارفع ملف الحركات (Transaction) من جهاز البصمة — يحسب البرنامج لكل يوم وقت الوصول والمغادرة، ومرات الخروج والعودة، والوقت داخل الشركة وخارجها.</p></div>
      </div>
      <div class="card">
        <div class="upload-grid">
          <label class="dropzone" id="mv-drop">
            <input type="file" id="mv-file" accept=".xlsx,.xls,.csv" hidden>
            <div class="dz-icon">📄</div>
            <div class="dz-title" id="mv-title">${view.fileName ? esc(view.fileName) : "اسحب ملف الحركات هنا أو اضغط للاختيار"}</div>
            <div class="muted">Excel — الأعمدة: Employee ID و Date و Time</div>
          </label>
          <div class="upload-side">
            <div class="shift-info">
              <div><span class="muted">🕗 بداية الدوام</span><b class="num">${esc(A.settings().start)}</b></div>
              <div><span class="muted">🚪 نهاية الدوام</span><b class="num">${esc(R.DEFAULT_END)}</b></div>
            </div>
            <button class="btn btn-primary btn-block" id="mv-run" ${view.lastFile ? "" : "disabled"}>🔄 إعادة الحساب</button>
          </div>
        </div>
        <div class="rules-note">📌 طريقة الحساب: أول بصمة = الوصول · آخر بصمة = المغادرة · كل بصمتين بينهما = خروج ثم عودة · البصمات المكررة خلال دقيقتين تُحسب مرة واحدة · أيام السبت لا تُحتسب · «أثناء الدوام» = الجزء الواقع بين ${esc(A.settings().start)} و ${esc(R.DEFAULT_END)} (رمضان ${R.RAMADAN.start} – ${R.RAMADAN.end}).</div>
      </div>
      <div id="mv-results"></div>`;

    const run = async (file) => {
      A.loading(true, "جاري قراءة ملف الحركات...");
      try {
        view.results = compute(await readFile(file));
        view.lastFile = file; view.fileName = file.name;
        if (!view.results.some((r) => r.id === view.selected)) view.selected = view.results.length === 1 ? view.results[0].id : null;
        $("#mv-title").textContent = file.name; $("#mv-run").disabled = false;
        A.toast(`✅ تم حساب ${view.results.length} موظف`, "ok");
      } catch (e) { A.toast("تعذّر قراءة الملف: " + A.errMsg(e), "bad"); }
      finally { A.loading(false); }
      renderResults();
    };
    const fi = $("#mv-file"), dz = $("#mv-drop");
    fi.addEventListener("change", () => fi.files[0] && run(fi.files[0]));
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) run(f); });
    $("#mv-run").addEventListener("click", () => view.lastFile && run(view.lastFile));
    renderResults();
  }

  // شريط اليوم: الأزرق داخل الشركة، الأحمر خروج، الرمادي وقت الدوام
  function timeline(d) {
    const lo = Math.min(d.win.start, d.punches[0]), hi = Math.max(d.win.end, d.punches[d.punches.length - 1]);
    const span = Math.max(1, hi - lo);
    const seg = (a, b, cls) => `<i class="${cls}" style="inset-inline-start:${((a - lo) / span) * 100}%;width:${Math.max(0.8, ((b - a) / span) * 100)}%"></i>`;
    let h = d.off ? "" : seg(d.win.start, d.win.end, "w");
    if (d.leave != null) h += seg(d.arrive, d.leave, "in") + d.exits.map((x) => seg(x.from, x.to, "out")).join("");
    if (d.unmatched != null) h += seg(d.unmatched, d.unmatched + span * 0.01, "dot");
    if (d.leave == null) h += seg(d.arrive, d.arrive + span * 0.01, "dot");
    return `<div class="tl">${h}</div>`;
  }
  const chips = (d, extra = "") => `<span class="chips">${d.exits.map((x) => `<span class="tag bad-tag exit-chip" dir="rtl"><span>${secToHM(x.from)}</span> ← <span>${secToHM(x.to)}</span> · ${minToHM(x.min)}</span>`).join("")}${extra}</span>`;
  const note = (d) => d.leave == null ? '<span class="tag warn-tag">⚠️ بصمة واحدة فقط</span>'
    : d.unmatched != null ? `<span class="tag warn-tag" title="بصمة خروج أو عودة بدون مقابل">⚠️ بصمة بدون مقابل ${secToHM(d.unmatched)}</span>` : "";

  function renderResults() {
    const A = window.APP, esc = A.esc;
    const box = $("#mv-results");
    if (!box || !view.results) { if (box) box.innerHTML = ""; return; }
    const list = view.results, many = list.length > 1;
    const sel = list.find((r) => r.id === view.selected);
    const t = (k) => list.reduce((s, r) => s + r[k], 0);
    let html = "";
    const st = (l, val, cls = "") => `<div class="kstat ${cls}"><div class="v num">${val}</div><div class="l">${l}</div></div>`;
    if (many) html += `
      <div class="kgroups">
        <div class="kgroup"><div class="kgroup-title">🏢 التواجد — ${list.length} موظف</div><div class="kgroup-row">
          ${st("داخل الشركة", minToHM(t("totInside")))}${st("مرات الخروج", t("exits"))}${st("موظفون خرجوا أثناء الدوام", list.filter((r) => r.totOutsideShift).length)}${st("بصمات ناقصة", t("incompleteDays"))}
        </div></div>
        <div class="kgroup bad"><div class="kgroup-title">⏰ التأخيرات</div><div class="kgroup-row">
          ${st("تأخير الوصول", minToHM(t("totLate")), "warn")}${st("خروج مبكر", minToHM(t("totEarly")), "warn")}${st("خروج أثناء الدوام", minToHM(t("totOutsideShift")), "warn")}${st("الإجمالي", minToHM(t("totDelay")), "bad")}
        </div></div>
      </div>
      <div class="card">
        <div class="table-toolbar">
          <div class="right"><div class="card-title" style="margin:0">👥 ملخص الموظفين</div>
            <input type="search" id="mv-q" placeholder="🔎 بحث بالاسم أو الرقم" style="width:220px"></div>
          <div class="left">
            <button class="btn btn-sm" id="mv-xlsx">📥 تصدير Excel</button>
            <button class="btn btn-sm" id="mv-pdf-sum">🖨️ PDF الملخص</button>
            <button class="btn btn-sm" id="mv-pdf-all">🖨️ PDF لكل موظف</button>
          </div>
        </div>
        <div class="table-wrap"><table class="grid view-grid mv-grid"><thead>
          <tr class="grp"><th colspan="3"></th><th colspan="4">الحضور</th><th colspan="4" class="grp-bad">التأخيرات</th><th colspan="2"></th></tr>
          <tr><th>الرقم</th><th>الاسم</th><th>القسم</th><th>الأيام</th><th>داخل الشركة</th><th>المتوسط اليومي</th><th>مرات الخروج</th><th class="g1">تأخير الوصول</th><th>خروج مبكر</th><th>خروج أثناء الدوام</th><th>الإجمالي</th><th>بصمات ناقصة</th><th></th></tr>
        </thead><tbody id="mv-body"></tbody></table></div>
      </div>`;
    if (sel) html += employeeView(sel);
    box.innerHTML = html;

    if (many) {
      const fill = () => {
        const q = ($("#mv-q").value || "").trim().toLowerCase();
        $("#mv-body").innerHTML = list.filter((r) => !q || `${r.id} ${r.name} ${(A.state.employees.get(r.id) || {}).nid || ""}`.toLowerCase().includes(q)).map((r) => `
          <tr data-id="${esc(r.id)}" class="${r.id === view.selected ? "row-selected" : ""}">
            <td class="num" data-label="الرقم">${esc(r.id)}</td><td class="nm" data-label="الاسم"><b>${esc(r.name || "—")}</b></td><td class="muted" data-label="القسم">${esc(r.dept)}</td>
            <td class="num" data-label="الأيام">${r.dayCount}</td><td class="num" data-label="داخل الشركة">${minToHM(r.totInside)}</td><td class="num" data-label="المتوسط اليومي">${minToHM(r.avgInside)}</td>
            <td class="num" data-label="مرات الخروج">${r.exits || "—"}</td>
            <td class="num g1" data-label="تأخير الوصول">${r.totLate ? minToHM(r.totLate) : "—"}</td><td class="num" data-label="خروج مبكر">${r.totEarly ? minToHM(r.totEarly) : "—"}</td>
            <td class="num" data-label="خروج أثناء الدوام">${r.totOutsideShift ? minToHM(r.totOutsideShift) : "—"}</td>
            <td class="num ${r.totDelay ? "txt-bad" : ""}" data-label="إجمالي التأخيرات"><b>${r.totDelay ? minToHM(r.totDelay) : "—"}</b></td>
            <td class="num" data-label="بصمات ناقصة">${r.incompleteDays || "—"}</td>
            <td data-label=""><button class="btn btn-sm">عرض</button></td></tr>`).join("");
      };
      fill();
      $("#mv-q").addEventListener("input", fill);
      $("#mv-body").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]"); if (!tr) return;
        view.selected = tr.dataset.id; renderResults();
        $("#mv-emp")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      $("#mv-xlsx").addEventListener("click", () => exportExcel(list));
      $("#mv-pdf-sum").addEventListener("click", () => printSummary(list));
      $("#mv-pdf-all").addEventListener("click", () => printEmployees(list));
    }
    if (sel) {
      $("#mv-emp-pdf").addEventListener("click", () => printEmployees([sel]));
      $("#mv-emp-xlsx").addEventListener("click", () => exportExcel([sel]));
    }
  }

  function employeeView(r) {
    const esc = window.APP.esc;
    const v = (m) => (m ? `<span class="txt-warn">${minToHM(m)}</span>` : '<span class="muted">—</span>');
    const stat = (l, val, cls = "") => `<div class="kstat ${cls}"><div class="v num">${val}</div><div class="l">${l}</div></div>`;
    const lab = (s) => `data-label="${s}"`;
    return `
      <div id="mv-emp" class="stack-16">
        <div class="emp-hero card">
          <div>
            <div class="muted">الفترة ${fmtD(r.from)} → ${fmtD(r.to)} · ${days(r.dayCount)}</div>
            <div class="emp-name">👤 ${esc(r.name || "—")}</div>
            <div class="muted">${esc(r.nameEn)}</div>
            <div class="emp-meta">
              <span class="tag">الرقم الوظيفي: ${esc(r.id)}</span>
              ${r.dept ? `<span class="tag">${esc(r.dept)}</span>` : ""}${r.job ? `<span class="tag">${esc(r.job)}</span>` : ""}
              ${r.inEmployees ? "" : '<span class="tag warn-tag">⚠️ غير موجود في جدول الموظفين</span>'}
            </div>
          </div>
          <div class="emp-actions">
            <button class="btn btn-primary" id="mv-emp-pdf">🖨️ PDF</button>
            <button class="btn" id="mv-emp-xlsx">📥 Excel</button>
          </div>
        </div>
        <div class="kgroups">
          <div class="kgroup">
            <div class="kgroup-title">🏢 التواجد</div>
            <div class="kgroup-row">
              ${stat("عدد الأيام", r.dayCount)}${stat("داخل الشركة", minToHM(r.totInside))}${stat("المتوسط اليومي", minToHM(r.avgInside))}${stat(`مرات الخروج <small>(في ${days(r.exitDays)})</small>`, r.exits)}
            </div>
          </div>
          <div class="kgroup bad">
            <div class="kgroup-title">⏰ التأخيرات</div>
            <div class="kgroup-row">
              ${stat(`تأخير الوصول <small>(${days(r.lateDays)})</small>`, minToHM(r.totLate), "warn")}${stat(`خروج مبكر <small>(${days(r.earlyDays)})</small>`, minToHM(r.totEarly), "warn")}${stat("خروج أثناء الدوام", minToHM(r.totOutsideShift), "warn")}${stat("الإجمالي", minToHM(r.totDelay), "bad")}
            </div>
          </div>
        </div>
        ${r.incompleteDays ? `<div class="warn-line">⚠️ ${days(r.incompleteDays)} فيها بصمة ناقصة (خروج بلا عودة أو بصمة واحدة) — موضّحة في الجدول.</div>` : ""}
        <div class="card">
          <div class="card-title">📅 الحركة اليومية</div>
          <div class="tl-legend"><span><i class="in"></i> داخل الشركة</span><span><i class="out"></i> خروج</span><span><i class="w"></i> وقت الدوام</span><span><i class="dot"></i> بصمة بدون مقابل</span></div>
          <div class="table-wrap"><table class="grid view-grid compact-grid mv-grid"><thead>
            <tr class="grp"><th colspan="5">الحضور</th><th colspan="4" class="grp-bad">التأخيرات</th><th class="tl-col"></th></tr>
            <tr><th>اليوم</th><th>الوصول</th><th>المغادرة</th><th>داخل الشركة</th><th>فترات الخروج (خرج ← عاد)</th>
            <th class="g1">تأخير الوصول</th><th>خروج مبكر</th><th>خروج أثناء الدوام</th><th>إجمالي التأخيرات والخروج المبكر</th><th class="tl-col">اليوم بالكامل</th></tr>
          </thead><tbody>${r.days.map((d) => `<tr class="${d.off ? "muted-row" : ""} ${d.delay ? "has-delay" : ""}">
            <td ${lab("اليوم")}><b>${DAY_AR[dow(d.date)]}</b> <span class="muted num">${fmtD(d.date).slice(0, 5)}</span>${d.off ? ' <span class="tag">عطلة</span>' : ""}</td>
            <td class="num" ${lab("الوصول")}>${secToHM(d.arrive)}</td><td class="num" ${lab("المغادرة")}>${d.leave != null ? secToHM(d.leave) : "—"}</td>
            <td class="num" ${lab("داخل الشركة")}><b>${d.leave != null ? minToHM(d.inside) : "—"}</b></td>
            <td ${lab("فترات الخروج")}>${chips(d, note(d))}</td>
            <td class="num g1" ${lab("تأخير الوصول")}>${v(d.late)}</td><td class="num" ${lab("خروج مبكر")}>${v(d.early)}</td><td class="num" ${lab("خروج أثناء الدوام")}>${v(d.outsideShift)}</td>
            <td class="num" ${lab("إجمالي التأخيرات والخروج المبكر")}>${d.delay ? `<b class="txt-bad">${minToHM(d.delay)}</b>` : '<span class="txt-ok">✓</span>'}</td>
            <td class="tl-col" ${lab("اليوم بالكامل")}>${timeline(d)}</td></tr>`).join("")}
          </tbody><tfoot><tr><td><b>الإجمالي</b></td><td></td><td></td><td class="num"><b>${minToHM(r.totInside)}</b></td><td class="num">${r.exits} مرة</td>
            <td class="num g1"><b>${minToHM(r.totLate)}</b></td><td class="num"><b>${minToHM(r.totEarly)}</b></td><td class="num"><b>${minToHM(r.totOutsideShift)}</b></td>
            <td class="num"><b class="txt-bad">${minToHM(r.totDelay)}</b></td><td class="tl-col"></td></tr></tfoot></table></div>
          <p class="muted small-note">إجمالي التأخيرات والخروج المبكر = تأخير الوصول (بعد ${esc(window.APP.settings().start)} + ${window.APP.settings().grace} دقيقة سماح) + الخروج المبكر (قبل ${R.DEFAULT_END}) + الخروج أثناء الدوام.</p>
        </div>
      </div>`;
  }

  // ---------------- Excel ----------------
  // الأوقات والمدد تُكتب كقيم وقت حقيقية في Excel (يمكن جمعها)، وليست نصوصًا
  const xDur = (m) => ({ t: "n", v: (m || 0) / 1440, z: "[h]:mm" });
  const xTime = (s) => (s == null ? "" : { t: "n", v: s / 86400, z: "hh:mm" });
  const xDate = (iso) => ({ t: "n", v: (utc(iso) - Date.UTC(1899, 11, 30)) / 864e5, z: "dd/mm/yyyy" });
  const exitsTxt = (d) => d.exits.map((x) => `${secToHM(x.from)} ← ${secToHM(x.to)} (${minToHM(x.min)})`).join(" ، ");
  const noteTxt = (d) => (d.leave == null ? "بصمة واحدة فقط" : d.unmatched != null ? `بصمة بدون مقابل ${secToHM(d.unmatched)}` : d.off ? "عطلة" : "");

  function sheetFrom(aoa, widths, opts = {}) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    if (opts.merges) ws["!merges"] = opts.merges;
    if (opts.filter) ws["!autofilter"] = { ref: opts.filter };
    return ws;
  }

  // ورقة تقرير موظف واحد بنفس ترتيب تقرير PDF
  function employeeSheet(r) {
    const H = ["التاريخ", "اليوم", "الوصول", "المغادرة", "داخل الشركة", "مرات الخروج", "فترات الخروج (خرج ← عاد)", "تأخير الوصول", "خروج مبكر", "خروج أثناء الدوام", "إجمالي التأخيرات والخروج المبكر", "ملاحظة"];
    const aoa = [
      ["تقرير الدخول والخروج التفصيلي"],
      ["الاسم", r.name || "", "", "الرقم الوظيفي", r.id, "", "القسم", r.dept || ""],
      ["الفترة", `${fmtD(r.from)} — ${fmtD(r.to)}`, "", "الوظيفة", r.job || ""],
      [],
      H,
      ...r.days.map((d) => [xDate(d.date), DAY_AR[dow(d.date)], xTime(d.arrive), xTime(d.leave), d.leave != null ? xDur(d.inside) : "",
        d.exits.length, exitsTxt(d), xDur(d.late), xDur(d.early), xDur(d.outsideShift), xDur(d.delay), noteTxt(d)]),
      ["الإجمالي", "", "", "", xDur(r.totInside), r.exits, "", xDur(r.totLate), xDur(r.totEarly), xDur(r.totOutsideShift), xDur(r.totDelay), ""],
      [],
      ["الملخص"],
      ["عدد الأيام", r.dayCount, "", "تأخير الوصول", xDur(r.totLate), `${days(r.lateDays)}`],
      ["داخل الشركة", xDur(r.totInside), "", "الخروج المبكر", xDur(r.totEarly), `${days(r.earlyDays)}`],
      ["المتوسط اليومي", xDur(r.avgInside), "", "الخروج أثناء الدوام", xDur(r.totOutsideShift)],
      ["مرات الخروج", r.exits, "", "إجمالي التأخيرات", xDur(r.totDelay)],
      ...(r.incompleteDays ? [["أيام فيها بصمة ناقصة", r.incompleteDays]] : []),
    ];
    return sheetFrom(aoa, [12, 11, 9, 9, 11, 10, 34, 12, 11, 14, 13, 24], { merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }] });
  }

  function exportExcel(list) {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    if (list.length === 1) {
      XLSX.utils.book_append_sheet(wb, employeeSheet(list[0]), "التقرير");
    } else {
      const H = ["الرقم الوظيفي", "الاسم", "القسم", "عدد الأيام", "داخل الشركة", "المتوسط اليومي", "مرات الخروج", "تأخير الوصول", "أيام التأخير", "الخروج المبكر", "أيام الخروج المبكر", "الخروج أثناء الدوام", "إجمالي التأخيرات", "أيام فيها بصمة ناقصة"];
      const rows = list.map((r) => [r.id, r.name || "", r.dept || "", r.dayCount, xDur(r.totInside), xDur(r.avgInside), r.exits,
        xDur(r.totLate), r.lateDays, xDur(r.totEarly), r.earlyDays, xDur(r.totOutsideShift), xDur(r.totDelay), r.incompleteDays]);
      const t = (k) => list.reduce((s, r) => s + r[k], 0);
      rows.push(["الإجمالي", "", "", t("dayCount"), xDur(t("totInside")), "", t("exits"), xDur(t("totLate")), t("lateDays"), xDur(t("totEarly")), t("earlyDays"), xDur(t("totOutsideShift")), xDur(t("totDelay")), t("incompleteDays")]);
      XLSX.utils.book_append_sheet(wb, sheetFrom([H, ...rows], [12, 28, 16, 10, 12, 12, 11, 12, 10, 12, 12, 14, 14, 14], { filter: `A1:N${rows.length}` }), "الملخص");
      const D = ["الرقم الوظيفي", "الاسم", "التاريخ", "اليوم", "الوصول", "المغادرة", "داخل الشركة", "مرات الخروج", "فترات الخروج (خرج ← عاد)", "تأخير الوصول", "خروج مبكر", "خروج أثناء الدوام", "إجمالي التأخيرات والخروج المبكر", "ملاحظة"];
      const drows = [];
      for (const r of list) for (const d of r.days) drows.push([r.id, r.name || "", xDate(d.date), DAY_AR[dow(d.date)], xTime(d.arrive), xTime(d.leave),
        d.leave != null ? xDur(d.inside) : "", d.exits.length, exitsTxt(d), xDur(d.late), xDur(d.early), xDur(d.outsideShift), xDur(d.delay), noteTxt(d)]);
      XLSX.utils.book_append_sheet(wb, sheetFrom([D, ...drows], [12, 28, 12, 10, 9, 9, 11, 10, 36, 12, 11, 14, 13, 24], { filter: `A1:N${drows.length + 1}` }), "التفصيل اليومي");
    }
    // ورقة كل البصمات (للمراجعة)
    const P = [["الرقم الوظيفي", "الاسم", "التاريخ", "اليوم", "عدد البصمات", "البصمات بعد حذف المكرر", "عدد البصمات في الملف"]];
    for (const r of list) for (const d of r.days) P.push([r.id, r.name || "", xDate(d.date), DAY_AR[dow(d.date)], d.punches.length, d.punches.map(secToHM).join(" ، "), d.raw]);
    XLSX.utils.book_append_sheet(wb, sheetFrom(P, [12, 28, 12, 10, 11, 48, 16], { filter: `A1:G${P.length}` }), "البصمات");
    XLSX.writeFile(wb, `الدخول_والخروج${list.length === 1 ? "_" + list[0].id : ""}_${list[0].from}_${list[0].to}.xlsx`);
  }

  // ---------------- PDF ----------------
  const EXTRA_CSS = `<style>
    .mv td, .mv th { text-align: center; } .mv .c-d, .mv .nm { text-align: start; } .mv .c-e { text-align: start; white-space: normal; }
    .mv td.red { color: #b91c1c; font-weight: 700; } .mv td.ok { color: #15803d; } .mv td.am { color: #b45309; }
    .mv thead tr.grp th { background: #172554; font-size: 9px; padding: 3px; } .mv thead tr.grp th.bad { background: #991b1b; }
    .mv th.g1, .mv td.g1 { border-inline-start: 2px solid #94a3b8 !important; }
    .mv tfoot td { background: #eef2ff !important; font-weight: 800; border-top: 2px solid #1e3a8a; } .mv td .warn { color: #b45309; font-size: 8.5px; }
    .groups { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .group { border: 1px solid #dbe3ef; border-radius: 8px; padding: 6px 8px; break-inside: avoid; }
    .group.bad { border-color: #fecaca; background: #fffafa; }
    .group b.t { display: block; font-size: 10.5px; color: #1e3a8a; margin-bottom: 4px; } .group.bad b.t { color: #991b1b; }
    .group .row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .group .s { text-align: center; } .group .s .v { font-size: 13px; font-weight: 800; color: #1e3a8a; } .group.bad .s .v { color: #b45309; }
    .group .s.hl .v { color: #b91c1c; } .group .s .l { font-size: 8.5px; color: #64748b; font-weight: 700; }
    .warn-note { color: #b45309; font-size: 9px; margin-top: 4px; }
  </style>`;
  const P = () => window.PRINT;
  const box = (l, v, cls = "") => `<div class="box ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const header = (title, sub) => `<header><div><h1>${title}</h1><div class="sub">${sub}</div></div><img class="logo" src="${P().logoUrl()}" alt=""></header>`;
  const footer = () => `<footer><span>تاريخ الطباعة: ${fmtD(new Date().toISOString().slice(0, 10))}</span>${window.SIGNATURE ? window.SIGNATURE.printHTML() : ""}</footer>`;

  function employeeReport(r) {
    const esc = window.APP.esc;
    const pv = (m) => (m ? minToHM(m) : "");
    const s = (l, v, cls = "") => `<div class="s ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const row = (d) => `<tr>
      <td class="c-d"><b>${DAY_AR[dow(d.date)]}</b> ${fmtD(d.date).slice(0, 5)}</td>
      <td>${secToHM(d.arrive)}</td><td>${d.leave != null ? secToHM(d.leave) : "—"}</td>
      <td><b>${d.leave != null ? minToHM(d.inside) : "—"}</b></td>
      <td class="c-e">${d.exits.map((x) => `<span dir="rtl"><span>${secToHM(x.from)}</span> ← <span>${secToHM(x.to)}</span></span>`).join(" ، ")}${d.leave == null ? '<span class="warn">بصمة واحدة</span>' : d.unmatched != null ? ` <span class="warn">بصمة بدون مقابل ${secToHM(d.unmatched)}</span>` : ""}</td>
      <td class="g1 am">${pv(d.late)}</td><td class="am">${pv(d.early)}</td><td class="am">${pv(d.outsideShift)}</td>
      <td class="${d.delay ? "red" : "ok"}">${d.delay ? minToHM(d.delay) : "✓"}</td></tr>`;
    const head = `<tr class="grp"><th colspan="5">الحضور</th><th colspan="4" class="bad">التأخيرات</th></tr>
      <tr><th class="c-d">اليوم</th><th>الوصول</th><th>المغادرة</th><th>داخل الشركة</th><th class="c-e">فترات الخروج (خرج ← عاد)</th><th class="g1">تأخير الوصول</th><th>خروج مبكر</th><th>خروج أثناء الدوام</th><th>إجمالي التأخيرات والخروج المبكر</th></tr>`;
    const foot = `<tr><td class="c-d">الإجمالي</td><td></td><td></td><td>${minToHM(r.totInside)}</td><td class="c-e">${r.exits} مرة خروج</td><td class="g1">${minToHM(r.totLate)}</td><td>${minToHM(r.totEarly)}</td><td>${minToHM(r.totOutsideShift)}</td><td class="red">${minToHM(r.totDelay)}</td></tr>`;
    return `<section class="report" dir="rtl">
      ${header("تقرير الدخول والخروج التفصيلي", `الفترة: ${fmtD(r.from)} — ${fmtD(r.to)}`)}
      <div class="info">
        <div><b>الاسم:</b> ${esc(r.name || "—")}${r.nameEn ? ` <span class="sub">(${esc(r.nameEn)})</span>` : ""}</div>
        <div><b>الرقم الوظيفي:</b> ${esc(r.id)}</div>
        <div><b>القسم:</b> ${esc(r.dept || "—")}</div>
        <div><b>الوظيفة:</b> ${esc(r.job || "—")}</div>
      </div>
      <h2>الحركة اليومية</h2>
      <table class="compact mv"><thead>${head}</thead><tbody>${r.days.map(row).join("")}</tbody><tfoot>${foot}</tfoot></table>
      <h2>الملخص</h2>
      <div class="groups">
        <div class="group"><b class="t">التواجد</b><div class="row">${s("عدد الأيام", r.dayCount)}${s("داخل الشركة", minToHM(r.totInside))}${s("المتوسط اليومي", minToHM(r.avgInside))}${s("مرات الخروج", r.exits)}</div></div>
        <div class="group bad"><b class="t">التأخيرات</b><div class="row">${s(`تأخير الوصول (${days(r.lateDays)})`, minToHM(r.totLate))}${s(`خروج مبكر (${days(r.earlyDays)})`, minToHM(r.totEarly))}${s("خروج أثناء الدوام", minToHM(r.totOutsideShift))}${s("الإجمالي", minToHM(r.totDelay), "hl")}</div></div>
      </div>
      ${r.incompleteDays ? `<div class="warn-note">⚠️ ${days(r.incompleteDays)} فيها بصمة ناقصة (موضّحة في الجدول).</div>` : ""}
      <div class="recs"><b>توصيات المدير المباشر</b><i></i><i></i><i></i></div>
      <div class="signs"><div>توقيع الموظف<span></span></div><div>توقيع المدير المباشر<span></span></div></div>
      ${footer()}
    </section>`;
  }

  function printEmployees(list) {
    P().openPrintWindow(EXTRA_CSS + list.map(employeeReport).join(""), "ar", `الدخول والخروج — ${list.length === 1 ? list[0].name || list[0].id : list[0].to}`);
  }

  function printSummary(list) {
    const esc = window.APP.esc;
    const t = (k) => list.reduce((s, r) => s + r[k], 0);
    const sv = (l, v, cls = "") => `<div class="s ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const hm = (m) => (m ? minToHM(m) : "—");
    const body = `<section class="report" dir="rtl">
      ${header("ملخص الدخول والخروج", `الفترة: ${fmtD(list.reduce((m, r) => (r.from < m ? r.from : m), list[0].from))} — ${fmtD(list.reduce((m, r) => (r.to > m ? r.to : m), list[0].to))} · عدد الموظفين ${list.length}`)}
      <h2>الموظفون <span class="sub">(مرتبون حسب إجمالي التأخيرات)</span></h2>
      <table class="compact mv"><thead>
        <tr class="grp"><th colspan="3"></th><th colspan="4">الحضور</th><th colspan="4" class="bad">التأخيرات</th><th></th></tr>
        <tr><th style="width:55px">الرقم</th><th class="nm" style="width:22%">الاسم</th><th>القسم</th><th>الأيام</th><th>داخل الشركة</th><th>المتوسط اليومي</th><th>مرات الخروج</th><th class="g1">تأخير الوصول</th><th>خروج مبكر</th><th>خروج أثناء الدوام</th><th>الإجمالي</th><th>بصمات ناقصة</th></tr>
      </thead><tbody>${list.map((r) => `<tr><td>${esc(r.id)}</td><td class="nm">${esc(r.name || "—")}</td><td>${esc(r.dept || "")}</td><td>${r.dayCount}</td>
        <td>${minToHM(r.totInside)}</td><td>${minToHM(r.avgInside)}</td><td>${r.exits || "—"}</td>
        <td class="g1 am">${hm(r.totLate)}</td><td class="am">${hm(r.totEarly)}</td><td class="am">${hm(r.totOutsideShift)}</td>
        <td class="${r.totDelay ? "red" : "ok"}">${r.totDelay ? minToHM(r.totDelay) : "✓"}</td><td>${r.incompleteDays || "—"}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td></td><td class="nm">الإجمالي</td><td></td><td>${t("dayCount")}</td><td>${minToHM(t("totInside"))}</td><td></td><td>${t("exits")}</td>
        <td class="g1">${minToHM(t("totLate"))}</td><td>${minToHM(t("totEarly"))}</td><td>${minToHM(t("totOutsideShift"))}</td><td class="red">${minToHM(t("totDelay"))}</td><td>${t("incompleteDays")}</td></tr></tfoot></table>
      <h2>الملخص</h2>
      <div class="groups">
        <div class="group"><b class="t">التواجد</b><div class="row">${sv("داخل الشركة", minToHM(t("totInside")))}${sv("مرات الخروج", t("exits"))}${sv("موظفون خرجوا أثناء الدوام", list.filter((r) => r.totOutsideShift).length)}${sv("بصمات ناقصة", t("incompleteDays"))}</div></div>
        <div class="group bad"><b class="t">التأخيرات</b><div class="row">${sv("تأخير الوصول", minToHM(t("totLate")))}${sv("خروج مبكر", minToHM(t("totEarly")))}${sv("خروج أثناء الدوام", minToHM(t("totOutsideShift")))}${sv("الإجمالي", minToHM(t("totDelay")), "hl")}</div></div>
      </div>
      ${footer()}
    </section>`;
    P().openPrintWindow(EXTRA_CSS + body, "ar", "ملخص الدخول والخروج", true);
  }

  window.PAGES = window.PAGES || {};
  window.PAGES.movement = render;
  window.MOVEMENT = { readFile, compute, computeDay }; // للاختبار
})();
