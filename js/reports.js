/* =========================================================
   التقارير والمؤشرات
   - مؤشرات عامة + رسوم بيانية
   - إجماليات الموظفين
   - تقرير موظف
   - الإجازات المرضية (حد 30 يوم في السنة)
   ========================================================= */
(() => {
  "use strict";

  const SICK_QUOTA = 30;
  const MAIN_TYPES = ["مرضية", "سنوية", "اضطرارية", "بدون راتب"];
  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const $ = (s, r = document) => r.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (v) => String(v || "").slice(0, 10);
  const fmtD = (d) => (d ? d.split("-").reverse().join("/") : "");
  const n = (v) => Number(v || 0).toLocaleString("en-US");
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
  const addDay = (d, k) => { const x = new Date(Date.parse(d) + k * 864e5); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };

  const view = {
    tab: "totals",
    from: `${new Date().getFullYear()}-01-01`,
    to: `${new Date().getFullYear()}-12-31`,
    dept: "", q: "", sort: { key: "total", dir: -1 }, sickFilter: "", empId: "",
  };

  // ---------------- الحساب ----------------
  // يقص السجل على حدود الفترة ويرجّع عدد الأيام جوه الفترة
  function clip(rec, from, to) {
    const s = iso(rec.start_date), e = iso(rec.end_date) || s;
    if (!s || e < from || s > to) return null;
    const cs = s < from ? from : s, ce = e > to ? to : e;
    return { s: cs, e: ce, days: Math.max(dayDiff(cs, ce), 0) };
  }

  function compute(A, ignoreFilters = false) {
    const leaves = (A.state.data.leaves || []).filter((l) => String(l.status || "").trim() !== "مرفوضة");
    const abs = A.state.data.absences || [];
    const emps = A.state.employees;
    const per = new Map();
    const get = (id) => {
      if (!per.has(id)) {
        const e = emps.get(id) || {};
        per.set(id, { id, name: e.name || "", dept: e.dept || "", job: e.job || "", types: {}, total: 0, count: 0,
          sickCount: 0, excused: 0, unexcused: 0, lateExc: 0, last: "", leaves: [], regs: [] });
      }
      return per.get(id);
    };
    const months = Array.from({ length: 12 }, () => ({ total: 0, sick: 0 }));
    const byType = {};

    for (const l of leaves) {
      const c = clip(l, view.from, view.to);
      if (!c) continue;
      const id = String(l.employee_id).trim();
      const p = get(id);
      if (!p.name) p.name = l.name_ar || ""; if (!p.dept) p.dept = l.department || "";
      const t = l.leave_type || "أخرى";
      p.types[t] = (p.types[t] || 0) + c.days;
      p.total += c.days; p.count++;
      if (t === "مرضية") p.sickCount++;
      if (c.e > p.last) p.last = c.e;
      p.leaves.push({ ...l, days: c.days });
      byType[t] = (byType[t] || 0) + c.days;
      // توزيع الأيام على الشهور
      for (let d = c.s; d <= c.e; d = addDay(d, 1)) {
        const m = +d.slice(5, 7) - 1;
        months[m].total++;
        if (t === "مرضية") months[m].sick++;
      }
    }
    for (const a of abs) {
      const c = clip(a, view.from, view.to);
      if (!c) continue;
      const p = get(String(a.employee_id).trim());
      if (!p.name) p.name = a.name_ar || ""; if (!p.dept) p.dept = a.department || "";
      if (a.record_type === "غياب بإذن") p.excused += c.days;
      else if (a.record_type === "غياب بدون إذن") p.unexcused += c.days;
      else p.lateExc++;
      p.regs.push({ ...a, days: c.days });
    }
    let list = [...per.values()].map((p) => ({ ...p, sick: p.types["مرضية"] || 0, annual: p.types["سنوية"] || 0,
      emergency: p.types["اضطرارية"] || 0, unpaid: p.types["بدون راتب"] || 0,
      other: Object.entries(p.types).filter(([t]) => !MAIN_TYPES.includes(t)).reduce((s, [, v]) => s + v, 0) }));
    const depts = [...new Set(list.map((p) => p.dept).filter(Boolean))].sort();
    if (view.dept && !ignoreFilters) list = list.filter((p) => p.dept === view.dept);
    if (view.q && !ignoreFilters) { const q = view.q.toLowerCase(); list = list.filter((p) => `${p.id} ${p.name}`.toLowerCase().includes(q)); }
    return { list, depts, months, byType };
  }

  const sickStatus = (d) => (d >= SICK_QUOTA ? ["bad", "🔴 تجاوز الحد"] : d >= SICK_QUOTA * 0.7 ? ["warn", "🟡 اقترب من الحد"] : ["ok", "🟢 طبيعي"]);

  // ---------------- الرسوم البيانية (بدون مكتبات) ----------------
  function barsMonths(months) {
    const max = Math.max(1, ...months.map((m) => m.total));
    return `<div class="chart-months">${months.map((m, i) => `
      <div class="cm-col" title="${MONTHS[i]}: ${m.total} يوم (مرضية ${m.sick})">
        <div class="cm-val num">${m.total || ""}</div>
        <div class="cm-bar"><div class="cm-fill" style="height:${(m.total / max) * 100}%"><div class="cm-sick" style="height:${m.total ? (m.sick / m.total) * 100 : 0}%"></div></div></div>
        <div class="cm-lbl">${MONTHS[i].slice(0, 3)}</div>
      </div>`).join("")}</div>
      <div class="legend"><span><i class="lg-total"></i> كل الإجازات</span><span><i class="lg-sick"></i> مرضية</span></div>`;
  }
  function barsH(entries, esc) {
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return `<div class="hbars">${entries.map(([k, v]) => `
      <div class="hb-row"><div class="hb-lbl" title="${esc(k)}">${esc(k)}</div>
        <div class="hb-track"><div class="hb-fill" style="width:${(v / max) * 100}%"></div></div><div class="hb-val num">${n(v)}</div></div>`).join("")}</div>`;
  }

  // =========================================================
  // الصفحة
  // =========================================================
  async function render(root) {
    const A = window.APP, esc = A.esc;
    root.innerHTML = `<div class="card muted">جاري تحميل التقارير...</div>`;
    try { await Promise.all([A.loadKind("leaves"), A.loadKind("absences")]); }
    catch (e) { root.innerHTML = `<div class="card"><div class="form-error">تعذّر تحميل البيانات: ${esc(A.errMsg(e))}</div></div>`; return; }

    root.innerHTML = `
      <div class="page-head"><div><h2>📑 التقارير والمؤشرات</h2><p>إجماليات الإجازات والغياب لكل الموظفين، وتقرير لكل موظف، ومتابعة الإجازات المرضية.</p></div></div>
      <div class="card">
        <div class="filters rep-filters">
          <label>من تاريخ <input type="date" id="r-from" value="${view.from}"></label>
          <label>إلى تاريخ <input type="date" id="r-to" value="${view.to}"></label>
          <label>القسم <select id="r-dept"></select></label>
          <label>🔎 بحث بالاسم أو الرقم <input type="search" id="r-q" value="${esc(view.q)}" placeholder="مثال: 27164 أو محمد"></label>
        </div>
      </div>
      <div class="kpis" id="r-kpis"></div>
      <div class="charts-grid">
        <div class="card"><div class="card-title">📅 أيام الإجازات حسب الشهر</div><div id="r-ch-months"></div></div>
        <div class="card"><div class="card-title">🏷️ حسب نوع الإجازة</div><div id="r-ch-types"></div></div>
        <div class="card"><div class="card-title">🏢 أكثر الأقسام إجازات</div><div id="r-ch-depts"></div></div>
      </div>
      <div class="card">
        <div class="tabs" id="r-tabs">
          <button class="tab" data-t="totals">👥 إجماليات الموظفين</button>
          <button class="tab" data-t="emp">👤 تقرير موظف</button>
          <button class="tab" data-t="sick">🤒 الإجازات المرضية</button>
        </div>
        <div id="r-body"></div>
      </div>`;

    const onF = () => {
      view.from = $("#r-from").value || "0000-01-01";
      view.to = $("#r-to").value || "9999-12-31";
      view.dept = $("#r-dept").value;
      view.q = $("#r-q").value.trim();
      draw();
    };
    ["#r-from", "#r-to", "#r-dept"].forEach((s) => $(s).addEventListener("change", onF));
    let t; $("#r-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(onF, 200); });
    $("#r-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { view.tab = b.dataset.t; draw(); } });

    function draw() {
      const data = compute(A);
      const { list } = data;
      // الأقسام
      const sel = $("#r-dept");
      sel.innerHTML = `<option value="">كل الأقسام</option>` + data.depts.map((d) => `<option ${d === view.dept ? "selected" : ""}>${esc(d)}</option>`).join("");
      // المؤشرات
      const sum = (k) => list.reduce((s, p) => s + p[k], 0);
      const over = list.filter((p) => p.sick >= SICK_QUOTA).length;
      const near = list.filter((p) => p.sick >= SICK_QUOTA * 0.7 && p.sick < SICK_QUOTA).length;
      const withLeaves = list.filter((p) => p.total > 0).length;
      $("#r-kpis").innerHTML = [
        ["", n(sum("total")), "إجمالي أيام الإجازات"],
        ["", n(sum("count")), "عدد طلبات الإجازة"],
        ["", n(withLeaves), "موظفين عندهم إجازات"],
        ["bad", n(sum("sick")), "أيام مرضية"],
        ["ok", n(sum("annual")), "أيام سنوية"],
        ["bad", n(over), `🔴 تجاوزوا ${SICK_QUOTA} يوم مرضي`],
        ["warn", n(near), "🟡 اقتربوا من حد المرضية"],
        ["ok", n(sum("excused")), "أيام غياب بإذن"],
        ["bad", n(sum("unexcused")), "أيام غياب بدون إذن"],
        ["warn", n(sum("lateExc")), "أعذار تأخير / خروج"],
      ].map(([c, v, l]) => `<div class="kpi ${c}"><div class="v num">${v}</div><div class="l">${esc(l)}</div></div>`).join("");
      // الرسوم
      const months = Array.from({ length: 12 }, () => ({ total: 0, sick: 0 }));
      for (const p of list) for (const l of p.leaves) {
        const c = clip(l, view.from, view.to);
        for (let d = c.s; d <= c.e; d = addDay(d, 1)) { const m = +d.slice(5, 7) - 1; months[m].total++; if (l.leave_type === "مرضية") months[m].sick++; }
      }
      $("#r-ch-months").innerHTML = barsMonths(months);
      const types = {}; for (const p of list) for (const [k, v] of Object.entries(p.types)) types[k] = (types[k] || 0) + v;
      $("#r-ch-types").innerHTML = Object.keys(types).length ? barsH(Object.entries(types).sort((a, b) => b[1] - a[1]), esc) : `<div class="muted">لا توجد بيانات</div>`;
      const dep = {}; for (const p of list) if (p.total) dep[p.dept || "بدون قسم"] = (dep[p.dept || "بدون قسم"] || 0) + p.total;
      $("#r-ch-depts").innerHTML = Object.keys(dep).length ? barsH(Object.entries(dep).sort((a, b) => b[1] - a[1]).slice(0, 8), esc) : `<div class="muted">لا توجد بيانات</div>`;
      // التبويب
      document.querySelectorAll("#r-tabs [data-t]").forEach((b) => b.classList.toggle("active", b.dataset.t === view.tab));
      if (view.tab === "totals") drawTotals(list);
      else if (view.tab === "emp") drawEmployee();
      else drawSick(list);
    }

    // ---------- إجماليات الموظفين ----------
    const COLS = [
      ["id", "الرقم"], ["name", "الاسم"], ["dept", "القسم"], ["sick", "مرضية"], ["annual", "سنوية"], ["emergency", "اضطرارية"],
      ["unpaid", "بدون راتب"], ["other", "أخرى"], ["total", "إجمالي الإجازات"], ["excused", "غياب بإذن"], ["unexcused", "غياب بدون إذن"], ["lateExc", "أعذار تأخير"], ["last", "آخر إجازة"],
    ];
    function sorted(list) {
      const { key, dir } = view.sort;
      return [...list].sort((a, b) => (typeof a[key] === "number" ? (a[key] - b[key]) * dir : String(a[key]).localeCompare(String(b[key]), "ar") * dir));
    }
    function drawTotals(list) {
      const rows = sorted(list);
      $("#r-body").innerHTML = `
        <div class="table-toolbar">
          <div class="right"><span class="muted">${n(rows.length)} موظف — الفترة ${fmtD(view.from)} → ${fmtD(view.to)}</span></div>
          <div class="left"><button class="btn btn-sm" id="t-xlsx">📥 Excel</button><button class="btn btn-sm" id="t-pdf">🖨️ PDF</button></div>
        </div>
        <div class="table-wrap"><table class="grid view-grid sortable"><thead><tr>
          ${COLS.map(([k, l]) => `<th data-k="${k}" class="${view.sort.key === k ? "sorted" : ""}">${l}${view.sort.key === k ? (view.sort.dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("")}
        </tr></thead><tbody>
          ${rows.map((p) => `<tr data-id="${esc(p.id)}" class="clickable">
            <td class="num">${esc(p.id)}</td><td><b>${esc(p.name || "—")}</b></td><td class="muted">${esc(p.dept)}</td>
            <td class="num ${p.sick >= SICK_QUOTA ? "txt-bad" : ""}">${p.sick || ""}</td><td class="num">${p.annual || ""}</td><td class="num">${p.emergency || ""}</td>
            <td class="num">${p.unpaid || ""}</td><td class="num">${p.other || ""}</td><td class="num"><b>${p.total || ""}</b></td>
            <td class="num">${p.excused || ""}</td><td class="num ${p.unexcused ? "txt-bad" : ""}">${p.unexcused || ""}</td><td class="num">${p.lateExc || ""}</td>
            <td class="num">${fmtD(p.last)}</td></tr>`).join("") || `<tr class="empty-row"><td colspan="13">لا توجد بيانات في الفترة دي</td></tr>`}
        </tbody></table></div>
        <p class="muted">💡 اضغط على أي موظف لفتح تقريره — واضغط على عنوان أي عمود للترتيب.</p>`;
      $("#r-body thead").addEventListener("click", (e) => {
        const th = e.target.closest("[data-k]"); if (!th) return;
        view.sort = { key: th.dataset.k, dir: view.sort.key === th.dataset.k ? -view.sort.dir : (["id", "name", "dept"].includes(th.dataset.k) ? 1 : -1) };
        drawTotals(list);
      });
      $("#r-body tbody").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-id]"); if (!tr) return;
        view.empId = tr.dataset.id; view.tab = "emp"; draw();
        $("#r-tabs").scrollIntoView({ behavior: "smooth" });
      });
      $("#t-xlsx").addEventListener("click", () => xlsx(rows.map((p) => Object.fromEntries(COLS.map(([k, l]) => [l, k === "last" ? p.last : p[k]]))), "إجماليات الموظفين", "employees_totals"));
      $("#t-pdf").addEventListener("click", () => {
        const body = sheet(`إجماليات الإجازات والغياب للموظفين`, `${fmtD(view.from)} — ${fmtD(view.to)}${view.dept ? " · " + esc(view.dept) : ""} · ${n(rows.length)} موظف`,
          `<table><thead><tr>${COLS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${rows.map((p) => `<tr>${COLS.map(([k]) => `<td>${esc(k === "last" ? fmtD(p.last) : (p[k] === 0 ? "" : p[k]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        window.PRINT.openPrintWindow(body, "ar", "إجماليات الموظفين", true);
      });
    }

    // ---------- تقرير موظف ----------
    function drawEmployee() {
      $("#r-body").innerHTML = `<div class="emp-pick"><div id="r-emp-combo"></div></div><div id="r-emp-out"></div>`;
      A.employeeCombo($("#r-emp-combo"), (emp) => { view.empId = emp.id; showEmp(); });
      if (view.empId) showEmp();
      else $("#r-emp-out").innerHTML = `<div class="muted" style="margin-top:12px">اختر موظف، أو اضغط على اسمه في جدول الإجماليات.</div>`;
    }
    function showEmp() {
      const p = compute(A, true).list.find((x) => x.id === view.empId);
      const e = A.state.employees.get(view.empId) || {};
      const info = p || { id: view.empId, name: e.name || "", dept: e.dept || "", job: e.job || "", total: 0, count: 0, sick: 0, annual: 0, excused: 0, unexcused: 0, lateExc: 0, leaves: [], regs: [], types: {} };
      const [cls, st] = sickStatus(info.sick);
      const months = Array.from({ length: 12 }, () => ({ total: 0, sick: 0 }));
      for (const l of info.leaves) { const c = clip(l, view.from, view.to); for (let d = c.s; d <= c.e; d = addDay(d, 1)) { const m = +d.slice(5, 7) - 1; months[m].total++; if (l.leave_type === "مرضية") months[m].sick++; } }
      const leaves = [...info.leaves].sort((a, b) => iso(b.start_date).localeCompare(iso(a.start_date)));
      const regs = [...info.regs].sort((a, b) => iso(b.start_date).localeCompare(iso(a.start_date)));
      $("#r-emp-out").innerHTML = `
        <div class="emp-hero card" style="margin-top:12px">
          <div><div class="muted">تقرير الموظف — ${fmtD(view.from)} → ${fmtD(view.to)}</div>
            <div class="emp-name">👤 ${esc(info.name || "—")}</div>
            <div class="emp-meta"><span class="tag">الرقم الوظيفي: ${esc(info.id)}</span>${info.dept ? `<span class="tag">${esc(info.dept)}</span>` : ""}${(info.job || e.job) ? `<span class="tag">${esc(info.job || e.job)}</span>` : ""}<span class="tag ${cls}-tag">${st}</span></div></div>
          <div class="emp-actions"><button class="btn btn-primary" id="e-pdf">🖨️ PDF</button><button class="btn" id="e-xlsx">📥 Excel</button></div>
        </div>
        <div class="kpis" style="margin-top:12px">
          <div class="kpi"><div class="v num">${info.total}</div><div class="l">إجمالي أيام الإجازات</div></div>
          <div class="kpi"><div class="v num">${info.count}</div><div class="l">عدد الإجازات</div></div>
          <div class="kpi ${cls}"><div class="v num">${info.sick} / ${SICK_QUOTA}</div><div class="l">أيام مرضية (المتبقي ${Math.max(SICK_QUOTA - info.sick, 0)})</div></div>
          <div class="kpi ok"><div class="v num">${info.annual}</div><div class="l">أيام سنوية</div></div>
          <div class="kpi ok"><div class="v num">${info.excused}</div><div class="l">غياب بإذن</div></div>
          <div class="kpi bad"><div class="v num">${info.unexcused}</div><div class="l">غياب بدون إذن</div></div>
          <div class="kpi warn"><div class="v num">${info.lateExc}</div><div class="l">أعذار تأخير / خروج</div></div>
        </div>
        <div class="card" style="margin-top:12px"><div class="card-title">📅 الإجازات حسب الشهر</div>${barsMonths(months)}</div>
        <div class="two-col" style="margin-top:12px">
          <div><h4>🏖️ الإجازات (${leaves.length})</h4>${leaves.length ? `<div class="table-wrap"><table class="grid view-grid"><thead><tr><th>رقم</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>ملاحظات</th></tr></thead><tbody>
            ${leaves.map((l) => `<tr><td class="num">${esc(l.leave_id)}</td><td><span class="tag ${l.leave_type === "مرضية" ? "bad-tag" : ""}">${esc(l.leave_type)}</span></td><td class="num">${fmtD(iso(l.start_date))}</td><td class="num">${fmtD(iso(l.end_date))}</td><td class="num"><b>${l.days}</b></td><td>${esc(l.notes || "")}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="ok-box">لا توجد إجازات في الفترة</div>`}</div>
          <div><h4>⏰ الغياب والتأخير (${regs.length})</h4>${regs.length ? `<div class="table-wrap"><table class="grid view-grid"><thead><tr><th>رقم</th><th>النوع</th><th>من</th><th>إلى</th><th>السبب</th></tr></thead><tbody>
            ${regs.map((a) => `<tr><td class="num">${esc(a.record_id)}</td><td><span class="tag ${a.record_type === "غياب بدون إذن" ? "bad-tag" : a.record_type === "غياب بإذن" ? "ok-tag" : "warn-tag"}">${esc(a.record_type)}</span></td><td class="num">${fmtD(iso(a.start_date))}</td><td class="num">${fmtD(iso(a.end_date))}</td><td>${esc(a.reason || "")}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="ok-box">لا توجد تسجيلات في الفترة</div>`}</div>
        </div>`;
      $("#e-xlsx").addEventListener("click", () => {
        const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leaves.map((l) => ({ "رقم": l.leave_id, "النوع": l.leave_type, "من": iso(l.start_date), "إلى": iso(l.end_date), "الأيام في الفترة": l.days, "الحالة": l.status, "ملاحظات": l.notes || "" }))), "الإجازات");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regs.map((a) => ({ "رقم": a.record_id, "النوع": a.record_type, "من": iso(a.start_date), "إلى": iso(a.end_date), "السبب": a.reason || "" }))), "الغياب والتأخير");
        XLSX.writeFile(wb, `employee_${info.id}_${view.from}_${view.to}.xlsx`);
      });
      $("#e-pdf").addEventListener("click", () => {
        const kp = [["إجمالي أيام الإجازات", info.total], ["عدد الإجازات", info.count], [`مرضية (من ${SICK_QUOTA})`, info.sick], ["سنوية", info.annual], ["غياب بإذن", info.excused], ["غياب بدون إذن", info.unexcused], ["أعذار تأخير", info.lateExc], ["حالة المرضية", st]];
        const body = sheet(`تقرير الموظف — الإجازات والغياب`, `${fmtD(view.from)} — ${fmtD(view.to)}`, `
          <div class="info"><div><b>الاسم:</b> ${esc(info.name)}</div><div><b>الرقم الوظيفي:</b> ${esc(info.id)}</div><div><b>القسم:</b> ${esc(info.dept || "—")}</div><div><b>الوظيفة:</b> ${esc(info.job || e.job || "—")}</div></div>
          <div class="boxes">${kp.map(([l, v]) => `<div class="box"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>
          <h2>الإجازات</h2>${leaves.length ? `<table><thead><tr><th>رقم</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>ملاحظات</th></tr></thead><tbody>${leaves.map((l) => `<tr><td>${esc(l.leave_id)}</td><td>${esc(l.leave_type)}</td><td>${fmtD(iso(l.start_date))}</td><td>${fmtD(iso(l.end_date))}</td><td>${l.days}</td><td>${esc(l.notes || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="none">لا يوجد</div>`}
          <h2>الغياب والتأخير</h2>${regs.length ? `<table><thead><tr><th>رقم</th><th>النوع</th><th>من</th><th>إلى</th><th>السبب</th></tr></thead><tbody>${regs.map((a) => `<tr><td>${esc(a.record_id)}</td><td>${esc(a.record_type)}</td><td>${fmtD(iso(a.start_date))}</td><td>${fmtD(iso(a.end_date))}</td><td>${esc(a.reason || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="none">لا يوجد</div>`}
          <div class="signs"><div>توقيع الموظف<span></span></div><div>توقيع المدير المباشر<span></span></div></div>`);
        window.PRINT.openPrintWindow(body, "ar", `${info.name || info.id} — تقرير الموظف`);
      });
    }

    // ---------- الإجازات المرضية ----------
    function drawSick(list) {
      let rows = list.filter((p) => p.sick > 0).sort((a, b) => b.sick - a.sick || b.sickCount - a.sickCount);
      if (view.sickFilter) rows = rows.filter((p) => sickStatus(p.sick)[0] === view.sickFilter);
      $("#r-body").innerHTML = `
        <div class="table-toolbar">
          <div class="right"><select id="s-filter" style="width:200px">
            <option value="">كل الحالات</option><option value="bad" ${view.sickFilter === "bad" ? "selected" : ""}>🔴 تجاوز الحد</option>
            <option value="warn" ${view.sickFilter === "warn" ? "selected" : ""}>🟡 اقترب من الحد</option><option value="ok" ${view.sickFilter === "ok" ? "selected" : ""}>🟢 طبيعي</option></select>
            <span class="muted">${n(rows.length)} موظف · الحد ${SICK_QUOTA} يوم في الفترة</span></div>
          <div class="left"><button class="btn btn-sm" id="s-xlsx">📥 Excel</button><button class="btn btn-sm" id="s-pdf">🖨️ PDF</button></div>
        </div>
        <div class="table-wrap"><table class="grid view-grid"><thead><tr><th>#</th><th>الرقم</th><th>الاسم</th><th>القسم</th><th>عدد الإجازات</th><th>الأيام</th><th>المتبقي</th><th>تجاوز</th><th>الحالة</th><th>آخر إجازة مرضية</th></tr></thead><tbody>
          ${rows.map((p, i) => { const [c, s] = sickStatus(p.sick); const lastSick = p.leaves.filter((l) => l.leave_type === "مرضية").map((l) => iso(l.end_date)).sort().pop();
            return `<tr data-id="${esc(p.id)}" class="clickable"><td class="num">${i + 1}</td><td class="num">${esc(p.id)}</td><td><b>${esc(p.name)}</b></td><td class="muted">${esc(p.dept)}</td>
              <td class="num">${p.sickCount}</td><td class="num"><b>${p.sick}</b></td><td class="num">${Math.max(SICK_QUOTA - p.sick, 0)}</td><td class="num ${p.sick > SICK_QUOTA ? "txt-bad" : ""}">${Math.max(p.sick - SICK_QUOTA, 0) || ""}</td>
              <td><span class="tag ${c}-tag">${s}</span></td><td class="num">${fmtD(lastSick)}</td></tr>`; }).join("") || `<tr class="empty-row"><td colspan="10">لا توجد إجازات مرضية في الفترة دي</td></tr>`}
        </tbody></table></div>`;
      $("#s-filter").addEventListener("change", (e) => { view.sickFilter = e.target.value; drawSick(list); });
      $("#r-body tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) { view.empId = tr.dataset.id; view.tab = "emp"; draw(); } });
      const plain = rows.map((p, i) => ({ "#": i + 1, "الرقم": p.id, "الاسم": p.name, "القسم": p.dept, "عدد الإجازات": p.sickCount, "الأيام": p.sick, "المتبقي": Math.max(SICK_QUOTA - p.sick, 0), "تجاوز": Math.max(p.sick - SICK_QUOTA, 0), "الحالة": sickStatus(p.sick)[1] }));
      $("#s-xlsx").addEventListener("click", () => xlsx(plain, "الإجازات المرضية", "sick_leave"));
      $("#s-pdf").addEventListener("click", () => {
        const keys = plain.length ? Object.keys(plain[0]) : [];
        window.PRINT.openPrintWindow(sheet("ملخص الإجازات المرضية", `${fmtD(view.from)} — ${fmtD(view.to)} · الحد ${SICK_QUOTA} يوم`,
          `<table><thead><tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr></thead><tbody>${plain.map((r) => `<tr>${keys.map((k) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table>`), "ar", "الإجازات المرضية");
      });
    }

    // ---------- أدوات ----------
    function sheet(title, sub, inner) {
      return `<section class="report" dir="rtl"><header><div><h1>${title}</h1><div class="sub">${sub}</div></div><img class="logo" src="${window.PRINT.logoUrl()}" alt=""></header>
        ${inner}<footer>تاريخ الطباعة: ${fmtD(new Date().toISOString().slice(0, 10))}</footer></section>`;
    }
    function xlsx(rows, sheetName, file) {
      if (!rows.length) return A.toast("لا توجد بيانات للتصدير", "bad");
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Object.keys(rows[0]).map((h) => ({ wch: Math.max(10, h.length + 4) }));
      const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30));
      XLSX.writeFile(wb, `${file}_${view.from}_${view.to}.xlsx`);
    }

    draw();
  }

  window.PAGES = window.PAGES || {};
  window.PAGES.reports = render;
})();
