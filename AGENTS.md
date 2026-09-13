# DCW-SETIF-BACKEND — AGENTS.md

## الباك إند وخادم الواجهات لمديرية التجارة وترقية الصادرات - سطيف

> **المستودع (Backend)**: [DCW-SETIF-BACKEND](https://github.com/matique2026ai-ux/DCW-SETIF-BACKEND)  
> **المنصة السحابية**: Render.com Web Service (`https://drh-setif-api.onrender.com`)  
> **الرابط القصير**: `https://tinyurl.com/24ywuw53`  
> **نظام قاعدة البيانات**: Dual Mode (PostgreSQL على Render + SQL Server محلياً عبر ODBC)  

---

## 🔑 الحسابات وكلمات المرور الرسمية (Default Seed Users)

| المستخدم (Username) | كلمة المرور (Password) | الدور (Role) | المعرف (dbRole) |
| :--- | :--- | :--- | :--- |
| `agent` | `Agent@2024` | `inspector` | 4 |
| `chef_bureau` | `Bureau@2024` | `bureau_chief` | 3 |
| `directeur` | `directeur123` | `director` | 1 |
| `chef_concurrence` | `chef123` | `head_of_department` | 2 |
| `chef_consommation` | `chef123` | `head_of_department` | 2 |
| `tracker_admin` | `admin123` | `admin` | 5 |

---

## 📂 بنية الخادم ومسارات الواجهات (API Endpoints)

- **`POST /api/auth/login`**: تسجيل الدخول (غير حساس لحالة أحرف اسم المستخدم، كلمة المرور تبدأ بـ `Agent@2024`).
- **`GET /api/auth/me`**: التحقق من الجلسة الحالية.
- **`POST /api/attendance/checkin`**: تسجيل حضور المفتش (مع الموقع الجغرافي وصورة الإثبات).
- **`POST /api/attendance/checkout`**: تسجيل انصراف المفتش.
- **`POST /api/visits`**: تسجيل زيارة ميدانية جديدة.
- **`GET /api/visits`**: جلب زيارات المفتش اليومية أو التاريخية.
- **`GET /api/dashboard/map`**: جلب بيانات خريطة المراقبة الميدانية للمدير.
- **`GET /download/app-release.apk`**: تحميل مباشر لملف حزمة تطبيق الأندرويد.
- **`GET /qr-code.png`**: صورة رمز الاستجابة السريعة للمنصة.
- **`/*`**: خدمة تطبيق Flutter Web كـ SPA (Single Page Application).

---

## ⚙️ تشغيل الخادم محلياً
```bash
npm install
node server.js
```
