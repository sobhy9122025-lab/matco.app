// =========================================================
// إعدادات الاتصال — عدّل السطرين دول بس
// =========================================================
// من Supabase: Project Settings ← Data API ← Project URL
// ومن Project Settings ← API Keys ← المفتاح العام (publishable / anon)
//
// ⚠️ حط هنا المفتاح العام (publishable أو anon) — مش المفتاح السري (secret / service_role).
//    المفتاح العام آمن يتحط في الصفحة، لأن الجداول مقفولة ومحدش يقدر يوصلها غير بعد تسجيل الدخول.
window.APP_CONFIG = {
  SUPABASE_URL: "https://owfxdflgxtebpaprkjvp.supabase.co",
  SUPABASE_KEY: "sb_publishable_SarQ9RCM2RMvvPc4_kmHUw__ZsULbmj",

  // لو المستخدم كتب اسم من غير @ (مثلًا a.salam) هيتحول لـ a.salam@matco.app
  LOGIN_DOMAIN: "matco.app",

  // رابط الموقع القديم (للصفحات اللي لسه ما اتنقلتش)
  OLD_SITE: "https://matco-attendance.streamlit.app/",
};
