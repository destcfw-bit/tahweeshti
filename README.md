# تحويشتي 💚

تطبيق مالي شخصي عربي لإدارة:

- 💚 المبالغ **إلي** عند الناس
- 🔴 المبالغ **عليّ** للناس
- 📈 الإيرادات
- 📉 المصاريف
- 💳 الدفعات الجزئية والمتبقي
- 📸 صور الإيصالات والحوالات
- 🔎 البحث والفلاتر
- 💾 نسخة احتياطية واسترجاع
- 📱 PWA قابل للتثبيت كتطبيق

التصميم مهيأ لـ **GitHub Pages + Supabase**. إذا لم تضف Supabase بعد، يشتغل التطبيق بوضع تجريبي محلي ويحفظ البيانات في نفس المتصفح.

## 1) نشره على GitHub Pages

ارفع كل الملفات الموجودة في هذا المجلد إلى جذر Repository باسم `tahweeshti`.

يوجد Workflow جاهز في `.github/workflows/pages.yml`. بعد أول Push:

1. افتح Repository على GitHub.
2. ادخل **Settings → Pages**.
3. عند **Build and deployment** اختر **GitHub Actions** إذا لم يكن محددًا.
4. انتظر Workflow باسم **Deploy Tahweeshti to GitHub Pages** حتى يصبح أخضر.

الرابط غالبًا سيكون بالشكل:

`https://USERNAME.github.io/tahweeshti/`

## 2) إنشاء قاعدة Supabase

1. أنشئ Project جديد على Supabase.
2. افتح **SQL Editor**.
3. انسخ محتوى `supabase/schema.sql` كاملًا وشغله مرة واحدة.
4. من **Project Settings → API** انسخ:
   - Project URL
   - anon / publishable key
5. افتح `config.js` وضعهما مكان القيم الافتراضية.

> مهم: استخدم `anon` / `publishable key` فقط في الموقع. **لا تضع service_role key في GitHub أو المتصفح.** الحماية الفعلية تتم عبر RLS الموجود في `schema.sql`.

## 3) تسجيل الدخول

التطبيق يستخدم Supabase Auth بالبريد الإلكتروني وكلمة المرور. إذا كان Email Confirmation مفعّلًا في Supabase، المستخدم يؤكد بريده أول مرة.

## الملفات الأساسية

- `index.html` — الواجهة
- `styles.css` — التصميم والأنميشن
- `app.js` — منطق البرنامج وربط Supabase
- `config.js` — إعدادات Supabase
- `supabase/schema.sql` — قاعدة البيانات + RLS + Storage
- `manifest.webmanifest` + `service-worker.js` — تثبيت التطبيق/PWA
- `assets/logo.png` — لوغو تحويشتي المعتمد

## العملة

كل المبالغ تعرض بالدينار الأردني `د.أ` وتدعم حتى 3 منازل عشرية.
