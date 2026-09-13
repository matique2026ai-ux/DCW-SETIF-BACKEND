# DCW-SETIF-BACKEND — AGENTS.md

## الباك إند وخادم الواجهات لمديرية التجارة وترقية الصادرات - سطيف

> **المستودع (Backend)**: [DCW-SETIF-BACKEND](https://github.com/matique2026ai-ux/DCW-SETIF-BACKEND)  
> **المنصة السحابية**: Render.com Web Service (`https://drh-setif-api.onrender.com`)  
> **الرابط القصير**: `https://tinyurl.com/24ywuw53`  
> **نظام قاعدة البيانات**: Dual Mode (PostgreSQL على Render + SQL Server محلياً عبر ODBC)  
> **المنطقة الزمنية**: `Africa/Algiers` (توقيت الجزائر الرسمي UTC+1)

---

## 🔑 الحسابات وكلمات المرور الرسمية (Default Seed Users)

| المستخدم (Username) | كلمة المرور (Password) | الدور (Role) | المعرف (dbRole) | الوصف |
| :--- | :--- | :--- | :--- | :--- |
| `kriba` | `Agent@2024` | `inspector` | 4 | **مفتش رئيسي (كريبع كمال)** — مخصص للتجارب الحية الميدانية بالـ GPS |
| `agent` | `Agent@2024` | `inspector` | 4 | مفتش ميداني عام |
| `bureau_user` | `bureau123` | `bureau_chief` | 3 | **مكتب المستخدمين** — إدارة ومتابعة كافة الموظفين الـ 267 وتوزيع الفرق |
| `chef_bureau` | `Bureau@2024` | `bureau_chief` | 3 | رئيس مكتب المستخدمين |
| `directeur` | `directeur123` | `director` | 1 | **المدير الولائي** — لوحة القيادة وخريطة الأقمار الصناعية للبث المباشر |
| `chef_concurrence` | `chef123` | `head_of_department` | 2 | رئيس مصلحة المنافسة والتحقيقات الاقتصادية |
| `chef_consommation` | `chef123` | `head_of_department` | 2 | رئيس مصلحة حماية المستهلك وقمع الغش |
| `tracker_admin` | `admin123` | `admin` | 5 | مدير النظام الكامل |

---

## 📂 بنية الخادم ومسارات الواجهات (API Endpoints)

- **`POST /api/auth/login`**: تسجيل الدخول (غير حساس لحالة أحرف اسم المستخدم).
- **`GET /api/auth/me`**: التحقق من صحة الجلسة الحالية وتفاصيل المستخدم.
- **`POST /api/attendance/checkin`**: تسجيل حضور المفتش الميداني مع إحداثيات GPS الحية وتوقيت الجزائر.
- **`POST /api/attendance/checkout`**: تسجيل انصراف المفتش مع تفعيل حجب الموقع الجغرافي فوراً لحماية الخصوصية.
- **`GET /api/attendance/map-data`**: جلب بيانات خريطة التتبع المباشر (تخفي مواقع المنصرفين ما لم يكونوا في مناوبة ليلية).
- **`POST /api/visits`**: تسجيل زيارة رقابية ميدانية جديدة مع الموقع ونوع المحل التجاري.
- **`GET /api/visits`**: جلب الزيارات الميدانية.
- **`GET /api/employees`**: إدارة بيانات موظفي المديرية الـ 267 وحالاتهم والفرق.
- **`ALL /api/clean-test-data`**: تصفير وتطهير سجلات الحضور والمعاينات التجريبية استعداداً للعروض الحية أمام الإدارة.
- **`GET /app-release.apk` & `/download` & `/DCW-SETIF-TRACKER.apk`**: مسارات التحميل المباشر لحزمة تطبيق الأندرويد.
- **`GET /qr-code.png`**: صورة رمز الاستجابة السريعة للمنصة.
- **`/*`**: خدمة تطبيق Flutter Web كـ SPA متكامل.

---

## ⚙️ تشغيل الخادم محلياً
```bash
npm install
node server.js
```
