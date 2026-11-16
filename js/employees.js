/* =========================================================
   بيانات الموظفين — عرض الموظفين وتعديل بياناتهم
   لا يمكن تعديل: الرقم الوظيفي، الاسم العربي، الاسم الإنجليزي، رقم الهوية / الإقامة
   ========================================================= */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const SAT = { "": "تلقائي (حسب الجنسية)", work: "يعمل السبت", off: "السبت إجازة" };
  const view = { q: "", dept: "", nat: "", sat: "", sort: "id", dir: 1 };

  // يعمل السبت فعليًا؟ (تلقائي = غير السعودي يعمل السبت)
  const isSaudi = (n) => /saudi|سعود/i.test(String(n || ""));
  const satEffective = (e) => (e.sat === "work" ? true : e.sat === "off" ? false : !isSaudi(e.nat));

  function render(root) {
    const A = window.APP;
    if (!A.canEmployees()) { location.hash = "#leaves"; return; }
    root.innerHTML = `
      <div class="page-head">
        <div><h2>👥 بيانات الموظفين</h2><p>عرض بيانات الموظفين وتعديل القسم والوظيفة والجنسية ودوام السبت. الحقول المقفلة 🔒 (الرقم الوظيفي، والاسم العربي، والاسم الإنجليزي، ورقم الهوية / الإقامة) لا تُعدَّل من هنا.</p></div>
      </div>
      <div class="card">
        <div class="table-toolbar emp-toolbar">
          <div class="right">
            <input type="search" id="em-q" placeholder="🔎 بحث بالاسم أو الرقم الوظيفي أو رقم الهوية" value="${A.esc(view.q)}">
            <select id="em-dept"></select>
            <select id="em-nat"></select>
            <select id="em-sat">
              <option value="">دوام السبت: الكل</option><option value="work">يعمل السبت</option><option value="off">السبت إجازة</option>
            </select>
          </div>
          <div class="left">
            <span class="tag" id="em-count"></span>
            <button class="btn btn-sm" id="em-xlsx">📥 تصدير Excel</button>
          </div>
        </div>
        <div class="table-wrap"><table class="grid view-grid emp-grid">
          <thead><tr>
            <th data-sort="id">الرقم الوظيفي 🔒</th><th data-sort="name">الاسم العربي 🔒</th><th data-sort="nameEn">الاسم الإنجليزي 🔒</th><th data-sort="nid">رقم الهوية / الإقامة 🔒</th>
            <th data-sort="dept">القسم</th><th data-sort="job">الوظيفة</th><th data-sort="nat">الجنسية</th><th data-sort="sat">دوام السبت</th><th></th>
          </tr></thead>
          <tbody id="em-body"></tbody>
        </table></div>
      </div>`;

    fillFilters();
    $("#em-q").addEventListener("input", (e) => { view.q = e.target.value; fill(); });
    [["#em-dept", "dept"], ["#em-nat", "nat"], ["#em-sat", "sat"]].forEach(([sel, k]) => {
      $(sel).value = view[k];
      $(sel).addEventListener("change", (e) => { view[k] = e.target.value; fill(); });
    });
    root.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      view.dir = view.sort === th.dataset.sort ? -view.dir : 1;
      view.sort = th.dataset.sort; fill();
    }));
    $("#em-body").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (tr) openEdit(tr.dataset.id);
    });
    $("#em-xlsx").addEventListener("click", exportExcel);
    fill();
  }

  const uniq = (k) => [...new Set(window.APP.state.empList.map((e) => e[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));

  function fillFilters() {
    const esc = window.APP.esc;
    $("#em-dept").innerHTML = `<option value="">القسم: الكل</option>` + uniq("dept").map((d) => `<option>${esc(d)}</option>`).join("");
    $("#em-nat").innerHTML = `<option value="">الجنسية: الكل</option>` + uniq("nat").map((d) => `<option>${esc(d)}</option>`).join("");
  }

  function filtered() {
    const q = view.q.trim().toLowerCase();
    const list = window.APP.state.empList.filter((e) =>
      (!q || e.hay.includes(q)) && (!view.dept || e.dept === view.dept) && (!view.nat || e.nat === view.nat) &&
      (!view.sat || (view.sat === "work") === satEffective(e)));
    const k = view.sort;
    const val = (e) => (k === "sat" ? (satEffective(e) ? 1 : 0) : String(e[k] || ""));
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      if (k === "id" || k === "nid") return (Number(x) - Number(y) || x.localeCompare(y)) * view.dir;
      return (typeof x === "number" ? x - y : x.localeCompare(y, "ar")) * view.dir;
    });
  }

  function satCell(e) {
    const w = satEffective(e);
    return `<span class="tag ${w ? "ok-tag" : ""}">${w ? "يعمل السبت" : "السبت إجازة"}</span>${e.sat ? "" : ' <span class="muted small-note">تلقائي</span>'}`;
  }

  function fill() {
    const esc = window.APP.esc;
    const list = filtered();
    $("#em-count").textContent = `${list.length.toLocaleString("en-US")} موظف`;
    document.querySelectorAll(".emp-grid th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === view.sort);
      th.dataset.arrow = th.dataset.sort === view.sort ? (view.dir > 0 ? "▲" : "▼") : "";
    });
    $("#em-body").innerHTML = list.map((e) => `
      <tr data-id="${esc(e.id)}">
        <td class="num locked" data-label="الرقم الوظيفي">${esc(e.id)}</td>
        <td class="nm locked" data-label="الاسم العربي"><b>${esc(e.name || "—")}</b></td>
        <td class="locked" dir="ltr" data-label="الاسم الإنجليزي">${esc(e.nameEn || "—")}</td>
        <td class="num locked" data-label="رقم الهوية / الإقامة">${esc(e.nid || "—")}</td>
        <td data-label="القسم">${esc(e.dept || "—")}</td>
        <td data-label="الوظيفة">${esc(e.job || "—")}</td>
        <td data-label="الجنسية">${esc(e.nat || "—")}</td>
        <td data-label="دوام السبت">${satCell(e)}</td>
        <td data-label=""><button class="btn btn-sm">✏️ تعديل</button></td>
      </tr>`).join("") || `<tr><td colspan="9" class="muted" style="text-align:center">لا توجد نتائج</td></tr>`;
  }

  function openEdit(id) {
    const A = window.APP, esc = A.esc;
    const e = A.state.employees.get(id);
    if (!e) return;
    const lock = (l, v, ltr) => `<label class="locked-field">${l} 🔒<input value="${esc(v || "")}" disabled ${ltr ? 'dir="ltr"' : ""}></label>`;
    A.openModal(`✏️ تعديل بيانات الموظف ${e.id}`, `
      <form id="em-form" class="em-form">
        <div class="em-locked">
          ${lock("الرقم الوظيفي", e.id, true)}${lock("رقم الهوية / الإقامة", e.nid, true)}
          ${lock("الاسم العربي", e.name)}${lock("الاسم الإنجليزي", e.nameEn, true)}
        </div>
        <div class="em-edit">
          <label>القسم <input id="ef-dept" list="ef-dept-list" value="${esc(e.dept)}"></label>
          <label>الوظيفة <input id="ef-job" list="ef-job-list" value="${esc(e.job)}"></label>
          <label>الجنسية * <input id="ef-nat" list="ef-nat-list" value="${esc(e.nat)}" required></label>
          <label>دوام السبت <select id="ef-sat">${Object.entries(SAT).map(([k, l]) => `<option value="${k}" ${e.sat === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <datalist id="ef-dept-list">${uniq("dept").map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
        <datalist id="ef-job-list">${uniq("job").map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
        <datalist id="ef-nat-list">${uniq("nat").map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
        <p class="muted small-note">«تلقائي» في دوام السبت: غير السعودي يعمل السبت، والسعودي السبت إجازة له.</p>
        <div class="em-actions"><button type="button" class="btn" data-close>إلغاء</button><button type="submit" class="btn btn-primary" id="ef-save">💾 حفظ التعديل</button></div>
      </form>`);
    $("#em-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fields = {
        department: $("#ef-dept").value.trim() || null,
        job_title: $("#ef-job").value.trim() || null,
        nationality: $("#ef-nat").value.trim() || null,
        saturday_rule: $("#ef-sat").value || null,
      };
      const same = (fields.department || "") === e.dept && (fields.job_title || "") === e.job && (fields.nationality || "") === e.nat && (fields.saturday_rule || "") === e.sat;
      if (same) { A.closeModal(); A.toast("لا يوجد تغيير", "warn"); return; }
      $("#ef-save").disabled = true;
      A.loading(true, "جاري حفظ التعديل...");
      try {
        await A.DB.updateOne("employees", "employee_id", e.id, fields);
        await A.reloadEmployees();
        A.closeModal();
        A.toast(`✅ تم حفظ بيانات ${e.name || e.id}`, "ok");
        fillFilters(); fill();
        const tr = document.querySelector(`#em-body tr[data-id="${CSS.escape(e.id)}"]`);
        if (tr) { tr.classList.add("row-flash"); setTimeout(() => tr.classList.remove("row-flash"), 1800); }
      } catch (err) {
        A.toast("تعذّر الحفظ: " + A.errMsg(err) + (/permission|policy|row-level|صلاحية/i.test(A.errMsg(err)) ? " — تأكد من تشغيل ملف قاعدة البيانات 7_employees_editors.sql" : ""), "bad");
        $("#ef-save").disabled = false;
      } finally { A.loading(false); }
    });
  }

  function exportExcel() {
    const rows = filtered().map((e) => ({
      "الرقم الوظيفي": e.id, "الاسم العربي": e.name, "الاسم الإنجليزي": e.nameEn, "رقم الهوية / الإقامة": e.nid,
      "القسم": e.dept, "الوظيفة": e.job, "الجنسية": e.nat, "دوام السبت": satEffective(e) ? "يعمل السبت" : "السبت إجازة",
      "طريقة تحديد السبت": e.sat ? "محدد يدويًا" : "تلقائي",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [12, 30, 30, 18, 20, 26, 14, 14, 16].map((w) => ({ wch: w }));
    if (rows.length) ws["!autofilter"] = { ref: `A1:I${rows.length + 1}` };
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "الموظفون");
    XLSX.writeFile(wb, `الموظفون_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  window.PAGES = window.PAGES || {};
  window.PAGES.employees = render;
})();
