/* =========================================================
   تقرير البصمة — قراءة ملف البصمة + الاحتساب + العرض + PDF
   (نفس قواعد attendance_engine.py في الموقع القديم)
   ========================================================= */
(() => {
  "use strict";
  const R = window.ATT_RULES;

  // ---------------- أدوات الوقت والتاريخ ----------------
  const pad = (n) => String(n).padStart(2, "0");
  const hmToSec = (s) => { const [h, m] = String(s).split(":").map(Number); return (h * 60 + (m || 0)) * 60; };
  const secToHM = (s) => (s == null ? "" : `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`);
  const minToHM = (m) => { m = Math.round(m || 0); const sg = m < 0 ? "-" : ""; m = Math.abs(m); return `${sg}${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const isoFromUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const utc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (iso, n) => { const d = utc(iso); d.setUTCDate(d.getUTCDate() + n); return isoFromUTC(d); };
  const dow = (iso) => utc(iso).getUTCDay(); // 0 = الأحد ... 5 = الجمعة، 6 = السبت
  const fmtD = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  const DAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

  const between = (iso, a, b) => iso >= a && iso <= b;
  const holidayOf = (iso) => R.HOLIDAYS.find((h) => between(iso, h.from, h.to));
  const isRamadan = (iso) => between(iso, R.RAMADAN.from, R.RAMADAN.to);

  // ---------------- قراءة الخلايا ----------------
  function parseDateCell(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    if (typeof v === "number" && v > 1) return isoFromUTC(new Date(EXCEL_EPOCH + Math.floor(v) * 864e5));
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);           // يوم/شهر/سنة
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})/);      // 08-Oct-2026
    if (m) {
      const mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(m[1])}`;
    }
    return "";
  }

  // يرجّع عدد الثواني من بداية اليوم (أو null لو فاضي)
  function parsePunch(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
    if (typeof v === "number") {
      if (v < 0) return null;
      const frac = v - Math.floor(v);
      return Math.round(frac * 86400) % 86400;
    }
    let s = String(v).trim();
    if (!s || ["-", "--", "nan", "NaT", "None"].includes(s)) return null;
    s = s.replace("ص", "AM").replace("م", "PM");
    const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!m) return null;
    let h = +m[1];
    const ap = (m[4] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 3600 + +m[2] * 60 + +(m[3] || 0);
  }

  const ALIASES = {
    "employee id": "employee_id", "first name": "name_att", "department": "department_att", "date": "date",
    "first punch": "first", "first check in": "first", "first check-in": "first", "first checkin": "first",
    "first in": "first", "check in": "first", "time in": "first", "in": "first",
    "last punch": "last", "last check out": "last", "last check-out": "last", "last checkout": "last",
    "last out": "last", "check out": "last", "time out": "last", "out": "last",
  };

  async function readAttendanceFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    let hdr = 0;
    for (let i = 0; i < Math.min(30, grid.length); i++) {
      const cells = grid[i].map((c) => String(c).trim().toLowerCase());
      if (cells.includes("employee id") && cells.includes("date")) { hdr = i; break; }
    }
    const cols = {};
    grid[hdr].forEach((h, i) => {
      const t = ALIASES[String(h).trim().toLowerCase()];
      if (t && cols[t] === undefined) cols[t] = i;
    });
    if (cols.employee_id === undefined || cols.date === undefined) {
      throw new Error("ملف البصمة لازم يكون فيه عمود Employee ID وعمود Date. الأعمدة الموجودة: " + grid[hdr].filter(Boolean).join(" ، "));
    }
    if (cols.first === undefined && cols.last === undefined) {
      throw new Error("ملف البصمة لا يحتوي على عمودي First Punch / Last Punch");
    }
    const rows = [];
    for (const r of grid.slice(hdr + 1)) {
      if (!r.some((c) => String(c).trim() !== "")) continue;
      const id = String(r[cols.employee_id] ?? "").trim().replace(/\.0+$/, "");
      if (!id) continue;
      rows.push({
        id,
        date: parseDateCell(r[cols.date]),
        first: cols.first !== undefined ? parsePunch(r[cols.first]) : null,
        last: cols.last !== undefined ? parsePunch(r[cols.last]) : null,
        nameAtt: cols.name_att !== undefined ? String(r[cols.name_att] ?? "").trim() : "",
        deptAtt: cols.department_att !== undefined ? String(r[cols.department_att] ?? "").trim() : "",
      });
    }
    return rows;
  }

  // ---------------- القواعد ----------------
  const SAUDI_KEYS = ["سعود", "saudi", "ksa", "k.s.a", "k s a", "المملكة العربية السعودية", "المملكه العربيه السعوديه"];
  const isSaudi = (nat) => { const s = String(nat || "").trim().toLowerCase().replace(/\s+/g, " "); return !s || SAUDI_KEYS.some((k) => s.includes(k)); };
  const isDailyHours = (rule) => ["daily hours", "daily_hours", "hours", "exempt", "مستثنى", "استثناء"].includes(String(rule || "").trim().toLowerCase());
  const APPROVED = ["approved", "approve", "معتمد", "معتمدة", "اعتماد", "تمت الموافقة", "active", "نشط", ""];
  const DAY_TYPES = ["غياب بإذن", "غياب بدون إذن"];
  const LATE_TYPES = ["تأخير بعذر", "خروج مبكر بإذن", "أخرى"];

  function shift(iso, startSec, graceMin) {
    if (isRamadan(iso)) {
      const s = hmToSec(R.RAMADAN.start);
      return { limit: s + graceMin * 60, end: hmToSec(R.RAMADAN.end) };
    }
    return { limit: startSec + graceMin * 60, end: hmToSec(R.DEFAULT_END) };
  }

  function computeEmployee(id, rows, ctx) {
    const emp = ctx.employees.get(id) || {};
    const name = emp.name || rows.find((r) => r.nameAtt)?.nameAtt || "";
    const dept = emp.dept || rows.find((r) => r.deptAtt)?.deptAtt || "";
    const saudi = isSaudi(emp.nat);
    const daily = isDailyHours(emp.rule);
    const satWork = !saudi && rows.some((r) => r.date && dow(r.date) === 6);
    const isWorkday = (iso) => !holidayOf(iso) && dow(iso) !== 5 && (dow(iso) !== 6 || satWork);

    const first = rows.find((r) => r.date);
    if (!first) return null;
    const fd = utc(first.date);
    let y = fd.getUTCFullYear(), m = fd.getUTCMonth();
    if (fd.getUTCDate() < R.PERIOD_START_DAY) m -= 1;
    const pFrom = isoFromUTC(new Date(Date.UTC(y, m, R.PERIOD_START_DAY)));
    const pTo = addDays(isoFromUTC(new Date(Date.UTC(y, m + 1, R.PERIOD_START_DAY))), -1);

    const present = new Set(rows.map((r) => r.date).filter(Boolean));

    // الإجازات المعتمدة
    const leaveDays = [];
    const leaveSet = new Set();
    for (const lv of ctx.leaves) {
      if (String(lv.employee_id).trim() !== id) continue;
      if (!APPROVED.includes(String(lv.status ?? "").trim().toLowerCase())) continue;
      const s = String(lv.start_date || "").slice(0, 10), e = String(lv.end_date || lv.start_date || "").slice(0, 10);
      if (!s || e < pFrom || s > pTo) continue;
      for (let d = s < pFrom ? pFrom : s; d <= (e > pTo ? pTo : e); d = addDays(d, 1)) {
        if (isWorkday(d) && !leaveSet.has(d)) { leaveSet.add(d); leaveDays.push({ date: d, type: lv.leave_type || "إجازة", id: lv.leave_id }); }
      }
    }

    // تسجيلات الغياب والأعذار
    const recs = ctx.absences.filter((a) => String(a.employee_id).trim() === id);
    const recFor = (d, types) => recs.filter((a) => types.includes(a.record_type) && String(a.start_date).slice(0, 10) <= d && String(a.end_date || a.start_date).slice(0, 10) >= d).pop();

    // الغياب
    const absences = [];
    for (let d = pFrom; d <= pTo; d = addDays(d, 1)) {
      if (!isWorkday(d) || present.has(d) || leaveSet.has(d)) continue;
      const rec = recFor(d, DAY_TYPES);
      absences.push({ date: d, type: rec ? rec.record_type : "غياب بدون إذن (غير مسجل)", reason: rec ? rec.reason || "" : "", excused: !!rec && rec.record_type === "غياب بإذن" });
    }

    // التأخير والخروج المبكر
    const details = [];
    let totLate = 0, totEarly = 0, totOver = 0, lateDays = 0, earlyDays = 0;
    const counted = (d) => d && isWorkday(d) && !holidayOf(d);

    if (!daily) {
      for (const r of rows) {
        let late = 0, early = 0;
        if (counted(r.date) && dow(r.date) !== 6) {
          const sh = shift(r.date, ctx.startSec, ctx.grace);
          if (r.first != null && r.first > sh.limit) late = Math.floor((r.first - sh.limit) / 60);
          if (r.last != null && r.last < sh.end) early = Math.floor((sh.end - r.last) / 60);
        }
        totLate += late; totEarly += early;
        if (late > 0) lateDays++;
        if (early > 0) earlyDays++;
        if (late > 0 || early > 0) details.push({ date: r.date, first: r.first, last: r.last, late, early });
      }
    } else {
      const byDay = new Map();
      for (const r of rows) {
        if (!r.date) continue;
        const g = byDay.get(r.date) || { date: r.date, first: null, last: null };
        if (r.first != null && (g.first == null || r.first < g.first)) g.first = r.first;
        if (r.last != null && (g.last == null || r.last > g.last)) g.last = r.last;
        byDay.set(r.date, g);
      }
      for (const g of [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))) {
        let late = 0, early = 0, over = 0, worked = 0;
        if (counted(g.date)) {
          const sh = shift(g.date, ctx.startSec, ctx.grace);
          if (g.first != null && g.last != null) worked = Math.max(0, Math.floor((g.last - g.first) / 60));
          if (g.first != null && g.first > sh.limit) late = Math.floor((g.first - sh.limit) / 60);
          if (g.last != null && g.last > sh.end) over = Math.floor((g.last - sh.end) / 60);
          if (g.last != null && g.last < sh.end) early = Math.floor((sh.end - g.last) / 60);
        }
        totLate += late; totEarly += early; totOver += over;
        if (late > 0) lateDays++;
        if (early > 0) earlyDays++;
        if (late > 0 || early > 0 || over > 0) details.push({ ...g, late, early, over, worked });
      }
    }
    details.sort((a, b) => a.date.localeCompare(b.date));
    for (const d of details) {
      const rec = recFor(d.date, LATE_TYPES);
      d.excuse = rec ? rec.record_type + (rec.reason ? ` — ${rec.reason}` : "") : "";
    }
    const excuses = recs.filter((a) => LATE_TYPES.includes(a.record_type) && String(a.end_date || a.start_date).slice(0, 10) >= pFrom && String(a.start_date).slice(0, 10) <= pTo);

    return {
      id, name, nameEn: emp.nameEn || "", dept, job: emp.job || "", nat: emp.nat || "",
      saudi, daily, satWork, pFrom, pTo, inEmployees: !!ctx.employees.get(id),
      lateDays, totLate, earlyDays, totEarly, totOver,
      absences, excusedDays: absences.filter((a) => a.excused).length,
      leaveDays: leaveDays.sort((a, b) => a.date.localeCompare(b.date)),
      details, excuses,
    };
  }

  async function processFile(file, startHM, grace) {
    const A = window.APP;
    const rows = await readAttendanceFile(file);
    if (!rows.length) throw new Error("الملف مفيهوش بيانات بصمة");
    const [leaves, absences] = await Promise.all([A.loadKind("leaves", true), A.loadKind("absences", true)]);
    const ctx = { employees: A.state.employees, leaves, absences, startSec: hmToSec(startHM), grace: +grace || 0 };
    const groups = new Map();
    for (const r of rows) { if (!groups.has(r.id)) groups.set(r.id, []); groups.get(r.id).push(r); }
    const out = [];
    for (const [id, rs] of groups) { const res = computeEmployee(id, rs, ctx); if (res) out.push(res); }
    return out.sort((a, b) => (b.totLate + b.totEarly) - (a.totLate + a.totEarly));
  }

  // =========================================================
  // الصفحة
  // =========================================================
  const view = { results: null, selected: null, fileName: "", start: R.DEFAULT_START, grace: R.DEFAULT_GRACE };

  function render(root) {
    const A = window.APP, esc = A.esc;
    root.innerHTML = `
      <div class="page-head">
        <div><h2>📈 تقرير البصمة</h2><p>ارفع ملف البصمة (Excel) — التأخير والخروج المبكر والغياب بيتحسبوا تلقائيًا، والإجازات المعتمدة والأعذار المسجلة بتتربط لوحدها.</p></div>
      </div>
      <div class="card">
        <div class="upload-grid">
          <label class="dropzone" id="dropzone">
            <input type="file" id="att-file" accept=".xlsx,.xls" hidden>
            <div class="dz-icon">📄</div>
            <div class="dz-title" id="dz-title">${view.fileName ? esc(view.fileName) : "اسحب ملف البصمة هنا أو اضغط للاختيار"}</div>
            <div class="muted">Excel — ملف موظف واحد أو كل الموظفين</div>
          </label>
          <div class="upload-side">
            <label>🕗 بداية الدوام <input type="time" id="att-start" value="${esc(view.start)}"></label>
            <label>⏱ دقائق السماح <input type="number" id="att-grace" min="0" max="120" value="${esc(view.grace)}"></label>
            <button class="btn btn-primary btn-block" id="att-run" ${view.lastFile ? "" : "disabled"}>🔄 إعادة الحساب</button>
          </div>
        </div>
        <div class="rules-note">
          🕋 رمضان: ${fmtD(R.RAMADAN.from)} → ${fmtD(R.RAMADAN.to)} (${R.RAMADAN.start} — ${R.RAMADAN.end})
          &nbsp;·&nbsp; 🚪 نهاية الدوام ${R.DEFAULT_END}
          &nbsp;·&nbsp; 🎉 ${R.HOLIDAYS.map((h) => `${esc(h.name)} ${fmtD(h.from)} → ${fmtD(h.to)}`).join(" · ")}
        </div>
      </div>
      <div id="att-results"></div>`;

    const fileInput = $("#att-file");
    const dz = $("#dropzone");
    const run = async (file) => {
      view.start = $("#att-start").value || R.DEFAULT_START;
      view.grace = $("#att-grace").value || 0;
      A.loading(true, "جاري قراءة ملف البصمة والحساب...");
      try {
        view.results = await processFile(file, view.start, view.grace);
        view.lastFile = file; view.fileName = file.name;
        view.selected = view.results.length === 1 ? view.results[0].id : null;
        $("#dz-title").textContent = file.name;
        $("#att-run").disabled = false;
        A.toast(`✅ تم حساب ${view.results.length} موظف`, "ok");
      } catch (e) {
        A.toast("تعذّر قراءة الملف: " + A.errMsg(e), "bad");
      } finally {
        A.loading(false);
      }
      renderResults();
    };
    fileInput.addEventListener("change", () => fileInput.files[0] && run(fileInput.files[0]));
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) run(f); });
    $("#att-run").addEventListener("click", () => view.lastFile && run(view.lastFile));
    renderResults();
  }

  function $(s, r = document) { return r.querySelector(s); }

  function renderResults() {
    const A = window.APP, esc = A.esc;
    const box = $("#att-results");
    if (!box) return;
    if (!view.results) { box.innerHTML = ""; return; }
    if (!view.results.length) { box.innerHTML = `<div class="card muted">لا توجد بيانات بعد المعالجة.</div>`; return; }

    const many = view.results.length > 1;
    const sel = view.results.find((r) => r.id === view.selected);
    let html = "";

    if (many) {
      const tot = (k) => view.results.reduce((s, r) => s + r[k], 0);
      html += `
        <div class="kpis">
          <div class="kpi"><div class="v num">${view.results.length}</div><div class="l">عدد الموظفين في الملف</div></div>
          <div class="kpi warn"><div class="v num">${minToHM(tot("totLate"))}</div><div class="l">إجمالي التأخير</div></div>
          <div class="kpi warn"><div class="v num">${minToHM(tot("totEarly"))}</div><div class="l">إجمالي الخروج المبكر</div></div>
          <div class="kpi bad"><div class="v num">${view.results.reduce((s, r) => s + r.absences.length, 0)}</div><div class="l">أيام الغياب</div></div>
          <div class="kpi ok"><div class="v num">${view.results.reduce((s, r) => s + r.leaveDays.length, 0)}</div><div class="l">أيام إجازات معتمدة</div></div>
        </div>
        <div class="card">
          <div class="table-toolbar">
            <div class="right"><div class="card-title" style="margin:0">👥 ملخص كل الموظفين</div>
              <input type="search" id="sum-q" placeholder="🔎 بحث بالاسم أو الرقم" style="width:220px"></div>
            <div class="left">
              <button class="btn btn-sm" id="sum-xlsx">📥 تصدير Excel</button>
              <button class="btn btn-sm" id="sum-pdf-ar">🖨️ PDF للكل (عربي)</button>
              <button class="btn btn-sm" id="sum-pdf-en">🖨️ PDF for all (EN)</button>
            </div>
          </div>
          <div class="table-wrap"><table class="grid view-grid">
            <thead><tr><th>الرقم</th><th>الاسم</th><th>القسم</th><th>أيام التأخير</th><th>إجمالي التأخير</th><th>أيام الخروج المبكر</th><th>إجمالي الخروج</th><th>غياب بإذن</th><th>غياب بدون إذن</th><th>إجازات</th><th></th></tr></thead>
            <tbody id="sum-body"></tbody>
          </table></div>
        </div>`;
    }

    if (sel) html += employeeView(sel, many);
    box.innerHTML = html;

    if (many) {
      const fill = () => {
        const q = ($("#sum-q").value || "").trim().toLowerCase();
        $("#sum-body").innerHTML = view.results.filter((r) => !q || `${r.id} ${r.name}`.toLowerCase().includes(q)).map((r) => `
          <tr data-id="${esc(r.id)}" class="${r.id === view.selected ? "row-selected" : ""}">
            <td class="num">${esc(r.id)}</td><td><b>${esc(r.name || "—")}</b>${r.inEmployees ? "" : ' <span class="tag warn-tag">غير مسجل</span>'}</td><td class="muted">${esc(r.dept)}</td>
            <td class="num">${r.lateDays}</td><td class="num">${minToHM(r.totLate)}</td>
            <td class="num">${r.earlyDays}</td><td class="num">${minToHM(r.totEarly)}</td>
            <td class="num">${r.excusedDays}</td><td class="num ${r.absences.length - r.excusedDays ? "txt-bad" : ""}">${r.absences.length - r.excusedDays}</td>
            <td class="num">${r.leaveDays.length}</td>
            <td><button class="btn btn-sm show-emp">عرض</button></td>
          </tr>`).join("");
      };
      fill();
      $("#sum-q").addEventListener("input", fill);
      $("#sum-body").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;
        view.selected = tr.dataset.id;
        renderResults();
        $("#emp-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      $("#sum-xlsx").addEventListener("click", exportSummary);
      $("#sum-pdf-ar").addEventListener("click", () => printReports(view.results, "ar"));
      $("#sum-pdf-en").addEventListener("click", () => printReports(view.results, "en"));
    }
    if (sel) {
      $("#pdf-ar").addEventListener("click", () => printReports([sel], "ar"));
      $("#pdf-en").addEventListener("click", () => printReports([sel], "en"));
      box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        box.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
        box.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
      }));
    }
  }

  function employeeView(r, many) {
    const esc = window.APP.esc;
    const unexcused = r.absences.length - r.excusedDays;
    const deficit = r.totLate + r.totEarly;
    const net = r.totOver - deficit;
    const [, mm, yy] = fmtD(r.pTo).split("/");
    const netBox = r.daily
      ? `<div class="net-box"><div class="net-title">🧾 نتيجة الاحتساب (مستثنى — ساعات يومية)</div>
          <div class="net-big ${net > 0 ? "txt-ok" : net < 0 ? "txt-bad" : ""}">${net > 0 ? "صافي إضافي" : net < 0 ? "صافي عجز" : "متعادل"}: <span dir="ltr">${minToHM(net)}</span></div>
          <div class="muted">الصافي = الإضافي (${minToHM(r.totOver)}) − (التأخير ${minToHM(r.totLate)} + الخروج المبكر ${minToHM(r.totEarly)})</div></div>`
      : `<div class="net-box"><div class="net-title">🧾 ملخص الاحتساب</div>
          <div class="net-big txt-bad">إجمالي التأخيرات: ${minToHM(deficit)}</div>
          <div class="muted">التأخير ${minToHM(r.totLate)} + الخروج المبكر ${minToHM(r.totEarly)}</div></div>`;

    const detailRows = r.details.map((d) => `<tr>
        <td>${DAY_AR[dow(d.date)]}</td><td class="num">${fmtD(d.date)}</td>
        <td class="num">${secToHM(d.first)}</td><td class="num">${secToHM(d.last)}</td>
        ${r.daily ? `<td class="num">${minToHM(d.worked)}</td>` : ""}
        <td class="num ${d.late ? "txt-bad" : ""}">${minToHM(d.late)}</td><td class="num ${d.early ? "txt-bad" : ""}">${minToHM(d.early)}</td>
        ${r.daily ? `<td class="num ${d.over ? "txt-ok" : ""}">${minToHM(d.over)}</td>` : ""}
        <td>${d.excuse ? `<span class="tag">${esc(d.excuse)}</span>` : "—"}</td></tr>`).join("");

    return `
      <div id="emp-view" class="stack-16">
        <div class="emp-hero card">
          <div>
            <div class="muted">تقرير الموظف عن شهر ${mm} - ${yy} · الفترة ${fmtD(r.pFrom)} → ${fmtD(r.pTo)}</div>
            <div class="emp-name">👤 ${esc(r.name || "—")}</div>
            <div class="muted">${esc(r.nameEn)}</div>
            <div class="emp-meta">
              <span class="tag">الرقم الوظيفي: ${esc(r.id)}</span>
              ${r.dept ? `<span class="tag">${esc(r.dept)}</span>` : ""}
              ${r.job ? `<span class="tag">${esc(r.job)}</span>` : ""}
              ${r.nat ? `<span class="tag">${esc(r.nat)}</span>` : ""}
              <span class="tag">${r.satWork ? "إجازة الجمعة فقط" : "إجازة الجمعة والسبت"}</span>
              ${r.daily ? '<span class="tag warn-tag">مستثنى — ساعات يومية</span>' : ""}
              ${r.inEmployees ? "" : '<span class="tag warn-tag">⚠️ غير موجود في جدول الموظفين</span>'}
            </div>
          </div>
          <div class="emp-actions">
            <button class="btn btn-primary" id="pdf-ar">🖨️ PDF عربي</button>
            <button class="btn" id="pdf-en">🖨️ PDF English</button>
          </div>
        </div>

        <div class="kpis">
          <div class="kpi warn"><div class="v num">${r.lateDays}</div><div class="l">أيام التأخير</div></div>
          <div class="kpi warn"><div class="v num">${minToHM(r.totLate)}</div><div class="l">إجمالي التأخير</div></div>
          <div class="kpi warn"><div class="v num">${r.earlyDays}</div><div class="l">أيام الخروج المبكر</div></div>
          <div class="kpi warn"><div class="v num">${minToHM(r.totEarly)}</div><div class="l">إجمالي الخروج المبكر</div></div>
          <div class="kpi"><div class="v num">${r.absences.length}</div><div class="l">إجمالي أيام الغياب</div></div>
          <div class="kpi ok"><div class="v num">${r.excusedDays}</div><div class="l">✅ غياب بإذن</div></div>
          <div class="kpi bad"><div class="v num">${unexcused}</div><div class="l">🚫 غياب بدون إذن</div></div>
          <div class="kpi ok"><div class="v num">${r.leaveDays.length}</div><div class="l">🏖️ إجازات معتمدة</div></div>
        </div>

        ${netBox}

        <div class="card">
          <div class="tabs">
            <button class="tab active" data-tab="details">🧾 التفاصيل اليومية (${r.details.length})</button>
            <button class="tab" data-tab="abs">🚫 الغياب والإجازات (${r.absences.length + r.leaveDays.length})</button>
          </div>
          <div data-pane="details">
            ${r.details.length ? `<div class="table-wrap"><table class="grid view-grid"><thead><tr>
              <th>اليوم</th><th>التاريخ</th><th>أول بصمة</th><th>آخر بصمة</th>${r.daily ? "<th>ساعات العمل</th>" : ""}
              <th>التأخير</th><th>الخروج المبكر</th>${r.daily ? "<th>الإضافي</th>" : ""}<th>العذر</th>
            </tr></thead><tbody>${detailRows}</tbody></table></div>` : `<div class="ok-box">لا يوجد تأخير أو خروج مبكر ✅</div>`}
          </div>
          <div data-pane="abs" hidden>
            <div class="two-col">
              <div>
                <h4>🚫 أيام الغياب</h4>
                ${r.absences.length ? `<div class="table-wrap"><table class="grid view-grid"><thead><tr><th>اليوم</th><th>التاريخ</th><th>النوع</th><th>السبب</th></tr></thead><tbody>
                  ${r.absences.map((a) => `<tr><td>${DAY_AR[dow(a.date)]}</td><td class="num">${fmtD(a.date)}</td>
                    <td><span class="tag ${a.excused ? "ok-tag" : "bad-tag"}">${esc(a.type)}</span></td><td>${esc(a.reason || "—")}</td></tr>`).join("")}
                </tbody></table></div>
                ${unexcused ? `<p class="muted">💡 لتحديد نوع أيام الغياب غير المسجلة، سجّلها من صفحة <a href="#absences">⏰ الغياب والتأخير</a> ثم اضغط "إعادة الحساب".</p>` : ""}` : `<div class="ok-box">لا يوجد غياب ✅</div>`}
              </div>
              <div>
                <h4>🏖️ الإجازات المعتمدة</h4>
                ${r.leaveDays.length ? `<div class="table-wrap"><table class="grid view-grid"><thead><tr><th>اليوم</th><th>التاريخ</th><th>نوع الإجازة</th></tr></thead><tbody>
                  ${r.leaveDays.map((l) => `<tr><td>${DAY_AR[dow(l.date)]}</td><td class="num">${fmtD(l.date)}</td><td>${esc(l.type)}</td></tr>`).join("")}
                </tbody></table></div>` : `<div class="ok-box">لا توجد إجازات معتمدة ضمن الفترة</div>`}
              </div>
            </div>
          </div>
        </div>
        ${many ? "" : ""}
      </div>`;
  }

  // ---------------- التصدير ----------------
  function exportSummary() {
    const out = view.results.map((r) => ({
      "الرقم الوظيفي": r.id, "الاسم": r.name, "القسم": r.dept, "الفترة من": r.pFrom, "الفترة إلى": r.pTo,
      "أيام التأخير": r.lateDays, "إجمالي التأخير (دقيقة)": r.totLate, "إجمالي التأخير": minToHM(r.totLate),
      "أيام الخروج المبكر": r.earlyDays, "إجمالي الخروج المبكر (دقيقة)": r.totEarly, "إجمالي الخروج المبكر": minToHM(r.totEarly),
      "الإضافي (دقيقة)": r.totOver, "أيام الغياب": r.absences.length, "غياب بإذن": r.excusedDays,
      "غياب بدون إذن": r.absences.length - r.excusedDays, "إجازات معتمدة": r.leaveDays.length,
      "طريقة الاحتساب": r.daily ? "ساعات يومية" : "عادي",
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    ws["!cols"] = Object.keys(out[0]).map((h) => ({ wch: Math.max(12, h.length + 4) }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "ملخص البصمة");
    XLSX.writeFile(wb, `attendance_summary_${view.results[0].pFrom}_${view.results[0].pTo}.xlsx`);
  }

  // ---------------- PDF (طباعة) ----------------
  const TX = {
    ar: {
      dir: "rtl", title: (m, y) => `تقرير الموظف عن شهر ${m} - ${y}`, period: "الفترة", name: "الاسم", no: "الرقم الوظيفي", dept: "القسم",
      job: "الوظيفة", nat: "الجنسية", sched: "أيام الإجازة", schedFri: "الجمعة فقط", schedFriSat: "الجمعة والسبت", rule: "طريقة الاحتساب",
      ruleDaily: "ساعات يومية (مستثنى)", ruleNormal: "عادي", lateDays: "أيام التأخير", totLate: "إجمالي التأخير", earlyDays: "أيام الخروج المبكر",
      totEarly: "إجمالي الخروج المبكر", absDays: "أيام الغياب", excused: "بإذن", unexcused: "بدون إذن", leaves: "إجازات معتمدة",
      deficit: "إجمالي التأخيرات", over: "الإضافي", net: "الصافي", secDetails: "التأخير والخروج المبكر", secAbs: "الغياب", secExc: "أعذار التأخير والخروج المبكر",
      secLeaves: "الإجازات المعتمدة", day: "اليوم", date: "التاريخ", first: "أول بصمة", last: "آخر بصمة", worked: "ساعات العمل", late: "التأخير",
      early: "الخروج المبكر", excuse: "العذر", type: "النوع", reason: "السبب", from: "من", to: "إلى", none: "لا يوجد",
      printed: "تاريخ الطباعة", empSign: "توقيع الموظف", mgrSign: "توقيع المدير المباشر", days: DAY_AR,
      typeName: (t) => t,
    },
    en: {
      dir: "ltr", title: (m, y) => `Employee Attendance Report — ${m}/${y}`, period: "Period", name: "Name", no: "Employee No.", dept: "Department",
      job: "Job Title", nat: "Nationality", sched: "Weekend", schedFri: "Friday only", schedFriSat: "Friday & Saturday", rule: "Calculation",
      ruleDaily: "Daily hours (exempt)", ruleNormal: "Standard", lateDays: "Late Days", totLate: "Total Late", earlyDays: "Early Leave Days",
      totEarly: "Total Early Leave", absDays: "Absent Days", excused: "Excused", unexcused: "Unexcused", leaves: "Approved Leave Days",
      deficit: "Total Deficit", over: "Overtime", net: "Net", secDetails: "Late Arrival & Early Leave", secAbs: "Absences", secExc: "Late / Early Leave Excuses",
      secLeaves: "Approved Leaves", day: "Day", date: "Date", first: "First In", last: "Last Out", worked: "Worked", late: "Late",
      early: "Early Leave", excuse: "Excuse", type: "Type", reason: "Reason", from: "From", to: "To", none: "None",
      printed: "Printed on", empSign: "Employee Signature", mgrSign: "Line Manager Signature", days: DAY_EN,
      typeName: (t) => ({
        "غياب بإذن": "Excused absence", "غياب بدون إذن": "Unexcused absence", "غياب بدون إذن (غير مسجل)": "Unexcused (not registered)",
        "تأخير بعذر": "Excused late", "خروج مبكر بإذن": "Approved early leave", "أخرى": "Other",
        "سنوية": "Annual", "مرضية": "Sick", "بدون راتب": "Unpaid", "اضطرارية": "Emergency", "رسمية": "Official", "إجازة": "Leave",
      }[t] || t),
    },
  };

  const LOGO_URL = () => new URL("assets/logo.png", location.href).href;

  function reportHTML(r, lang) {
    const T = TX[lang], esc = window.APP.esc;
    const [, mm, yy] = fmtD(r.pTo).split("/");
    const unexcused = r.absences.length - r.excusedDays;
    const table = (head, rows) => rows.length
      ? `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<div class="none">${T.none}</div>`;
    const box = (l, v, cls = "") => `<div class="box ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`;

    return `<section class="report" dir="${T.dir}">
      <header>
        <div><h1>${T.title(mm, yy)}</h1><div class="sub">${T.period}: ${fmtD(r.pFrom)} — ${fmtD(r.pTo)}</div></div>
        <img class="logo" src="${LOGO_URL()}" alt="">
      </header>
      <div class="info">
        <div><b>${T.name}:</b> ${esc(lang === "en" && r.nameEn ? r.nameEn : r.name)}${lang === "ar" && r.nameEn ? ` <span class="sub">(${esc(r.nameEn)})</span>` : ""}</div>
        <div><b>${T.no}:</b> ${esc(r.id)}</div>
        <div><b>${T.dept}:</b> ${esc(r.dept || "—")}</div>
        <div><b>${T.job}:</b> ${esc(r.job || "—")}</div>
        <div><b>${T.nat}:</b> ${esc(r.nat || "—")}</div>
        <div><b>${T.sched}:</b> ${r.satWork ? T.schedFri : T.schedFriSat} · <b>${T.rule}:</b> ${r.daily ? T.ruleDaily : T.ruleNormal}</div>
      </div>
      <div class="boxes">
        ${box(T.lateDays, r.lateDays)}${box(T.totLate, minToHM(r.totLate))}${box(T.earlyDays, r.earlyDays)}${box(T.totEarly, minToHM(r.totEarly))}
        ${box(T.absDays, `${r.absences.length} <small>(${T.excused} ${r.excusedDays} · ${T.unexcused} ${unexcused})</small>`)}${box(T.leaves, r.leaveDays.length)}
        ${r.daily ? box(T.over, minToHM(r.totOver)) + box(T.net, `<span dir="ltr">${minToHM(r.totOver - r.totLate - r.totEarly)}</span>`, "hl") : box(T.deficit, minToHM(r.totLate + r.totEarly), "hl")}
      </div>

      <h2>${T.secDetails}</h2>
      ${table(
        [T.day, T.date, T.first, T.last, ...(r.daily ? [T.worked] : []), T.late, T.early, ...(r.daily ? [T.over] : []), T.excuse],
        r.details.map((d) => [T.days[dow(d.date)], fmtD(d.date), secToHM(d.first), secToHM(d.last), ...(r.daily ? [minToHM(d.worked)] : []),
          minToHM(d.late), minToHM(d.early), ...(r.daily ? [minToHM(d.over)] : []), esc(d.excuse ? T.typeName(d.excuse.split(" — ")[0]) + (d.excuse.includes(" — ") ? " — " + d.excuse.split(" — ").slice(1).join(" — ") : "") : "—")])
      )}

      <h2>${T.secAbs}</h2>
      ${table([T.day, T.date, T.type, T.reason], r.absences.map((a) => [T.days[dow(a.date)], fmtD(a.date), esc(T.typeName(a.type)), esc(a.reason || "—")]))}

      ${r.excuses.length ? `<h2>${T.secExc}</h2>${table([T.from, T.to, T.type, T.reason], r.excuses.map((x) => [fmtD(String(x.start_date).slice(0, 10)), fmtD(String(x.end_date || x.start_date).slice(0, 10)), esc(T.typeName(x.record_type)), esc(x.reason || "—")]))}` : ""}

      <h2>${T.secLeaves}</h2>
      ${table([T.day, T.date, T.type], r.leaveDays.map((l) => [T.days[dow(l.date)], fmtD(l.date), esc(T.typeName(l.type))]))}

      <div class="signs"><div>${T.empSign}<span></span></div><div>${T.mgrSign}<span></span></div></div>
      <footer>${T.printed}: ${fmtD(new Date().toISOString().slice(0, 10))}</footer>
    </section>`;
  }

  function printReports(list, lang) {
    const T = TX[lang];
    const css = `
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11.5px; }
      .report { page-break-after: always; }
      .report:last-child { page-break-after: auto; }
      header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 10px; }
      h1 { font-size: 19px; margin: 0; color: #1e3a8a; }
      header .logo { height: 52px; width: auto; }
      h2 { font-size: 13.5px; margin: 14px 0 6px; color: #1e3a8a; border-inline-start: 4px solid #2563eb; padding-inline-start: 8px; }
      .sub { color: #64748b; font-size: 11px; }
      .info { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; background: #f1f5fb; border: 1px solid #dbe3ef; border-radius: 8px; padding: 8px 12px; }
      .boxes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
      .box { border: 1px solid #dbe3ef; border-radius: 8px; padding: 6px 8px; text-align: center; }
      .box .v { font-size: 15px; font-weight: 800; color: #1d4ed8; }
      .box .v small { font-size: 9.5px; color: #475569; font-weight: 600; }
      .box .l { font-size: 10px; color: #475569; font-weight: 700; }
      .box.hl { background: #fef2f2; border-color: #fecaca; } .box.hl .v { color: #b91c1c; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #1e3a8a; color: #fff; font-weight: 700; padding: 5px 6px; font-size: 11px; text-align: start; }
      td { border-bottom: 1px solid #e2e8f0; padding: 4px 6px; text-align: start; }
      tr:nth-child(even) td { background: #f8fafc; }
      thead { display: table-header-group; } tr { page-break-inside: avoid; }
      .none { color: #64748b; padding: 6px 2px; }
      .signs { display: flex; gap: 40px; margin-top: 28px; }
      .signs div { flex: 1; font-weight: 700; color: #334155; }
      .signs span { display: block; border-bottom: 1px solid #94a3b8; height: 28px; }
      footer { margin-top: 14px; color: #94a3b8; font-size: 10px; text-align: center; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;
    const html = `<!doctype html><html lang="${lang}" dir="${T.dir}"><head><meta charset="utf-8"><title>${list.length === 1 ? (list[0].name || list[0].id) : "Attendance"} — ${list[0].pTo}</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet"><style>${css}</style></head>
      <body>${list.map((r) => reportHTML(r, lang)).join("")}</body></html>`;
    let frame = document.getElementById("print-frame");
    if (frame) frame.remove();
    frame = document.createElement("iframe");
    frame.id = "print-frame";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:1200px;border:0";
    document.body.appendChild(frame);
    frame.srcdoc = html;
    frame.onload = () => {
      const w = frame.contentWindow;
      const go = () => { w.focus(); w.print(); };
      const imgs = [...w.document.images].map((im) => (im.complete ? Promise.resolve() : new Promise((ok) => { im.onload = im.onerror = ok; })));
      const fonts = w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready : Promise.resolve();
      Promise.all([fonts, ...imgs]).then(() => setTimeout(go, 150));
    };
  }

  window.PAGES = window.PAGES || {};
  window.PAGES.attendance = render;
  // للاختبار
  window.ATT_ENGINE = { readAttendanceFile, computeEmployee, processFile, reportHTML, parsePunch, parseDateCell };
})();
