## ✅ Supabase مربوط

هذه النسخة مربوطة مسبقًا بمشروع Supabase الخاص بتحويشتي. الجداول والحماية RLS وBucket الإيصالات تم تجهيزها. لا تستخدم أي Secret/Service Role key داخل ملفات GitHub Pages.

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

## 2) Supabase — جاهز ✅

تم ربط هذه النسخة مسبقًا بمشروع Supabase الخاص بتحويشتي، وتم إنشاء:

- جدول `entries` للحركات
- جدول `payments` للدفعات
- حماية Row Level Security (RLS)
- Bucket خاص `receipts` للإيصالات حتى 5MB
- قيود تمنع تجاوز الدفعات لقيمة الدين

ملف `config.js` يحتوي فقط على **Publishable Key** المسموح استخدامه في تطبيق الويب. لا تضف `service_role` أو `sb_secret` إلى GitHub نهائيًا.

ملف `supabase/schema.sql` محفوظ فقط كنسخة من هيكل القاعدة إذا أردت نقل التطبيق إلى مشروع Supabase جديد لاحقًا.

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
