# 🏛️ DCW-SETIF-BACKEND — دليل الوكيل والمطور (AGENTS.md)
### الخادم الخلفي لمنصة الرقابة والتفتيش — مديرية التجارة لولاية سطيف

> **تاريخ آخر تحديث**: 14 سبتمبر 2026  
> **مستودع المشروع**: [DCW-SETIF-BACKEND](https://github.com/matique2026ai-ux/DCW-SETIF-BACKEND)  
> **رابط المنصة الحية (Render Web App)**: [dcw-setif-tracker.onrender.com](https://dcw-setif-tracker.onrender.com)  
> **المنصة السحابية (Render Backend API)**: `https://drh-setif-api.onrender.com/api`  
> **قاعدة البيانات**: PostgreSQL (Production على Render) + SQL Server / ODBC (Local)  
> **المنطقة الزمنية**: `Africa/Algiers` (UTC+1)

---

## 📌 المعايير الأمنية والمنطقية المطبقة
1. **صلاحيات صارمة (RBAC)**: فحص أدوار المستخدمين (`admin`, `director`, `head_of_department`, `bureau_chief`, `inspector`) مع كل طلب API.
2. **التوليد الجماعي لحسابات الموظفين الـ 267**: مسار `/api/auth/generate-accounts` لتوليد حسابات آمنة لجميع الموظفين المسجلين في جدول `Employes`.
3. **تشفير كلمات المرور بـ Bcrypt**: فحص التشفير وتحديث الهاش تلقائياً عند تغيير كلمة المرور.
4. **تكامل وتوافق أسماء الحقول**: توحيد معالجة الحقول مثل `NomAr`, `PrenomAr`, `Service`, `CheckInTime` عبر PostgreSQL و SQL Server.

---

## 🔑 الحسابات الافتراضية
* **Admin**: `tracker_admin` / `admin123` (Role 5)
* **Director**: `directeur` / `directeur123` (Role 1)
* **Heads of Service**: `chef_concurrence`, `chef_consommation` / `chef123` (Role 2)
* **Bureau Chief**: `bureau_user` / `bureau123` (Role 3)
* **Inspectors**: `kriba` / `Agent@2024` (Role 4)

---

## 🌐 بنية الاستضافة السحابية على Render

| الخدمة | النوع | الرابط الحي | المستودع | الوظيفة |
| :--- | :--- | :--- | :--- | :--- |
| **واجهة الويب (Web App)** | `Static Site` | `https://dcw-setif-tracker.onrender.com` | `DCW-SETIF-TRACKER` | تطبيق الويب المستضاف على CDN |
| **خادم الـ API** | `Web Service` | `https://drh-setif-api.onrender.com/api` | `DCW-SETIF-BACKEND` | خادم Node.js وقاعدة بيانات PostgreSQL |

