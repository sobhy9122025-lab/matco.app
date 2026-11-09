/* =========================================================
   نظام الحضور والإجازات — الواجهة (HTML + Supabase)
   المرحلة 1: تسجيل الدخول + الإجازات + الغياب والتأخير
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};

  // ---------------- ثوابت ----------------
  const LEAVE_TYPES = ["مرضية", "سنوية", "اضطرارية", "بدون راتب", "رسمية", "أخرى"];
  const LEAVE_STATUSES = ["معتمدة", "قيد المراجعة", "مرفوضة"];
  const ABSENCE_TYPES = ["غياب بإذن", "غياب بدون إذن", "تأخير بعذر", "خروج مبكر بإذن", "أخرى"];
  const ABSENCE_REASONS = [
    "مراجعة مستشفى / موعد طبي", "ظرف عائلي", "ظرف طارئ", "زحمة طريق / تأخر مواصلات",
    "عطل في السيارة", "مهمة عمل خارجية", "مراجعة جهة حكومية", "مراجعة مدرسة الأبناء", "سفر", "بدون سبب",
  ];
  const PAGE_SIZE = 50;
  const ATTACH_PREFIX = "sb://";
  const BUCKET = "attachments";

  const KINDS = {
    leaves: {
      table: "leaves", key: "leave_id", title: "الإجازات", icon: "🏖️",
      sub: "تسجيل وتعديل الإجازات — تُستبعد المعتمدة منها من الغياب تلقائيًا في تقرير البصمة.",
      typeCol: "leave_type", types: LEAVE_TYPES, textCol: "notes", textLabel: "ملاحظات",
      folder: "leaves", hasStatus: true,
    },
    absences: {
      table: "absences", key: "record_id", title: "الغياب والتأخير", icon: "⏰",
      sub: "تسجيل الغياب بإذن / بدون إذن، والتأخير والخروج المبكر بعذر — يظهر في تقرير البصمة وملف PDF.",
      typeCol: "record_type", types: ABSENCE_TYPES, textCol: "reason", textLabel: "السبب",
      folder: "absences", hasStatus: false, reasons: ABSENCE_REASONS,
    },
  };

  // ---------------- أدوات ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cleanId = (v) => String(v ?? "").trim().replace(/\.0+$/, "");
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const toISO = (v) => {
    if (!v) return "";
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  };
  const fmtDate = (v) => { const s = toISO(v); return s ? s.split("-").reverse().join("/") : ""; };
  const daysBetween = (a, b) => {
    a = toISO(a); b = toISO(b) || a;
    if (!a) return 0;
    const d = Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
    return d > 0 ? d : 0;
  };
  const overlaps = (s, e, from, to) => (toISO(e) || toISO(s)) >= from && toISO(s) <= to;
  const userName = () => (state.user?.email || "").split("@")[0];

  function toast(msg, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), kind === "bad" ? 6500 : 3200);
  }
  function loading(on, text = "جاري التحميل...") {
    $("#loading").hidden = !on;
    $("#loading-text").textContent = text;
  }
  function errMsg(e) {
    const m = e?.message || String(e);
    if (/Invalid login credentials/i.test(m)) return "اسم المستخدم أو كلمة المرور غير صحيحة";
    if (/Failed to fetch|NetworkError/i.test(m)) return "تعذّر الاتصال بالإنترنت أو بقاعدة البيانات";
    if (/JWT|not authorized|permission denied|row-level security/i.test(m)) return "ليس لديك صلاحية — سجّل الدخول مرة أخرى";
    return m;
  }

  // =========================================================
  // طبقة البيانات (Supabase)
  // =========================================================
  function makeSupabaseDB() {
    if (!window.supabase || !CFG.SUPABASE_URL || /xxxx/.test(CFG.SUPABASE_URL)) return null;
    const url = (CFG.SUPABASE_URL.match(/^https?:\/\/[^/]+/) || [CFG.SUPABASE_URL])[0];
    const sb = window.supabase.createClient(url, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const check = ({ data, error }) => { if (error) throw error; return data; };

    async function fetchAll(table, columns = "*") {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = check(await sb.from(table).select(columns).range(from, from + 999));
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    }

    return {
      async session() { return check(await sb.auth.getSession()).session; },
      async signIn(email, password) { return check(await sb.auth.signInWithPassword({ email, password })).user; },
      async signOut() { await sb.auth.signOut(); },
      async employees() {
        try { return await fetchAll("employees", "employee_id,name_ar,name_en,department,job_title,nationality,attendance_calculation,national_id,saturday_rule"); }
        catch (_) { /* قبل إضافة عمود السبت */ }
        try { return await fetchAll("employees", "employee_id,name_ar,name_en,department,job_title,nationality,attendance_calculation,national_id"); }
        catch (_) { return fetchAll("employees", "employee_id,name_ar,name_en,department,job_title,nationality,attendance_calculation"); } // قبل إضافة عمود الهوية
      },
      all: (table) => fetchAll(table),
      async insert(table, rows) { return check(await sb.from(table).insert(rows).select()); },
      async upsert(table, rows, onConflict) { check(await sb.from(table).upsert(rows, { onConflict })); },
      async rpc(fn, args) { return check(await sb.rpc(fn, args || {})); },
      async getSettings() {
        const { data, error } = await sb.from("app_settings").select("key,value");
        if (error) return {};
        return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      },
      async saveSettings(obj, by) {
        const rows = Object.entries(obj).map(([key, value]) => ({ key, value: String(value), updated_at: new Date().toISOString(), updated_by: by }));
        check(await sb.from("app_settings").upsert(rows, { onConflict: "key" }));
      },
      async isAdmin() {
        const { data, error } = await sb.from("app_admins").select("email").limit(1);
        return !error && Array.isArray(data) && data.length > 0;
      },
      async update(table, key, id, fields) { check(await sb.from(table).update(fields).eq(key, id)); },
      async remove(table, key, ids) {
        for (let i = 0; i < ids.length; i += 200) check(await sb.from(table).delete().in(key, ids.slice(i, i + 200)));
      },
      async upload(folder, empId, file) {
        const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [".bin"])[0].toLowerCase();
        const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
        const path = `${folder}/${empId}_${stamp}${ext}`;
        check(await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined }));
        return ATTACH_PREFIX + path;
      },
      async fileUrl(stored) {
        const path = String(stored).replace(ATTACH_PREFIX, "");
        return check(await sb.storage.from(BUCKET).createSignedUrl(path, 600)).signedUrl;
      },
    };
  }
  const DB = window.MockDB || makeSupabaseDB();

  // =========================================================
  // الحالة
  // =========================================================
  const state = {
    user: null,
    isAdmin: false,
    settings: {},
    employees: new Map(),   // id -> employee
    empList: [],            // للبحث
    data: { leaves: null, absences: null },
    ui: {},                 // حالة كل صفحة (فلاتر، تعديلات، صفحة الجدول)
  };

  async function loadEmployees() {
    const rows = await DB.employees();
    state.employees = new Map();
    state.empList = [];
    for (const r of rows) {
      const id = cleanId(r.employee_id);
      if (!id) continue;
      const e = { id, name: r.name_ar || r.name_en || "", nameEn: r.name_en || "", dept: r.department || "", job: r.job_title || "", nat: r.nationality || "", rule: r.attendance_calculation || "", nid: cleanId(r.national_id), sat: r.saturday_rule || "" };
      state.employees.set(id, e);
      state.empList.push({ ...e, hay: `${e.name} ${e.nameEn} ${id} ${e.nid}`.toLowerCase() });
    }
  }

  function showConnStatus() {
    $("#conn-status").textContent = `متصل بقاعدة البيانات — ${state.employees.size.toLocaleString("en-US")} موظف`;
    $("#conn-status").className = "brand-sub ok";
  }

  async function loadKind(kind, force = false) {
    if (state.data[kind] && !force) return state.data[kind];
    state.data[kind] = await DB.all(KINDS[kind].table);
    return state.data[kind];
  }

  // =========================================================
  // تسجيل الدخول
  // =========================================================
  function showLogin() {
    $("#app-view").hidden = true;
    $("#login-view").hidden = false;
    $("#login-user").focus();
  }

  async function startApp(user) {
    state.user = user;
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    $("#user-name").textContent = userName();
    loading(true, "جاري تحميل البيانات...");
    try {
      await loadEmployees();
      showConnStatus();
      try { state.isAdmin = DB.isAdmin ? await DB.isAdmin() : false; } catch (_) { state.isAdmin = false; }
      try { state.settings = DB.getSettings ? await DB.getSettings() : {}; } catch (_) { state.settings = {}; }
      $("#nav-settings").hidden = !state.isAdmin;
      $("#nav-movement").hidden = !canMovement();
    } catch (e) {
      $("#conn-status").textContent = "تعذّر الاتصال: " + errMsg(e);
      $("#conn-status").className = "brand-sub bad";
    } finally {
      loading(false);
    }
    route();
  }

  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const errBox = $("#login-error");
    errBox.hidden = true;
    if (!DB) {
      errBox.textContent = "لم يتم ضبط الاتصال بقاعدة البيانات — عدّل ملف js/config.js";
      errBox.hidden = false;
      return;
    }
    let u = $("#login-user").value.trim();
    if (!u.includes("@")) u = `${u}@${CFG.LOGIN_DOMAIN || "matco.app"}`;
    const btn = $("#login-btn");
    btn.disabled = true; btn.textContent = "جاري الدخول...";
    try {
      const user = await DB.signIn(u.toLowerCase(), $("#login-pass").value);
      await startApp(user);
    } catch (e) {
      errBox.textContent = errMsg(e);
      errBox.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "دخول";
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    if (hasPendingChanges() && !confirm("توجد تعديلات غير محفوظة. هل تريد الخروج على أي حال؟")) return;
    await DB.signOut();
    state.user = null;
    state.isAdmin = false;
    $("#nav-settings").hidden = true;
    $("#nav-movement").hidden = true;
    state.data = { leaves: null, absences: null };
    state.ui = {};
    showLogin();
  });

  $("#refresh-btn").addEventListener("click", async () => {
    if (hasPendingChanges() && !confirm("توجد تعديلات غير محفوظة وستُفقد. هل تريد المتابعة؟")) return;
    loading(true, "جاري التحديث...");
    try {
      await loadEmployees();
      state.data = { leaves: null, absences: null };
      for (const k of Object.keys(state.ui)) if (state.ui[k].rows) state.ui[k].rows = null;
      toast("تم تحديث البيانات", "ok");
    } catch (e) { toast(errMsg(e), "bad"); }
    loading(false);
    route();
  });

  // =========================================================
  // التنقل
  // =========================================================
  function hasPendingChanges() {
    return Object.values(state.ui).some((u) => u.rows && u.rows.some((r) => r.isNew || r.isDeleted || r.dirty));
  }
  window.addEventListener("beforeunload", (e) => { if (hasPendingChanges()) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("hashchange", route);

  // صفحة الدخول والخروج المتعدد: للمدير، وللمستخدمين الذين يحددهم المدير في الإعدادات
  function movementUsers() {
    try { const v = JSON.parse(state.settings.movement_users || "[]"); return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []; }
    catch (_) { return []; }
  }
  function canMovement() {
    return !!state.user && (state.isAdmin || movementUsers().includes(String(state.user.email || "").toLowerCase()));
  }

  function route() {
    if (!state.user) return;
    const page = (location.hash || "#leaves").slice(1);
    $$("#mainnav a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
    const root = $("#page");
    if (page === "leaves" || page === "absences") return renderRecordsPage(root, page);
    if (window.PAGES && window.PAGES[page]) return window.PAGES[page](root);
    if (page === "reports") return renderSoon(root, "📑 التقارير", "تقرير الموظف، والإجازات المرضية، وملخص الإجازات.");
    location.hash = "#leaves";
  }

  function renderSoon(root, title, text) {
    root.innerHTML = `
      <div class="card soon">
        <div class="big">🚧</div>
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(text)}</p>
        <p>هذه الصفحة قيد التطوير وستتوفر قريبًا بإذن الله.</p>
      </div>`;
  }

  // =========================================================
  // البحث عن موظف (بالاسم أو الرقم الوظيفي)
  // =========================================================
  function employeeCombo(container, onPick) {
    container.classList.add("combo");
    container.innerHTML = `
      <label>🔎 الموظف (الاسم أو الرقم الوظيفي أو رقم الهوية)
        <input type="search" class="combo-input" placeholder="مثال: 27164 أو محمد أو 1026241339" autocomplete="off">
      </label>
      <div class="combo-list" hidden></div>
      <div class="combo-picked" hidden></div>`;
    const input = $(".combo-input", container);
    const list = $(".combo-list", container);
    const picked = $(".combo-picked", container);
    let items = [], active = -1, value = null, q = "";

    const close = () => { list.hidden = true; active = -1; };
    const choose = (emp) => {
      value = emp;
      input.value = `${emp.name} — ${emp.id}`;
      picked.textContent = `✓ ${emp.name} | ${emp.dept || "—"} | ${emp.job || ""}${emp.nid ? " | هوية " + emp.nid : ""}`;
      picked.hidden = false;
      close();
      onPick && onPick(emp);
    };
    const renderList = () => {
      list.innerHTML = items.map((e, i) =>
        `<div class="combo-item ${i === active ? "active" : ""}" data-i="${i}"><span>${esc(e.name)}${e.nid && q.length >= 4 && e.nid.includes(q) ? ` <small class="muted">هوية ${esc(e.nid)}</small>` : ""}</span><span class="id">${esc(e.id)}</span></div>`
      ).join("") || `<div class="combo-item muted">لا توجد نتائج</div>`;
      list.hidden = false;
    };
    input.addEventListener("input", () => {
      value = null; picked.hidden = true;
      q = input.value.trim().toLowerCase();
      if (!q) { close(); return; }
      const exact = state.employees.get(cleanId(q)) || state.empList.find((e) => e.nid && e.nid === cleanId(q));
      items = state.empList.filter((e) => e.hay.includes(q)).slice(0, 30);
      if (exact && !items.some((e) => e.id === exact.id)) items.unshift(exact);
      active = items.length ? 0 : -1;
      renderList();
    });
    input.addEventListener("keydown", (ev) => {
      if (list.hidden) return;
      if (ev.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); renderList(); ev.preventDefault(); }
      else if (ev.key === "ArrowUp") { active = Math.max(active - 1, 0); renderList(); ev.preventDefault(); }
      else if (ev.key === "Enter") { if (items[active]) { choose(items[active]); ev.preventDefault(); } }
      else if (ev.key === "Escape") close();
    });
    list.addEventListener("mousedown", (ev) => {
      const it = ev.target.closest("[data-i]");
      if (it) { ev.preventDefault(); choose(items[+it.dataset.i]); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));

    return {
      get value() { return value; },
      reset() { value = null; input.value = ""; picked.hidden = true; close(); },
    };
  }

  // =========================================================
  // صفحة السجلات (الإجازات / الغياب والتأخير)
  // =========================================================
  function uiFor(kind) {
    if (!state.ui[kind]) {
      const y = new Date().getFullYear();
      state.ui[kind] = { from: `${y}-01-01`, to: `${y}-12-31`, q: "", type: "", page: 0, rows: null, tmp: 0 };
    }
    return state.ui[kind];
  }

  function buildRows(kind, data) {
    const k = KINDS[kind];
    return data.map((r) => ({
      id: r[k.key],
      isNew: false, isDeleted: false, dirty: false,
      orig: { ...r },
      cur: {
        employee_id: cleanId(r.employee_id),
        type: r[k.typeCol] || "",
        start_date: toISO(r.start_date),
        end_date: toISO(r.end_date),
        text: r[k.textCol] || "",
        status: r.status || "",
      },
      name: r.name_ar || "", dept: r.department || "",
      attName: r.attachment_name || "", attPath: r.attachment_path || "",
    }));
  }

  function rowChanges(kind, row) {
    const k = KINDS[kind], o = row.orig, c = row.cur, f = {};
    if (c.employee_id !== cleanId(o.employee_id)) f.employee_id = c.employee_id;
    if (c.type !== (o[k.typeCol] || "")) f[k.typeCol] = c.type;
    if (c.start_date !== toISO(o.start_date)) f.start_date = c.start_date || null;
    if (c.end_date !== toISO(o.end_date)) f.end_date = c.end_date || null;
    if (c.text !== (o[k.textCol] || "")) f[k.textCol] = c.text;
    if (k.hasStatus && c.status !== (o.status || "")) f.status = c.status;
    return f;
  }

  function rowErrors(row) {
    const errs = [];
    if (!state.employees.has(row.cur.employee_id)) errs.push("emp");
    if (!row.cur.start_date) errs.push("start");
    if (row.cur.end_date && row.cur.start_date && row.cur.end_date < row.cur.start_date) errs.push("end");
    return errs;
  }

  async function renderRecordsPage(root, kind) {
    const k = KINDS[kind];
    const ui = uiFor(kind);
    if (!ui.rows) {
      root.innerHTML = `<div class="card"><div class="muted">جاري تحميل ${esc(k.title)}...</div></div>`;
      try {
        ui.rows = buildRows(kind, await loadKind(kind));
      } catch (e) {
        root.innerHTML = `<div class="card"><div class="form-error">تعذّر تحميل البيانات: ${esc(errMsg(e))}</div></div>`;
        return;
      }
    }

    const typeOptions = (sel) => {
      const list = sel && !k.types.includes(sel) ? [sel, ...k.types] : k.types;
      return list.map((t) => `<option ${t === sel ? "selected" : ""}>${esc(t)}</option>`).join("");
    };

    root.innerHTML = `
      <div class="page-head">
        <div><h2>${k.icon} ${esc(k.title)}</h2><p>${esc(k.sub)}</p></div>
      </div>

      <div class="kpis" id="kpis"></div>

      <div class="card">
        <div class="card-title">➕ إضافة سريعة</div>
        <form id="quick-form" class="quick-grid">
          <div id="quick-emp"></div>
          <label>النوع <select id="q-type">${typeOptions(k.types[0])}</select></label>
          <label>من <input type="date" id="q-from" value="${today()}" required></label>
          <label>إلى <input type="date" id="q-to" value="${today()}"></label>
          <label class="wide">${esc(k.textLabel)}
            <input id="q-text" ${k.reasons ? 'list="reasons-list"' : ""} placeholder="${k.reasons ? "اختر سببًا مقترحًا أو اكتب السبب" : "اختياري"}">
          </label>
          <div class="quick-actions"><button class="btn btn-primary btn-block" type="submit" id="q-save">💾 حفظ</button></div>
        </form>
        ${k.reasons ? `<datalist id="reasons-list">${k.reasons.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>` : ""}
      </div>

      <div class="card">
        <div class="filters">
          <label>من تاريخ <input type="date" id="f-from" value="${ui.from}"></label>
          <label>إلى تاريخ <input type="date" id="f-to" value="${ui.to}"></label>
          <label>🔎 بحث بالاسم أو الرقم الوظيفي أو الهوية <input type="search" id="f-q" value="${esc(ui.q)}" placeholder="مثال: 27164 أو محمد"></label>
          <label>النوع <select id="f-type"><option value="">كل الأنواع</option>${k.types.map((t) => `<option ${t === ui.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
          <button class="btn" id="export-btn" type="button">📥 تصدير Excel</button>
        </div>
      </div>

      <div class="card">
        <div class="table-toolbar">
          <div class="right">
            <button class="btn btn-sm" id="add-row" type="button">➕ صف جديد</button>
            <span class="muted" id="count-label"></span>
          </div>
          <div class="left">
            <span class="pending" id="pending" hidden></span>
            <button class="btn btn-sm" id="undo-btn" type="button" disabled>↩️ إلغاء التعديلات</button>
            <button class="btn btn-ok btn-sm" id="save-btn" type="button" disabled>💾 حفظ التغييرات</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr>
              <th class="c-id">رقم السجل</th>
              <th class="c-emp">الرقم الوظيفي</th>
              <th class="c-name">الاسم</th>
              <th class="c-dept">القسم</th>
              <th class="c-type">النوع</th>
              <th class="c-date">من</th>
              <th class="c-date">إلى</th>
              <th class="c-days">الأيام</th>
              ${k.hasStatus ? `<th class="c-status">الحالة</th>` : ""}
              <th>${esc(k.textLabel)}</th>
              <th class="c-att">📎</th>
              <th class="c-del"></th>
            </tr></thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
        <div class="pager" id="pager"></div>
      </div>`;

    // ---------- الإضافة السريعة ----------
    const combo = employeeCombo($("#quick-emp"));
    $("#q-from").addEventListener("change", () => { if (!$("#q-to").value || $("#q-to").value < $("#q-from").value) $("#q-to").value = $("#q-from").value; });
    $("#quick-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const emp = combo.value;
      const from = $("#q-from").value, to = $("#q-to").value || from;
      const type = $("#q-type").value, text = $("#q-text").value.trim();
      if (!emp) return toast("اختر الموظف من القائمة أولاً", "bad");
      if (!from) return toast("اختر تاريخ البداية", "bad");
      if (to < from) return toast("تاريخ النهاية قبل البداية", "bad");
      if (kind === "absences" && type === "أخرى" && !text) return toast("اكتب السبب عند اختيار (أخرى)", "bad");
      const btn = $("#q-save");
      btn.disabled = true; btn.textContent = "جاري الحفظ...";
      try {
        const rec = { employee_id: emp.id, [k.typeCol]: type, start_date: from, end_date: to, [k.textCol]: text, created_by: userName() };
        if (k.hasStatus) rec.status = "معتمدة";
        const [saved] = await DB.insert(k.table, [rec]);
        state.data[kind] = [...(state.data[kind] || []), saved];
        ui.rows.push(...buildRows(kind, [saved]));
        toast(`✅ تم حفظ (${type}) لـ ${emp.name} — ${daysBetween(from, to)} يوم — رقم ${saved[k.key]}`, "ok");
        combo.reset();
        $("#q-text").value = "";
        ui.page = 0;
        refreshTable();
      } catch (e) {
        toast("تعذّر الحفظ: " + errMsg(e), "bad");
      } finally {
        btn.disabled = false; btn.textContent = "💾 حفظ";
      }
    });

    // ---------- الفلاتر ----------
    const onFilter = () => {
      ui.from = $("#f-from").value || "0000-01-01";
      ui.to = $("#f-to").value || "9999-12-31";
      ui.q = $("#f-q").value.trim();
      ui.type = $("#f-type").value;
      ui.page = 0;
      refreshTable();
    };
    ["#f-from", "#f-to", "#f-type"].forEach((s) => $(s).addEventListener("change", onFilter));
    let qTimer;
    $("#f-q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(onFilter, 200); });

    // ---------- أزرار الجدول ----------
    $("#add-row").addEventListener("click", () => {
      ui.tmp += 1;
      ui.rows.unshift({
        id: `new-${ui.tmp}`, isNew: true, isDeleted: false, dirty: false, orig: {},
        cur: { employee_id: "", type: k.types[0], start_date: today(), end_date: today(), text: "", status: "معتمدة" },
        name: "", dept: "", attName: "", attPath: "",
      });
      ui.page = 0;
      refreshTable();
      const first = $("#tbody tr input[data-f='employee_id']");
      first && first.focus();
    });
    $("#undo-btn").addEventListener("click", () => {
      ui.rows = buildRows(kind, state.data[kind] || []);
      refreshTable();
      toast("تم إلغاء التعديلات");
    });
    $("#save-btn").addEventListener("click", () => saveChanges(kind));
    $("#export-btn").addEventListener("click", () => exportExcel(kind, visibleRows(kind)));

    // ---------- التعديل داخل الجدول ----------
    const tbody = $("#tbody");
    tbody.addEventListener("input", (ev) => onCellEdit(ev, false));
    tbody.addEventListener("change", (ev) => onCellEdit(ev, true));
    tbody.addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr[data-id]");
      if (!tr) return;
      const row = ui.rows.find((r) => r.id === tr.dataset.id);
      if (!row) return;
      if (ev.target.closest(".del-btn")) {
        if (row.isNew) ui.rows = ui.rows.filter((r) => r !== row);
        else row.isDeleted = !row.isDeleted;
        refreshTable();
      } else if (ev.target.closest(".att-btn")) {
        openAttachment(kind, row);
      }
    });

    function onCellEdit(ev, commit) {
      const el = ev.target.closest("[data-f]");
      const tr = ev.target.closest("tr[data-id]");
      if (!el || !tr) return;
      const row = ui.rows.find((r) => r.id === tr.dataset.id);
      if (!row) return;
      const f = el.dataset.f;
      row.cur[f] = f === "employee_id" ? cleanId(el.value) : el.value;
      if (f === "start_date" && row.cur.end_date && row.cur.end_date < row.cur.start_date) row.cur.end_date = row.cur.start_date;
      if (!row.isNew) row.dirty = Object.keys(rowChanges(kind, row)).length > 0;
      if (f === "employee_id" || f === "start_date" || f === "end_date" || commit) {
        updateRowView(tr, row);
      }
      updateToolbar();
    }

    function updateRowView(tr, row) {
      const emp = state.employees.get(row.cur.employee_id);
      const nameCell = $(".c-name", tr), deptCell = $(".c-dept", tr);
      if (emp) { nameCell.textContent = emp.name; nameCell.className = "c-name"; deptCell.textContent = emp.dept; }
      else { nameCell.textContent = row.cur.employee_id ? "❌ رقم غير موجود" : "اكتب الرقم الوظيفي"; nameCell.className = "c-name name-bad"; deptCell.textContent = ""; }
      $(".c-days", tr).textContent = daysBetween(row.cur.start_date, row.cur.end_date);
      const endInput = $("[data-f='end_date']", tr);
      if (endInput && endInput.value !== row.cur.end_date) endInput.value = row.cur.end_date;
      tr.className = rowClass(row);
      const errs = rowErrors(row);
      $(".cell-emp", tr).classList.toggle("invalid", errs.includes("emp"));
      $(".cell-start", tr).classList.toggle("invalid", errs.includes("start"));
      $(".cell-end", tr).classList.toggle("invalid", errs.includes("end"));
    }

    const rowClass = (r) => (r.isDeleted ? "row-deleted" : r.isNew ? "row-new" : r.dirty ? "row-dirty" : "");

    function refreshTable() {
      const rows = visibleRows(kind);
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      ui.page = Math.min(ui.page, pages - 1);
      const slice = rows.slice(ui.page * PAGE_SIZE, (ui.page + 1) * PAGE_SIZE);

      tbody.innerHTML = slice.length ? slice.map((r) => {
        const emp = state.employees.get(r.cur.employee_id);
        const name = emp ? emp.name : (r.name || (r.cur.employee_id ? "❌ رقم غير موجود" : "اكتب الرقم الوظيفي"));
        const errs = r.isDeleted ? [] : rowErrors(r);
        return `<tr data-id="${esc(r.id)}" class="${rowClass(r)}">
          <td class="c-id">${r.isNew ? "جديد" : esc(r.id)}</td>
          <td class="c-emp cell-emp ${errs.includes("emp") ? "invalid" : ""}"><input data-f="employee_id" value="${esc(r.cur.employee_id)}" inputmode="numeric" placeholder="الرقم"></td>
          <td class="c-name ${emp ? "" : "name-bad"}">${esc(name)}</td>
          <td class="c-dept">${esc(emp ? emp.dept : r.dept)}</td>
          <td class="c-type"><select data-f="type">${typeOptions(r.cur.type)}</select></td>
          <td class="c-date cell-start ${errs.includes("start") ? "invalid" : ""}"><input type="date" data-f="start_date" value="${esc(r.cur.start_date)}"></td>
          <td class="c-date cell-end ${errs.includes("end") ? "invalid" : ""}"><input type="date" data-f="end_date" value="${esc(r.cur.end_date)}"></td>
          <td class="c-days num">${daysBetween(r.cur.start_date, r.cur.end_date)}</td>
          ${k.hasStatus ? `<td class="c-status"><select data-f="status">${(r.cur.status && !LEAVE_STATUSES.includes(r.cur.status) ? [r.cur.status, ...LEAVE_STATUSES] : LEAVE_STATUSES).map((s) => `<option ${s === r.cur.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></td>` : ""}
          <td><input data-f="text" value="${esc(r.cur.text)}" ${k.reasons ? 'list="reasons-list"' : ""}></td>
          <td class="c-att">${r.isNew || !r.attPath ? "" : `<button class="btn btn-ghost btn-sm att-btn" type="button" title="${esc(r.attName || "المرفق")}">📎</button>`}</td>
          <td class="c-del"><button class="btn-danger-ghost del-btn" type="button" title="${r.isDeleted ? "تراجع عن الحذف" : "حذف"}">${r.isDeleted ? "↩️" : "🗑️"}</button></td>
        </tr>`;
      }).join("") : `<tr class="empty-row"><td colspan="12">لا توجد سجلات ضمن الشروط المحددة</td></tr>`;

      $("#count-label").textContent = `المعروض: ${rows.length.toLocaleString("en-US")} سجل`;
      $("#pager").innerHTML = pages > 1 ? `
        <button class="btn btn-sm" id="pg-prev" ${ui.page === 0 ? "disabled" : ""}>→ السابق</button>
        <span class="muted">صفحة ${ui.page + 1} من ${pages}</span>
        <button class="btn btn-sm" id="pg-next" ${ui.page >= pages - 1 ? "disabled" : ""}>التالي ←</button>` : "";
      $("#pg-prev")?.addEventListener("click", () => { ui.page--; refreshTable(); });
      $("#pg-next")?.addEventListener("click", () => { ui.page++; refreshTable(); });

      renderKpis(kind, rows);
      updateToolbar();
    }

    function updateToolbar() {
      const added = ui.rows.filter((r) => r.isNew).length;
      const edited = ui.rows.filter((r) => r.dirty && !r.isDeleted && !r.isNew).length;
      const deleted = ui.rows.filter((r) => r.isDeleted).length;
      const invalid = ui.rows.filter((r) => !r.isDeleted && (r.isNew || r.dirty) && rowErrors(r).length).length;
      const any = added + edited + deleted > 0;
      const pend = $("#pending");
      pend.hidden = !any;
      pend.textContent = `غير محفوظ: ➕ ${added} جديد · ✏️ ${edited} تعديل · 🗑️ ${deleted} حذف` + (invalid ? ` · ⚠️ ${invalid} بها أخطاء` : "");
      $("#save-btn").disabled = !any || invalid > 0;
      $("#undo-btn").disabled = !any;
    }

    refreshTable();
  }

  function visibleRows(kind) {
    const k = KINDS[kind], ui = uiFor(kind);
    const q = ui.q.toLowerCase();
    const rows = ui.rows.filter((r) => {
      if (r.isNew) return true;
      if (!overlaps(r.cur.start_date, r.cur.end_date, ui.from, ui.to)) return false;
      if (ui.type && r.cur.type !== ui.type) return false;
      if (q) {
        const emp = state.employees.get(r.cur.employee_id);
        const hay = `${r.cur.employee_id} ${emp ? emp.name : r.name} ${emp ? emp.nid : ""} ${r.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const num = (id) => +((String(id).match(/(\d+)$/) || [0, 0])[1]);
    return rows.sort((a, b) =>
      (b.isNew - a.isNew) ||
      (b.cur.start_date || "").localeCompare(a.cur.start_date || "") ||
      (num(b.id) - num(a.id))
    );
    void k;
  }

  function renderKpis(kind, rows) {
    const live = rows.filter((r) => !r.isNew && !r.isDeleted);
    const totalDays = live.reduce((s, r) => s + daysBetween(r.cur.start_date, r.cur.end_date), 0);
    const people = new Set(live.map((r) => r.cur.employee_id)).size;
    const byType = (t) => live.filter((r) => r.cur.type === t).reduce((s, r) => s + daysBetween(r.cur.start_date, r.cur.end_date), 0);
    let cards;
    if (kind === "leaves") {
      cards = [
        ["v", live.length, "عدد السجلات"],
        ["v", totalDays, "إجمالي الأيام"],
        ["v", people, "عدد الموظفين"],
        ["ok", byType("سنوية"), "أيام سنوية"],
        ["bad", byType("مرضية"), "أيام مرضية"],
      ];
    } else {
      cards = [
        ["v", live.length, "عدد التسجيلات"],
        ["ok", byType("غياب بإذن"), "أيام غياب بإذن"],
        ["bad", byType("غياب بدون إذن"), "أيام غياب بدون إذن"],
        ["warn", live.filter((r) => r.cur.type === "تأخير بعذر" || r.cur.type === "خروج مبكر بإذن").length, "أعذار تأخير / خروج"],
        ["v", people, "عدد الموظفين"],
      ];
    }
    $("#kpis").innerHTML = cards.map(([c, v, l]) =>
      `<div class="kpi ${c === "v" ? "" : c}"><div class="v num">${Number(v).toLocaleString("en-US")}</div><div class="l">${esc(l)}</div></div>`
    ).join("");
  }

  // ---------------- الحفظ ----------------
  async function saveChanges(kind) {
    const k = KINDS[kind], ui = uiFor(kind);
    const inserts = [], updates = [], deletes = [];
    for (const r of ui.rows) {
      if (r.isNew) {
        if (rowErrors(r).length) return toast("توجد صفوف بها أخطاء (باللون الأحمر) — يُرجى تصحيحها قبل الحفظ", "bad");
        const rec = { employee_id: r.cur.employee_id, [k.typeCol]: r.cur.type, start_date: r.cur.start_date, end_date: r.cur.end_date || r.cur.start_date, [k.textCol]: r.cur.text, created_by: userName() };
        if (k.hasStatus) rec.status = r.cur.status || "معتمدة";
        inserts.push(rec);
      } else if (r.isDeleted) {
        deletes.push(r.id);
      } else if (r.dirty) {
        if (rowErrors(r).length) return toast("توجد صفوف بها أخطاء (باللون الأحمر) — يُرجى تصحيحها قبل الحفظ", "bad");
        updates.push([r.id, rowChanges(kind, r)]);
      }
    }
    if (deletes.length && !confirm(`سيتم حذف ${deletes.length} سجل نهائيًا. هل أنت متأكد؟`)) return;

    loading(true, "جاري الحفظ...");
    try {
      if (inserts.length) await DB.insert(k.table, inserts);
      for (const [id, f] of updates) await DB.update(k.table, k.key, id, f);
      if (deletes.length) await DB.remove(k.table, k.key, deletes);
      ui.rows = buildRows(kind, await loadKind(kind, true));
      toast(`✅ تم الحفظ — جديد ${inserts.length} · تعديل ${updates.length} · حذف ${deletes.length}`, "ok");
    } catch (e) {
      toast("تعذّر الحفظ: " + errMsg(e), "bad");
    } finally {
      loading(false);
    }
    route();
  }

  // ---------------- المرفقات ----------------
  function openModal(title, html) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = html;
    $("#modal").hidden = false;
  }
  function closeModal() { $("#modal").hidden = true; $("#modal-body").innerHTML = ""; }
  $("#modal").addEventListener("click", (ev) => { if (ev.target.id === "modal" || ev.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("#modal").hidden) closeModal(); });

  async function openAttachment(kind, row) {
    const k = KINDS[kind];
    const emp = state.employees.get(row.cur.employee_id);
    openModal(`📎 مرفق ${row.id}`, `
      <div class="stack">
        <div><b>${esc(emp ? emp.name : row.name)}</b> — <span class="tag">${esc(row.cur.type)}</span> ${esc(fmtDate(row.cur.start_date))}</div>
        <div id="att-view">${row.attPath ? '<span class="muted">جاري فتح المرفق...</span>' : '<span class="muted">لا يوجد مرفق لهذا السجل.</span>'}</div>
      </div>`);
    if (row.attPath) {
      const view = $("#att-view");
      if (!row.attPath.startsWith(ATTACH_PREFIX)) {
        view.innerHTML = `<span class="muted">هذا المرفق مسجّل في النظام القديم وغير متاح: ${esc(row.attName)}</span>`;
        return;
      }
      try {
        const url = await DB.fileUrl(row.attPath);
        const isImg = /\.(png|jpe?g|gif|webp)$/i.test(row.attPath);
        view.innerHTML = `${isImg ? `<img src="${esc(url)}" alt="">` : ""}
          <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">⬇️ فتح / تحميل: ${esc(row.attName || "المرفق")}</a>`;
      } catch (e) {
        view.innerHTML = `<div class="form-error">تعذّر فتح المرفق: ${esc(errMsg(e))}</div>`;
      }
    }
  }

  // ---------------- التصدير ----------------
  function exportExcel(kind, rows) {
    const k = KINDS[kind];
    const live = rows.filter((r) => !r.isNew && !r.isDeleted);
    if (!live.length) return toast("لا توجد سجلات للتصدير", "bad");
    const out = live.map((r) => {
      const emp = state.employees.get(r.cur.employee_id);
      const o = {
        "رقم السجل": r.id,
        "الرقم الوظيفي": r.cur.employee_id,
        "الاسم": emp ? emp.name : r.name,
        "القسم": emp ? emp.dept : r.dept,
        "النوع": r.cur.type,
        "من": r.cur.start_date,
        "إلى": r.cur.end_date,
        "عدد الأيام": daysBetween(r.cur.start_date, r.cur.end_date),
      };
      if (k.hasStatus) o["الحالة"] = r.cur.status;
      o[k.textLabel] = r.cur.text;
      o["مرفق"] = r.attName ? "نعم" : "";
      o["المُسجِّل"] = r.orig.created_by || "";
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(out);
    ws["!cols"] = Object.keys(out[0]).map((h) => ({ wch: Math.max(10, h.length + 4, ...out.slice(0, 200).map((o) => String(o[h] ?? "").length + 2)) }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, k.title.slice(0, 30));
    const ui = uiFor(kind);
    XLSX.writeFile(wb, `${kind}_${ui.from}_${ui.to}.xlsx`);
  }

  // ---------------- الثيم (فاتح / غامق) ----------------
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch (_) { /* التخزين مقفول */ }
    $("#theme-btn").textContent = t === "dark" ? "☀️" : "🌙";
    $("#theme-btn").title = t === "dark" ? "الوضع الفاتح" : "الوضع الغامق";
  }
  setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  $("#theme-btn").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  // ---------------- التنبيه بوجود نسخة جديدة ----------------
  const APP_VERSION = window.APP_VERSION || "0";
  $("#app-version").textContent = "إصدار " + APP_VERSION;
  async function checkVersion() {
    try {
      const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const { version } = await r.json();
      if (version && String(version) !== String(APP_VERSION) && !$(".update-bar")) {
        const bar = document.createElement("div");
        bar.className = "update-bar";
        bar.innerHTML = `🔔 يتوفر إصدار جديد من النظام <button type="button">تحديث الآن</button>`;
        bar.querySelector("button").addEventListener("click", () => {
          if (hasPendingChanges() && !confirm("توجد تعديلات غير محفوظة وستُفقد. هل تريد التحديث على أي حال؟")) return;
          location.replace(location.pathname + "?v=" + encodeURIComponent(version) + location.hash);
        });
        document.body.appendChild(bar);
      }
    } catch (_) { /* لا يوجد اتصال — ستتم المحاولة لاحقًا */ }
  }
  checkVersion();
  setInterval(checkVersion, 5 * 60 * 1000);

  // ---------------- عناوين الأعمدة للعرض على الموبايل (كل صف بطاقة) ----------------
  function labelTables() {
    document.querySelectorAll("table.grid").forEach((t) => {
      const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.replace(/[▲▼]/g, "").trim());
      if (!heads.length) return;
      t.querySelectorAll("tbody tr").forEach((tr) => {
        [...tr.children].forEach((td, i) => { if (!td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] || ""); });
      });
    });
  }
  let labelTimer;
  new MutationObserver(() => { clearTimeout(labelTimer); labelTimer = setTimeout(labelTables, 30); })
    .observe(document.body, { childList: true, subtree: true });

  // واجهة مشتركة لباقي الصفحات (تقرير البصمة / التقارير)
  window.APP = {
    state, DB, esc, toast, loading, errMsg, cleanId, loadKind, fmtDate, toISO, daysBetween, KINDS,
    async reloadEmployees() { await loadEmployees(); showConnStatus(); },
    employeeCombo, hasPendingChanges, userName, movementUsers, canMovement,
    // إعدادات الدوام (من قاعدة البيانات، وإلا القيم الافتراضية في rules.js)
    settings() {
      const R = window.ATT_RULES || {};
      const st = String(state.settings.start_time || R.DEFAULT_START || "08:00").slice(0, 5);
      const gr = Number.isFinite(+state.settings.grace_minutes) && state.settings.grace_minutes !== undefined && state.settings.grace_minutes !== "" ? +state.settings.grace_minutes : (R.DEFAULT_GRACE ?? 15);
      return { start: st, grace: gr };
    },
    resetRecordPages() { for (const k of Object.keys(state.ui)) state.ui[k].rows = null; },
  };

  // =========================================================
  // البداية
  // =========================================================
  (async () => {
    if (!DB) { showLogin(); return; }
    try {
      const s = await DB.session();
      if (s && s.user) return startApp(s.user);
    } catch (_) { /* نكمل لشاشة الدخول */ }
    showLogin();
  })();
})();
