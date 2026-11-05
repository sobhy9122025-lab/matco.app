// =========================================================
// إعدادات الاتصال — يُعدَّل السطران التاليان فقط
// =========================================================
// من Supabase: Project Settings ← Data API ← Project URL
// ومن Project Settings ← API Keys ← المفتاح العام (publishable / anon)
//
// ⚠️ يوضع هنا المفتاح العام (publishable أو anon) فقط — وليس المفتاح السري (secret / service_role).
//    المفتاح العام آمن في الصفحة، لأن الجداول محمية ولا يمكن الوصول إليها إلا بعد تسجيل الدخول.
window.APP_CONFIG = {
  SUPABASE_URL: "https://owfxdflgxtebpaprkjvp.supabase.co",
  SUPABASE_KEY: "sb_publishable_SarQ9RCM2RMvvPc4_kmHUw__ZsULbmj",

  // إذا كتب المستخدم اسمه دون @ (مثل a.salam) يُحوَّل تلقائيًا إلى a.salam@matco.app
  LOGIN_DOMAIN: "matco.app",

  // التوقيع الذي يظهر أسفل الشاشات وفي نهاية التقارير المطبوعة
  SIGNATURE: {
    name: "Mohamed Sobhy",
    title: "Head of Budgeting & Financial Analysis",
  },

  // رابط النظام القديم
  OLD_SITE: "https://matco-attendance.streamlit.app/",
};
