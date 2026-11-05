/* =========================================================
   الإعدادات (للمدير فقط)
   - رفع / تحديث ملف الموظفين
   - رفع الإجازات (والغياب) السابقة من ملف Excel
   ========================================================= */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const clean = (v) => String(v ?? "").trim().replace(/\.0+$/, "");
  const text = (v) => { const s = String(v ?? "").trim(); return s && !["nan", "NaN", "None", "NaT"].includes(s) ? s : null; };

  function toISO(v) {
    if (v == null || v === "") return "";
    if (typeof v === "number" && v > 1) {
      const d = new Date(EXCEL_EPOCH + Math.floor(v) * 864e5);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    if (window.ATT_ENGINE) return window.ATT_ENGINE.parseDateCell(v);
    const m = String(v).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : "";
  }

  async function readBook(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const sheets = {};
    for (const name of wb.SheetNames) {
      sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { raw: true, defval: "" });
    }
    return sheets;
  }

  const pick = (row, ...names) => { for (const n of names) if (row[n] !== undefined && row[n] !== "") return row[n]; return ""; };
  const findSheet = (sheets, test) => Object.entries(sheets).find(([, rows]) => rows.length && test(Object.keys(rows[0])));

  // ---------------- الموظفين ----------------
  function parseEmployees(sheets) {
    const hit = findSheet(sheets, (k) => k.includes("Personnel Number"))
      || findSheet(sheets, (k) => k.includes("employee_id") && !k.includes("start_date") && (k.includes("name_ar") || k.includes("Arabic name")));
    if (!hit) throw new Error("لم يتم العثور على ورقة تحتوي على عمود Personnel Number (أو employee_id)");
    const [sheetName, rows] = hit;
    const map = new Map();
    for (const r of rows) {
      const id = clean(pick(r, "Personnel Number", "employee_id"));
      if (!id) continue;
      map.set(id, {
        employee_id: id,
        name_ar: text(pick(r, "Arabic name", "name_ar")),
        name_en: text(pick(r, "Search name", "Name", "name_en")),
        department: text(pick(r, "Section | Department", "department")),
        job_title: text(pick(r, "Contrac Profession", "job_title")),
        nationality: text(pick(r, "Nationality", "nationality")),
        attendance_calculation: text(pick(r, "attendance_calculation", "Attendance Calculation")),
      });
    }
    return { sheetName, rows: [...map.values()] };
  }

  // ---------------- الإجازات والغياب السابقة ----------------
  function parseHistory(sheets, known, existing) {
    const out = { leaves: [], absences: [], dup: 0, unknown: new Set(), invalid: 0, sheets: [] };
    const key = (e, s, t, x) => `${e}|${s}|${t}|${x}`;

    const lvHit = findSheet(sheets, (k) => k.includes("employee_id") && k.includes("start_date"));
    if (lvHit) {
      out.sheets.push(lvHit[0]);
      const seen = new Set(existing.leaves.map((l) => key(clean(l.employee_id), String(l.start_date).slice(0, 10), String(l.end_date || l.start_date).slice(0, 10), l.leave_type || "")));
      const ids = new Set(existing.leaves.map((l) => l.leave_id));
      for (const r of lvHit[1]) {
        const id = clean(r.employee_id || r.employee_no);
        const s = toISO(r.start_date), e = toISO(r.end_date) || s;
        if (!id && !s) continue;                       // صف فاضي
        if (!id || !s || e < s) { out.invalid++; continue; }
        if (!known.has(id)) { out.unknown.add(id); continue; }
        const type = text(r.leave_type) || "إجازة";
        const k = key(id, s, e, type);
        if (seen.has(k)) { out.dup++; continue; }
        seen.add(k);
        const rec = { employee_id: id, leave_type: type, start_date: s, end_date: e, status: text(r.status) || "معتمدة", notes: text(r.notes), created_by: "استيراد" };
        const lid = text(r.leave_id);
        if (lid && /^LV-\d+$/.test(lid) && !ids.has(lid)) { rec.leave_id = lid; ids.add(lid); }
        out.leaves.push(rec);
      }
    }

    const abHit = findSheet(sheets, (k) => k.includes("الرقم الوظيفي") && k.includes("من تاريخ"))
      || findSheet(sheets, (k) => k.includes("record_type") && k.includes("start_date"));
    if (abHit) {
      out.sheets.push(abHit[0]);
      const seen = new Set(existing.absences.map((a) => key(clean(a.employee_id), String(a.start_date).slice(0, 10), String(a.end_date || a.start_date).slice(0, 10), a.record_type || "")));
      for (const r of abHit[1]) {
        const id = clean(pick(r, "الرقم الوظيفي", "employee_id"));
        const s = toISO(pick(r, "من تاريخ", "start_date")), e = toISO(pick(r, "إلى تاريخ", "end_date")) || s;
        if (!id && !s) continue;
        if (!id || !s || e < s) { out.invalid++; continue; }
        if (!known.has(id)) { out.unknown.add(id); continue; }
        const type = text(pick(r, "النوع", "record_type")) || "غياب بإذن";
        const k = key(id, s, e, type);
        if (seen.has(k)) { out.dup++; continue; }
        seen.add(k);
        out.absences.push({ employee_id: id, record_type: type, start_date: s, end_date: e, reason: text(pick(r, "السبب", "reason")), created_by: "استيراد" });
      }
    }
    if (!out.sheets.length) throw new Error("لم يتم العثور على ورقة إجازات (تحتوي على employee_id و start_date) أو ورقة غياب");
    return out;
  }

  // =========================================================
  // الصفحة
  // =========================================================
  const view = { emp: null, hist: null };

  function render(root) {
    const A = window.APP, esc = A.esc;
    if (!A.state.isAdmin) {
      root.innerHTML = `<div class="card soon"><div class="big">🔒</div><h2>الإعدادات</h2><p class="muted">هذه الصفحة مخصّصة للمدير فقط.</p></div>`;
      return;
    }
    root.innerHTML = `
      <div class="page-head"><div><h2>⚙️ الإعدادات</h2><p>رفع وتحديث بيانات الموظفين، واستيراد الإجازات والغياب السابقة — للمدير فقط.</p></div></div>

      <div class="kpis">
        <div class="kpi"><div class="v num">${A.state.employees.size.toLocaleString("en-US")}</div><div class="l">الموظفين في قاعدة البيانات</div></div>
      </div>

      <div class="card">
        <div class="card-title">👥 رفع ملف الموظفين</div>
        <p class="muted" style="margin-top:-6px">ملف Excel يحتوي على عمود <b>Personnel Number</b>. تُحدَّث بيانات الموظف الموجود، ويُضاف الموظف الجديد، ولا يُحذف أي موظف.
          تُحفظ البيانات التالية فقط: الرقم الوظيفي، والاسم العربي والإنجليزي، والقسم، والوظيفة، والجنسية، وطريقة الاحتساب — <b>لا يُرفع رقم الهوية ولا الآيبان ولا أي بيانات شخصية أخرى</b>.</p>
        <div class="settings-row">
          <label class="dropzone small" id="emp-dz"><input type="file" id="emp-file" accept=".xlsx,.xls" hidden>
            <div class="dz-icon">👥</div><div class="dz-title" id="emp-dz-title">اختر ملف الموظفين</div></label>
          <div class="settings-side" id="emp-preview"><span class="muted">لم يتم اختيار ملف بعد.</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🏖️ رفع الإجازات والغياب السابقة</div>
        <p class="muted" style="margin-top:-6px">ملف Excel يحتوي على ورقة الإجازات (أعمدة <b>employee_id</b> و <b>start_date</b> و <b>end_date</b> و <b>leave_type</b>)،
          وإن وُجدت ورقة <b>الغياب والتأخير</b> فستُرفع أيضًا. تُتجاهل السجلات المكررة (الموظف نفسه والتواريخ نفسها والنوع نفسه)، لذا يمكن رفع الملف نفسه أكثر من مرة بأمان.</p>
        <div class="settings-row">
          <label class="dropzone small" id="hist-dz"><input type="file" id="hist-file" accept=".xlsx,.xls" hidden>
            <div class="dz-icon">🏖️</div><div class="dz-title" id="hist-dz-title">اختر ملف الإجازات</div></label>
          <div class="settings-side" id="hist-preview"><span class="muted">لم يتم اختيار ملف بعد.</span></div>
        </div>
      </div>`;

    // ---------- الموظفين ----------
    const empFile = $("#emp-file");
    empFile.addEventListener("change", async () => {
      const f = empFile.files[0]; if (!f) return;
      $("#emp-dz-title").textContent = f.name;
      try {
        A.loading(true, "جاري قراءة ملف الموظفين...");
        view.emp = parseEmployees(await readBook(f));
        const isNew = view.emp.rows.filter((r) => !A.state.employees.has(r.employee_id)).length;
        $("#emp-preview").innerHTML = `
          <div class="preview-list">
            <div>📄 الورقة: <b>${esc(view.emp.sheetName)}</b></div>
            <div>👥 عدد الموظفين في الملف: <b>${view.emp.rows.length.toLocaleString("en-US")}</b></div>
            <div class="txt-ok">➕ جديد: <b>${isNew.toLocaleString("en-US")}</b></div>
            <div>✏️ موجود (سيُحدَّث): <b>${(view.emp.rows.length - isNew).toLocaleString("en-US")}</b></div>
          </div>
          <button class="btn btn-primary" id="emp-go">⬆️ رفع وتحديث الموظفين</button>`;
        $("#emp-go").addEventListener("click", uploadEmployees);
      } catch (e) {
        $("#emp-preview").innerHTML = `<div class="form-error">${esc(A.errMsg(e))}</div>`;
      } finally { A.loading(false); }
    });

    async function uploadEmployees() {
      const rows = view.emp.rows;
      $("#emp-go").disabled = true;
      try {
        for (let i = 0; i < rows.length; i += 500) {
          A.loading(true, `جاري رفع الموظفين... ${Math.min(i + 500, rows.length).toLocaleString("en-US")} من ${rows.length.toLocaleString("en-US")}`);
          await A.DB.upsert("employees", rows.slice(i, i + 500), "employee_id");
        }
        await A.reloadEmployees();
        A.toast(`✅ تم رفع ${rows.length.toLocaleString("en-US")} موظف`, "ok");
        view.emp = null;
        render(root);
      } catch (e) {
        A.toast("تعذّر رفع الموظفين: " + A.errMsg(e), "bad");
        $("#emp-go").disabled = false;
      } finally { A.loading(false); }
    }

    // ---------- الإجازات والغياب ----------
    const histFile = $("#hist-file");
    histFile.addEventListener("change", async () => {
      const f = histFile.files[0]; if (!f) return;
      $("#hist-dz-title").textContent = f.name;
      try {
        A.loading(true, "جاري قراءة الملف ومقارنته بالموجود...");
        const [sheets, leaves, absences] = await Promise.all([readBook(f), A.loadKind("leaves", true), A.loadKind("absences", true)]);
        const h = view.hist = parseHistory(sheets, A.state.employees, { leaves, absences });
        const unknown = [...h.unknown];
        $("#hist-preview").innerHTML = `
          <div class="preview-list">
            <div>📄 الأوراق: <b>${h.sheets.map(esc).join(" ، ")}</b></div>
            <div class="txt-ok">🏖️ إجازات جديدة سيتم رفعها: <b>${h.leaves.length.toLocaleString("en-US")}</b></div>
            <div class="txt-ok">⏰ غياب/تأخير جديد سيتم رفعه: <b>${h.absences.length.toLocaleString("en-US")}</b></div>
            <div>🔁 مكرر موجود مسبقًا (سيتم تجاهله): <b>${h.dup.toLocaleString("en-US")}</b></div>
            ${h.invalid ? `<div class="txt-bad">⚠️ صفوف ناقصة أو بتواريخ غير صحيحة (سيتم تجاهلها): <b>${h.invalid}</b></div>` : ""}
            ${unknown.length ? `<div class="txt-bad">⚠️ أرقام وظيفية غير موجودة في قائمة الموظفين (سيتم تجاهلها): <b>${unknown.length}</b>
              <div class="muted small-list">${unknown.slice(0, 30).map(esc).join("، ")}${unknown.length > 30 ? " ..." : ""}</div></div>` : ""}
          </div>
          <button class="btn btn-primary" id="hist-go" ${h.leaves.length + h.absences.length ? "" : "disabled"}>⬆️ رفع السجلات الجديدة</button>`;
        $("#hist-go").addEventListener("click", uploadHistory);
      } catch (e) {
        $("#hist-preview").innerHTML = `<div class="form-error">${esc(A.errMsg(e))}</div>`;
      } finally { A.loading(false); }
    });

    async function uploadHistory() {
      const h = view.hist;
      $("#hist-go").disabled = true;
      try {
        // السجلات اللي معاها رقم (LV-n) الأول، وبعدها اللي من غير رقم عشان تاخد أرقام بعدها
        const withId = h.leaves.filter((r) => r.leave_id), noId = h.leaves.filter((r) => !r.leave_id);
        let done = 0;
        const total = h.leaves.length + h.absences.length;
        for (const [table, list] of [["leaves", withId], ["leaves", noId], ["absences", h.absences]]) {
          for (let i = 0; i < list.length; i += 200) {
            A.loading(true, `جاري الرفع... ${(done + Math.min(i + 200, list.length)).toLocaleString("en-US")} من ${total.toLocaleString("en-US")}`);
            await A.DB.insert(table, list.slice(i, i + 200));
          }
          done += list.length;
        }
        await Promise.all([A.loadKind("leaves", true), A.loadKind("absences", true)]);
        A.resetRecordPages();
        A.toast(`✅ تم رفع ${h.leaves.length} إجازة و ${h.absences.length} غياب/تأخير`, "ok");
        view.hist = null;
        render(root);
      } catch (e) {
        A.toast("تعذّر الرفع: " + A.errMsg(e), "bad");
        $("#hist-go").disabled = false;
      } finally { A.loading(false); }
    }
  }

  window.PAGES = window.PAGES || {};
  window.PAGES.settings = render;
  window.SETTINGS_TEST = { parseEmployees, parseHistory, readBook };
})();
