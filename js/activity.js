/* =========================================================
   سجل النشاط — للمدير فقط
   من يستخدم البرنامج الآن، وكل ما قام به المستخدمون:
   الدخول والخروج، فتح الصفحات، الإضافة والتعديل والحذف، الرفع، الطباعة، التصدير
   ========================================================= */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const PAGE = 200;
  const view = { period: "7", from: "", to: "", user: "", type: "nav", q: "", rows: [], offset: 0, more: false, auto: true, timer: null, users: [] };

  // ---------------- أسماء عربية ----------------
  const PAGES = { leaves: "الإجازات", absences: "الغياب والتأخير", attendance: "تقرير البصمة", reports: "التقارير", movement: "الدخول والخروج",
    employees: "الموظفون", settings: "الإعدادات", activity: "سجل النشاط" };
  const FIELDS = { leave_type: "نوع الإجازة", record_type: "النوع", start_date: "من تاريخ", end_date: "إلى تاريخ", status: "الحالة", notes: "الملاحظات",
    reason: "السبب", employee_id: "الرقم الوظيفي", name_ar: "الاسم العربي", name_en: "الاسم الإنجليزي", department: "القسم", job_title: "الوظيفة",
    nationality: "الجنسية", national_id: "رقم الهوية / الإقامة", saturday_rule: "دوام السبت", attendance_calculation: "طريقة الاحتساب",
    attachment_name: "المرفق", value: "القيمة", key: "الإعداد" };
  const SETTINGS = { start_time: "بداية الدوام", grace_minutes: "دقائق السماح", movement_users: "صلاحية تبويب الدخول والخروج",
    employees_users: "صلاحية تبويب بيانات الموظفين" };
  const ENT = { leave: "إجازة", absence: "سجل غياب / تأخير", employee: "الموظف", setting: "الإعداد" };
  // مجموعات الفلتر
  const TYPES = {
    nav: { label: "كل العمليات (بدون فتح الصفحات)", actions: null, exclude: ["view"] },
    all: { label: "الكل (مع فتح الصفحات)", actions: null },
    data: { label: "✏️ تعديل البيانات (إضافة / تعديل / حذف)", actions: ["insert", "update", "delete"] },
    session: { label: "🔐 الدخول والخروج", actions: ["login", "logout", "open"] },
    view: { label: "👁️ فتح الصفحات", actions: ["view"] },
    files: { label: "📤 رفع الملفات", actions: ["upload"] },
    out: { label: "🖨️ الطباعة والتصدير", actions: ["print", "export"] },
    users: { label: "👤 إدارة المستخدمين", actions: ["user_create", "user_password", "user_admin", "user_delete"] },
  };
  const ACT = {
    insert: ["➕ إضافة", "ok-tag"], update: ["✏️ تعديل", "warn-tag"], delete: ["🗑️ حذف", "bad-tag"],
    login: ["🔐 دخول", "info-tag"], logout: ["🚪 خروج", ""], open: ["🖥️ فتح البرنامج", ""], view: ["👁️ فتح صفحة", "muted-tag"],
    upload: ["📤 رفع ملف", "info-tag"], print: ["🖨️ طباعة", "info-tag"], export: ["📥 تصدير", "info-tag"],
    user_create: ["👤 مستخدم جديد", "ok-tag"], user_password: ["🔑 كلمة مرور", "warn-tag"], user_admin: ["🛡️ صلاحية مدير", "warn-tag"], user_delete: ["👤 حذف مستخدم", "bad-tag"],
  };

  const short = (e) => String(e || "").split("@")[0] || "—";
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDT = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtVal = (v) => {
    if (v == null || v === "") return "فارغ";
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-").reverse().join("/");
    return s;
  };
  // «منذ …» بصيغة العدد الصحيحة: دقيقة، دقيقتين، 3 دقائق، 11 دقيقة
  const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
  function ago(iso) {
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "الآن";
    if (m < 60) return "منذ " + plural(m, "دقيقة", "دقيقتين", "دقائق", "دقيقة");
    const h = Math.floor(m / 60);
    if (h < 24) return "منذ " + plural(h, "ساعة", "ساعتين", "ساعات", "ساعة");
    const d = Math.floor(h / 24);
    return d === 1 ? "أمس" : "منذ " + plural(d, "يوم", "يومين", "أيام", "يومًا");
  }
  const satTxt = (v) => (v === "work" ? "يعمل السبت" : v === "off" ? "السبت إجازة" : "تلقائي");

  // ---------------- وصف العملية بالعربية ----------------
  function describe(r) {
    const esc = window.APP.esc;
    const d = r.details || {}, row = d.row || {};
    const who = row.name_ar ? `${esc(row.name_ar)} (${esc(row.employee_id || "")})` : esc(row.employee_id || r.record_id || "");
    const range = row.start_date ? ` من ${fmtVal(row.start_date)}${row.end_date && row.end_date !== row.start_date ? ` إلى ${fmtVal(row.end_date)}` : ""}` : "";
    const verb = { insert: "أضاف", update: "عدّل", delete: "حذف" }[r.action];
    switch (r.entity) {
      case "leave": return `${verb} إجازة ${esc(row.type || "")} <span class="muted num">${esc(r.record_id || "")}</span> — ${who}${range}`;
      case "absence": return `${verb} ${esc(row.type || "سجل غياب / تأخير")} <span class="muted num">${esc(r.record_id || "")}</span> — ${who}${range}`;
      case "employee": return r.action === "update" ? `عدّل بيانات الموظف ${who}` : `${verb} الموظف ${who}`;
      case "setting": {
        const name = SETTINGS[r.record_id] || r.record_id;
        if (r.action === "update" && /_users$/.test(r.record_id || "")) return `غيّر «${esc(name)}»`;
        return r.action === "delete" ? `حذف الإعداد «${esc(name)}»` : `غيّر «${esc(name)}»${row.value && !/_users$/.test(r.record_id) ? ` إلى ${esc(row.value)}` : ""}`;
      }
    }
    switch (r.action) {
      case "login": return "سجّل الدخول إلى البرنامج";
      case "logout": return "سجّل الخروج من البرنامج";
      case "open": return "فتح البرنامج (كان مسجّل الدخول مسبقًا)";
      case "view": return `فتح صفحة «${esc(PAGES[d.page] || d.page || "")}»`;
      case "upload":
        if (r.entity === "fingerprint") return `رفع ملف البصمة «${esc(d.file || "")}» — ${d.employees ?? "?"} موظف${d.from ? ` (الفترة ${fmtVal(d.from)} إلى ${fmtVal(d.to)})` : ""}`;
        if (r.entity === "movement") return `رفع ملف الحركات «${esc(d.file || "")}» — ${d.employees ?? "?"} موظف`;
        if (r.entity === "employees_file") return `رفع ملف الموظفين — ${d.employees ?? "?"} موظف`;
        if (r.entity === "history_file") return `رفع ملف الإجازات السابقة — ${d.leaves ?? 0} إجازة و ${d.absences ?? 0} غياب / تأخير`;
        return "رفع ملف";
      case "print": return `طباعة / PDF: «${esc(d.title || "")}»${d.pages > 1 ? ` — ${d.pages} صفحة` : ""}`;
      case "export": return `تصدير Excel: «${esc(d.file || "")}»`;
      case "user_create": return `أضاف المستخدم ${esc(d.user || "")}${d.admin ? " (بصلاحية مدير)" : ""}`;
      case "user_password": return `غيّر كلمة مرور المستخدم ${esc(d.user || "")}`;
      case "user_admin": return `${d.admin ? "منح" : "سحب"} صلاحية المدير ${d.admin ? "لـ" : "من"} ${esc(d.user || "")}`;
      case "user_delete": return `حذف المستخدم ${esc(d.user || "")}`;
    }
    return esc(r.action);
  }

  // تفاصيل التغيير (من ← إلى)
  function changesHTML(r) {
    const esc = window.APP.esc;
    const ch = (r.details && r.details.changes) || {};
    const keys = Object.keys(ch).filter((k) => k !== "attachment_path");
    if (!keys.length) return "";
    return `<div class="act-changes">${keys.map((k) => {
      let [o, n] = ch[k];
      if (k === "saturday_rule") { o = satTxt(o); n = satTxt(n); }
      if (k === "value" && /_users$/.test(r.record_id || "")) {
        const arr = (v) => { try { return (JSON.parse(v || "[]") || []).map(short); } catch (_) { return []; } };
        const a = arr(o), b = arr(n);
        const add = b.filter((x) => !a.includes(x)), rem = a.filter((x) => !b.includes(x));
        return `${add.length ? `<span class="tag ok-tag">منح: ${esc(add.join("، "))}</span>` : ""}${rem.length ? `<span class="tag bad-tag">سحب: ${esc(rem.join("، "))}</span>` : ""}`;
      }
      return `<span class="chg"><b>${esc(FIELDS[k] || k)}:</b> من «${esc(fmtVal(o))}» إلى «${esc(fmtVal(n))}»</span>`;
    }).join("")}</div>`;
  }

  // ---------------- الصفحة ----------------
  function render(root) {
    const A = window.APP, esc = A.esc;
    if (!A.state.isAdmin) { location.hash = "#leaves"; return; }
    root.innerHTML = `
      <div class="page-head">
        <div><h2>📜 سجل النشاط</h2><p>من يستخدم البرنامج الآن، وكل ما قام به المستخدمون: الدخول، وفتح الصفحات، وإضافة الإجازات والغياب وتعديلها وحذفها، وتعديل الموظفين والإعدادات، ورفع الملفات، والطباعة والتصدير. السجل للقراءة فقط ولا يمكن تعديله أو حذفه.</p></div>
      </div>
      <div class="card">
        <div class="card-title">👤 المستخدمون الآن</div>
        <div id="act-presence" class="presence-grid"><div class="muted">جاري التحميل...</div></div>
      </div>
      <div class="card">
        <div class="act-filters">
          <label>الفترة <select id="af-period">
            <option value="1">اليوم</option><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يومًا</option><option value="90">آخر 90 يومًا</option><option value="custom">فترة محددة…</option>
          </select></label>
          <label class="af-custom" hidden>من <input type="date" id="af-from"></label>
          <label class="af-custom" hidden>إلى <input type="date" id="af-to"></label>
          <label>المستخدم <select id="af-user"><option value="">كل المستخدمين</option></select></label>
          <label>نوع العملية <select id="af-type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select></label>
          <label>بحث <input type="search" id="af-q" placeholder="اسم موظف، رقم، ملف…"></label>
        </div>
        <div class="table-toolbar">
          <div class="right"><div id="act-kpis" class="act-kpis"></div></div>
          <div class="left">
            <label class="auto-toggle"><input type="checkbox" id="af-auto" ${view.auto ? "checked" : ""}> تحديث تلقائي كل 30 ثانية</label>
            <button class="btn btn-sm" id="af-refresh">🔄 تحديث</button>
            <button class="btn btn-sm" id="af-xlsx">📥 تصدير Excel</button>
          </div>
        </div>
        <div class="table-wrap"><table class="grid view-grid act-grid">
          <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th></tr></thead>
          <tbody id="act-body"><tr><td colspan="4" class="muted" style="text-align:center">جاري التحميل...</td></tr></tbody>
        </table></div>
        <div class="act-more"><button class="btn" id="af-more" hidden>تحميل المزيد</button></div>
      </div>`;

    $("#af-period").value = view.period; $("#af-type").value = view.type; $("#af-q").value = view.q;
    $("#af-from").value = view.from; $("#af-to").value = view.to;
    root.querySelectorAll(".af-custom").forEach((l) => (l.hidden = view.period !== "custom"));
    $("#af-period").addEventListener("change", (e) => {
      view.period = e.target.value;
      root.querySelectorAll(".af-custom").forEach((l) => (l.hidden = view.period !== "custom"));
      load();
    });
    ["af-from", "af-to"].forEach((id) => $("#" + id).addEventListener("change", (e) => { view[id === "af-from" ? "from" : "to"] = e.target.value; load(); }));
    $("#af-user").addEventListener("change", (e) => { view.user = e.target.value; load(); });
    $("#af-type").addEventListener("change", (e) => { view.type = e.target.value; load(); });
    $("#af-q").addEventListener("input", (e) => { view.q = e.target.value; fill(); });
    $("#af-refresh").addEventListener("click", () => { load(); loadPresence(); });
    $("#af-more").addEventListener("click", () => load(true));
    $("#af-xlsx").addEventListener("click", exportExcel);
    $("#af-auto").addEventListener("change", (e) => { view.auto = e.target.checked; schedule(); });
    $("#act-body").addEventListener("click", (e) => {
      const b = e.target.closest("[data-user]");
      if (b) { view.user = b.dataset.user; $("#af-user").value = view.user; load(); }
    });
    $("#act-presence").addEventListener("click", (e) => {
      const b = e.target.closest("[data-user]");
      if (b) { view.user = b.dataset.user; $("#af-user").value = view.user; load(); $(".act-grid")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });

    loadPresence().then(() => { $("#af-user").value = view.user; });
    load();
    schedule();
  }

  // التحديث التلقائي يعمل فقط ما دامت الصفحة مفتوحة
  function schedule() {
    clearInterval(view.timer);
    if (!view.auto) return;
    view.timer = setInterval(() => {
      if (!document.getElementById("act-body")) { clearInterval(view.timer); return; }
      if (document.visibilityState !== "visible") return;
      load(false, true); loadPresence();
    }, 30000);
  }

  function range() {
    if (view.period === "custom") {
      const add1 = (d) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + 1); return x.toISOString(); };
      return { from: view.from ? new Date(view.from + "T00:00:00").toISOString() : null, to: view.to ? add1(view.to) : null };
    }
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (+view.period - 1));
    return { from: start.toISOString(), to: null };
  }

  async function load(more = false, quiet = false) {
    const A = window.APP;
    const t = TYPES[view.type] || TYPES.nav;
    if (!more) view.offset = 0;
    try {
      const rows = await A.DB.activity({ ...range(), user: view.user || null, actions: t.actions, exclude: t.exclude, limit: PAGE, offset: view.offset });
      const got = rows.length;
      view.rows = more ? view.rows.concat(rows) : rows;
      view.offset += got;
      view.more = got === PAGE;
      fill();
    } catch (e) {
      if (quiet) return;
      $("#act-body").innerHTML = `<tr><td colspan="4"><div class="form-error">تعذّر تحميل السجل: ${A.esc(A.errMsg(e))}<br><span class="muted">تأكد من تشغيل ملف <b>database/8_activity_log.sql</b> في Supabase.</span></div></td></tr>`;
    }
  }

  async function loadPresence() {
    const A = window.APP, esc = A.esc;
    const box = $("#act-presence");
    if (!box) return;
    let users = [], pres = [];
    try { users = await A.DB.rpc("admin_list_users"); } catch (_) {}
    try { pres = await A.DB.presence(); } catch (e) {
      box.innerHTML = `<div class="muted">لا تتوفر حالة الاتصال — شغّل ملف database/8_activity_log.sql</div>`;
    }
    const map = new Map(pres.map((p) => [String(p.email).toLowerCase(), p]));
    const list = users.map((u) => ({ email: String(u.email).toLowerCase(), admin: u.is_admin, p: map.get(String(u.email).toLowerCase()), lastSign: u.last_sign_in_at }));
    for (const p of pres) if (!list.some((x) => x.email === String(p.email).toLowerCase())) list.push({ email: String(p.email).toLowerCase(), p });
    const state = (x) => {
      const t = x.p ? (Date.now() - new Date(x.p.last_seen)) / 60000 : Infinity;
      return t <= 3 ? 0 : t <= 30 ? 1 : 2;
    };
    list.sort((a, b) => state(a) - state(b) || new Date(b.p?.last_seen || b.lastSign || 0) - new Date(a.p?.last_seen || a.lastSign || 0));
    view.users = list.map((x) => x.email);
    const sel = $("#af-user");
    if (sel) sel.innerHTML = `<option value="">كل المستخدمين</option>` + view.users.map((e) => `<option value="${esc(e)}">${esc(short(e))}</option>`).join("");
    if (sel) sel.value = view.user;
    if (!list.length) { if (pres.length || users.length) box.innerHTML = '<div class="muted">لا يوجد مستخدمون</div>'; return; }
    box.innerHTML = list.map((x) => {
      const s = state(x);
      const dot = ["🟢", "🟡", "⚪"][s];
      const status = !x.p ? (x.lastSign ? `آخر دخول ${ago(x.lastSign)}` : "لم يستخدم البرنامج بعد")
        : s === 0 ? `متصل الآن${x.p.page ? ` — في «${esc(PAGES[x.p.page] || x.p.page)}»` : ""}`
        : s === 1 ? `نشط ${ago(x.p.last_seen)}${x.p.page ? ` — «${esc(PAGES[x.p.page] || x.p.page)}»` : ""}`
        : `آخر ظهور ${ago(x.p.last_seen)}`;
      return `<button class="presence-card s${s}" data-user="${esc(x.email)}" title="عرض نشاط ${esc(short(x.email))}">
        <span class="pc-dot">${dot}</span>
        <span class="pc-text"><span class="pc-name"><b>${esc(short(x.email))}</b>${x.admin ? ' <span class="tag warn-tag">مدير</span>' : ""}</span><small>${status}</small>
        ${x.p && s < 2 ? `<small class="muted">منذ ${fmtDT(x.p.since).slice(11)}</small>` : x.p ? `<small class="muted">${fmtDT(x.p.last_seen)}</small>` : ""}</span>
      </button>`;
    }).join("");
  }

  function visible() {
    const q = view.q.trim().toLowerCase();
    if (!q) return view.rows;
    return view.rows.filter((r) => `${r.user_email} ${r.record_id || ""} ${JSON.stringify(r.details || {})} ${describe(r)}`.toLowerCase().includes(q));
  }

  function fill() {
    const esc = window.APP.esc;
    const body = $("#act-body");
    if (!body) return;
    const rows = visible();
    const cnt = (acts) => rows.filter((r) => acts.includes(r.action)).length;
    $("#act-kpis").innerHTML = `
      <span class="tag">${rows.length.toLocaleString("en-US")} عملية${view.more ? "+" : ""}</span>
      <span class="tag ok-tag">➕ ${cnt(["insert"])}</span><span class="tag warn-tag">✏️ ${cnt(["update"])}</span><span class="tag bad-tag">🗑️ ${cnt(["delete"])}</span>
      <span class="tag info-tag">🔐 ${cnt(["login", "open"])} دخول</span>
      <span class="tag">👤 ${new Set(rows.map((r) => r.user_email)).size} مستخدم</span>`;
    let lastDay = "";
    body.innerHTML = rows.map((r) => {
      const dt = fmtDT(r.at), day = dt.slice(0, 10);
      const sep = day !== lastDay ? `<tr class="day-sep"><td colspan="4">📅 ${day}</td></tr>` : "";
      lastDay = day;
      const [lbl, cls] = ACT[r.action] || [r.action, ""];
      return `${sep}<tr class="act-${esc(r.action)}">
        <td class="num" data-label="الوقت" title="${dt}"><b>${dt.slice(11)}</b> <small class="muted">${ago(r.at)}</small></td>
        <td data-label="المستخدم"><button class="link-btn" data-user="${esc(r.user_email || "")}" title="عرض نشاط هذا المستخدم فقط">${esc(short(r.user_email))}</button></td>
        <td data-label="العملية"><span class="tag ${cls}">${lbl}</span>${r.entity && ENT[r.entity] ? ` <small class="muted">${ENT[r.entity]}</small>` : ""}</td>
        <td data-label="التفاصيل">${describe(r)}${changesHTML(r)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="4" class="muted" style="text-align:center">لا توجد عمليات في هذه الفترة</td></tr>`;
    $("#af-more").hidden = !view.more;
  }

  function exportExcel() {
    const strip = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent.replace(/\s+/g, " ").trim(); };
    const rows = visible().map((r) => ({
      "التاريخ": fmtDT(r.at).slice(0, 10), "الوقت": fmtDT(r.at).slice(11), "المستخدم": short(r.user_email),
      "العملية": strip((ACT[r.action] || [r.action])[0]).replace(/^\S+\s/, ""), "التفاصيل": strip(describe(r)), "التغييرات": strip(changesHTML(r)),
    }));
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "التاريخ": "", "الوقت": "", "المستخدم": "", "العملية": "", "التفاصيل": "لا توجد عمليات", "التغييرات": "" }]);
    ws["!cols"] = [12, 8, 14, 16, 70, 60].map((w) => ({ wch: w }));
    if (rows.length) ws["!autofilter"] = { ref: `A1:F${rows.length + 1}` };
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "سجل النشاط");
    XLSX.writeFile(wb, `سجل_النشاط_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  window.PAGES = window.PAGES || {};
  window.PAGES.activity = render;
})();
