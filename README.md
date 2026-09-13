# تحويشتي — Tahweeshti

نسخة ويب/PWA مالية شخصية بتصميم عربي فاخر.

## الموجود في النسخة
- دخول برمز PIN من 4 أرقام فقط، بدون بريد إلكتروني.
- حساب واحد مشترك: نفس الرمز يفتح نفس البيانات من أي جهاز.
- مزامنة مركزية عبر Supabase Edge Function.
- إلي / عليّ / إيرادات / مصاريف / دفعات جزئية.
- إيصالات وصور حتى 5MB.
- نسخ احتياطي واسترجاع JSON.
- زر تثبيت كتطبيق PWA.
- عملة الدينار الأردني (د.أ).
- الحقوق: Yahya Saeed.

## التشغيل الحالي
الواجهة مهيأة مسبقًا للاتصال بالمشروع الموجود في `config.js` وبالـEdge Function `tahweeshti-api`.

## النشر
ارفع محتويات هذا المجلد إلى جذر مستودع GitHub. Railway المرتبط بالمستودع يعيد النشر تلقائيًا عند أي Commit جديد على `main`.

## الملفات الأساسية
- `index.html` الواجهة.
- `styles.css` التصميم والأنيميشن.
- `app.js` المنطق والمزامنة والـPIN.
- `config.js` إعداد الاتصال.
- `manifest.webmanifest` و`service-worker.js` لتثبيت التطبيق.
- `backend/schema_shared_pin.sql` مخطط قاعدة البيانات.
- `supabase/functions/tahweeshti-api/index.ts` مصدر الـEdge Function.

## ملاحظة أمان
لا تضع `SUPABASE_SERVICE_ROLE_KEY` داخل `config.js` أو أي ملف في الواجهة. المفتاح السري يبقى داخل بيئة Supabase Edge Function فقط.
