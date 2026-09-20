process.env.TZ = 'Africa/Algiers';

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection, isPostgres } = require('./src/config/database');
const { getTodayAlgeria, getNowAlgeriaIso } = require('./src/utils/dateUtils');

const authRoutes = require('./src/routes/auth');
const employeeRoutes = require('./src/routes/employees');
const programRoutes = require('./src/routes/programs');
const attendanceRoutes = require('./src/routes/attendance');
const dashboardRoutes = require('./src/routes/dashboard');
const visitRoutes = require('./src/routes/visits');
const deductionRoutes = require('./src/routes/deductions');
const justificationRoutes = require('./src/routes/justifications');
const inquiryRoutes = require('./src/routes/inquiries');
const settingRoutes = require('./src/routes/settings');
const meansRoutes = require('./src/routes/means');

const app = express();
const PORT = process.env.PORT || 8080;

const path = require('path');
const fs = require('fs');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files (Flutter Web + downloads) with zero-cache headers
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Direct change-password endpoint fallback
app.post(['/api/auth/change-password', '/api/change-password'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let decoded = {};
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');
      } catch (_) {}
    }

    const currentPassword = (req.body.currentPassword || '').trim();
    const newPassword = (req.body.newPassword || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية والجديدة' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور الجديدة عن 4 أحرف أو أرقام' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const users = await db.query(
      pg
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE ("Id" = $1 OR LOWER(TRIM("NomUtilisateur")) = LOWER(TRIM($2))) AND "EstActif" = true'
        : 'SELECT * FROM UtilisateursSysteme WHERE (Id = ? OR LOWER(LTRIM(RTRIM(NomUtilisateur))) = LOWER(LTRIM(RTRIM(?)))) AND EstActif = 1',
      [decoded.id || 0, decoded.username || '']
    );

    if (!users || users.length === 0) {
      const emps = await db.query(
        pg
          ? 'SELECT * FROM "Employes" WHERE "Id" = $1 OR LOWER("Nom") = LOWER($2)'
          : 'SELECT * FROM Employes WHERE Id = ? OR LOWER(Nom) = LOWER(?)',
        [decoded.employeeId || decoded.id || 0, decoded.username || '']
      );
      if (emps && emps.length > 0) {
        const emp = emps[0];
        const newHash = await bcrypt.hash(newPassword, 10);
        await db.query(
          pg
            ? 'INSERT INTO "UtilisateursSysteme" ("NomUtilisateur", "MotDePasseHash", "NomComplet", "Role", "EstActif", "EmployeeId") VALUES ($1, $2, $3, 4, true, $4)'
            : 'INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, EmployeeId) VALUES (?, ?, ?, 4, 1, ?)',
          [decoded.username || `emp.${emp.Id || emp.id}`, newHash, `${emp.NomAr || emp.Nom} ${emp.PrenomAr || emp.Prenom}`.trim(), emp.Id || emp.id]
        );
        return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح ✅' });
      }
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = users[0];
    const existingHash = user.MotDePasseHash || user.motdepassehash || user.MotDePasse || user.motdepasse || '';
    const userId = user.Id !== undefined ? user.Id : (user.id !== undefined ? user.id : decoded.id);

    let valid = false;
    try {
      valid = await bcrypt.compare(currentPassword, existingHash);
    } catch {
      valid = false;
    }

    if (!valid && (existingHash === currentPassword || existingHash === '' || existingHash === 'chef123' || existingHash === 'admin123' || existingHash === 'directeur123' || existingHash === 'bureau123')) {
      valid = true;
    }

    if (!valid) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن كلمة المرور الحالية' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      pg
        ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash" = $1 WHERE "Id" = $2'
        : 'UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?',
      [newHash, userId]
    );

    res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح ✅',
    });
  } catch (err) {
    console.error('Change password direct error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم أثناء تغيير كلمة المرور' });
  }
});

// ROLE_MAP constant for user queries
const ROLE_MAP = {
  1: 'director',
  2: 'head_of_department',
  3: 'bureau_chief',
  4: 'inspector',
  5: 'admin',
};

// Direct GET Users Handler (Avoids wildcard interceptors)
app.get(['/api/auth/users', '/api/users'], async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const query = pg
      ? `SELECT u."Id", u."NomUtilisateur", u."NomComplet", u."Role", u."EstActif", u."DateCreation", u."DerniereConnexion", u."EmployeeId",
                e."Nom" as "EmpNom", e."Prenom" as "EmpPrenom", e."Service" as "EmpService", e."Grade" as "EmpGrade"
         FROM "UtilisateursSysteme" u
         LEFT JOIN "Employes" e ON u."EmployeeId" = e."Id"
         ORDER BY u."Id" ASC`
      : `SELECT u.Id, u.NomUtilisateur, u.NomComplet, u.Role, u.EstActif, u.DateCreation, u.DerniereConnexion, u.EmployeeId,
                e.Nom as EmpNom, e.Prenom as EmpPrenom, e.Service as EmpService, e.Grade as EmpGrade
         FROM UtilisateursSysteme u
         LEFT JOIN Employes e ON u.EmployeeId = e.Id
         ORDER BY u.Id ASC`;

    const users = await db.query(query);
    const result = users.map((u) => ({
      id: u.Id || u.id,
      username: u.NomUtilisateur || u.nomutilisateur,
      fullName: u.NomComplet || u.nomcomplet,
      role: ROLE_MAP[u.Role !== undefined ? u.Role : u.role] || 'inspector',
      roleId: u.Role !== undefined ? u.Role : u.role,
      isActive: (u.EstActif !== undefined ? u.EstActif : u.estactif) === true || (u.EstActif || u.estactif) === 1,
      createdAt: u.DateCreation || u.datecreation,
      lastLogin: u.DerniereConnexion || u.derniereconnexion,
      employeeId: u.EmployeeId || u.employeeid,
      empNom: u.EmpNom || u.empnom,
      empPrenom: u.EmpPrenom || u.empprenom,
      empService: u.EmpService || u.empservice,
      empGrade: u.EmpGrade || u.empgrade,
    }));

    res.json(result);
  } catch (err) {
    console.error('Fetch users direct error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب قائمة المستخدمين' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/attendance', attendanceRoutes);

// Direct User Deletion Endpoint Handler
app.delete(['/api/auth/users/:id', '/api/users/:id'], async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'معرف المستخدم غير صحيح' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    // Check target user
    const users = await db.query(
      pg
        ? 'SELECT "Id", "NomUtilisateur" FROM "UtilisateursSysteme" WHERE "Id" = $1'
        : 'SELECT Id, NomUtilisateur FROM UtilisateursSysteme WHERE Id = ?',
      [userId]
    );

    if (users && users.length > 0) {
      const username = (users[0].NomUtilisateur || users[0].nomutilisateur || '').toLowerCase();
      if (username === 'tracker_admin') {
        return res.status(400).json({ error: 'لا يمكن حذف الحساب الرئيسي لمدير النظام' });
      }
    }

    // Perform deletion safely
    const deleteQuery = pg
      ? 'DELETE FROM "UtilisateursSysteme" WHERE "Id" = $1'
      : 'DELETE FROM UtilisateursSysteme WHERE Id = ?';

    await db.query(deleteQuery, [userId]);

    res.json({ success: true, message: 'تم حذف الحساب نهائياً بنجاح ✅' });
  } catch (err) {
    console.error('Delete user direct error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء حذف الحساب: ' + err.message });
  }
});

// Direct User Update Handler (Supports PUT & POST for user details, role, and active/suspended status)
app.put(['/api/auth/users/:id', '/api/users/:id', '/api/auth/users/:id/update', '/api/users/:id/update'], async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'معرف المستخدم غير صحيح' });
    }
    const { fullName, role, isActive, employeeId } = req.body;
    const db = await getConnection();
    const pg = isPostgres();

    const REVERSE_ROLE_MAP = {
      director: 1,
      head_of_department: 2,
      bureau_chief: 3,
      inspector: 4,
      admin: 5,
    };
    const dbRole = typeof role === 'number' ? role : (REVERSE_ROLE_MAP[role] || 4);
    const activeVal = isActive === true || isActive === 1;

    const updateQuery = pg
      ? `UPDATE "UtilisateursSysteme"
         SET "NomComplet" = $1, "Role" = $2, "EstActif" = $3, "EmployeeId" = $4
         WHERE "Id" = $5 OR "EmployeeId" = $5`
      : `UPDATE UtilisateursSysteme
         SET NomComplet = ?, Role = ?, EstActif = ?, EmployeeId = ?
         WHERE Id = ? OR EmployeeId = ?`;

    await db.query(updateQuery, pg ? [fullName, dbRole, activeVal, employeeId || null, userId] : [fullName, dbRole, activeVal, employeeId || null, userId, userId]);

    res.json({ success: true, message: 'تم تحديث بيانات وتجميد/تفعيل الحساب بنجاح ✅' });
  } catch (err) {
    console.error('Update user direct error:', err.message);
    res.status(500).json({ error: 'خطأ في تحديث بيانات الحساب: ' + err.message });
  }
});

// Direct Password Reset Endpoint Handler
app.all(['/api/auth/users/:id/reset-password', '/api/users/:id/reset-password'], async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 4) {
      return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور الجديدة عن 4 أحرف' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const hash = await bcrypt.hash(newPassword.trim(), 10);

    const updateQuery = pg
      ? `UPDATE "UtilisateursSysteme" SET "MotDePasseHash" = $1 WHERE "Id" = $2 OR "EmployeeId" = $2`
      : `UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ? OR EmployeeId = ?`;

    await db.query(updateQuery, pg ? [hash, userId] : [hash, userId, userId]);

    res.json({ success: true, message: 'تم إعادة تعيين كلمة المرور بنجاح ✅' });
  } catch (err) {
    console.error('Reset password direct error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء إعادة تعيين كلمة المرور: ' + err.message });
  }
});

// Direct Device Reset Endpoint Handler (Unbind device from inspector)
app.all(['/api/auth/users/:id/reset-device', '/api/users/:id/reset-device'], async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const db = await getConnection();
    const pg = isPostgres();

    const updateQuery = pg
      ? `UPDATE "UtilisateursSysteme" SET "DeviceId" = NULL, "DeviceName" = NULL WHERE "Id" = $1 OR "EmployeeId" = $1`
      : `UPDATE UtilisateursSysteme SET DeviceId = NULL, DeviceName = NULL WHERE Id = ? OR EmployeeId = ?`;

    await db.query(updateQuery, pg ? [userId] : [userId, userId]);

    res.json({ success: true, message: 'تم فك اقتران الهاتف بالبصمة الرقمية بنجاح ✅' });
  } catch (err) {
    console.error('Reset device direct error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء إعادة تعيين جهاز المستخدم: ' + err.message });
  }
});

// Direct endpoint fallback for cancel-checkout
app.post('/api/attendance/cancel-checkout', async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'رقم الموظف مطلوب' });
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();
    await db.query(
      pg
        ? `UPDATE "TrackerAttendance" SET "IsCheckedOut"=false, "CheckOutTime"=NULL WHERE "EmployeeId"=$1 AND "Date"=$2`
        : `UPDATE TrackerAttendance SET IsCheckedOut=0, CheckOutTime=NULL WHERE EmployeeId=? AND Date=?`,
      [employeeId, today]
    );
    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );
    res.json(result[0] || { success: true });
  } catch (err) {
    console.error('Direct cancel checkout error:', err.message);
    res.status(500).json({ error: 'خطأ في استئناف الدوام' });
  }
});

// Direct endpoints for program cancellation
app.delete('/api/programs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getConnection();
    const pg = isPostgres();
    const numId = parseInt(id, 10);
    if (!isNaN(numId) && numId > 0) {
      await db.query(pg ? 'DELETE FROM "TrackerPrograms" WHERE "Id" = $1' : 'DELETE FROM TrackerPrograms WHERE Id = ?', [numId]);
    } else {
      await db.query(pg ? 'DELETE FROM "TrackerPrograms" WHERE "Title" = $1' : 'DELETE FROM TrackerPrograms WHERE Title = ?', [decodeURIComponent(id)]);
    }
    res.json({ success: true, message: 'تم إلغاء أمر المهمة بنجاح ✅' });
  } catch (err) {
    console.error('Direct cancel program error:', err.message);
    res.status(500).json({ error: 'خطأ في إلغاء أمر المهمة: ' + err.message });
  }
});

app.post('/api/programs/cancel', async (req, res) => {
  try {
    const { id, title } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    const numId = parseInt(id, 10);
    if (!isNaN(numId) && numId > 0) {
      await db.query(pg ? 'DELETE FROM "TrackerPrograms" WHERE "Id" = $1' : 'DELETE FROM TrackerPrograms WHERE Id = ?', [numId]);
    } else if (title) {
      await db.query(pg ? 'DELETE FROM "TrackerPrograms" WHERE "Title" = $1' : 'DELETE FROM TrackerPrograms WHERE Title = ?', [title]);
    }
    res.json({ success: true, message: 'تم إلغاء أمر المهمة بنجاح ✅' });
  } catch (err) {
    console.error('Direct cancel program POST error:', err.message);
    res.status(500).json({ error: 'خطأ في إلغاء أمر المهمة: ' + err.message });
  }
});
// Direct Analytics Endpoint
app.get('/api/dashboard/analytics', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { date, startDate, endDate } = req.query;
    const today = getTodayAlgeria();
    const queryDate = date || today;

    const TARGET_DEPARTMENTS = [
      'مصلحة المنافسة والتحقيقات الاقتصادية',
      'مصلحة حماية المستهلك وقمع الغش',
    ];

    const allEmployees = await db.query(
      pg
        ? `SELECT "Id","Nom","Prenom","NomAr","PrenomAr","Service","Grade","Bureau","Structure" FROM "Employes" WHERE "EstActif" = true`
        : 'SELECT Id,Nom,Prenom,NomAr,PrenomAr,Service,Grade,Bureau,Structure FROM Employes WHERE EstActif = 1'
    );

    const targetEmployees = allEmployees.filter(e => {
      const s = (e.Service || e.service || '').toString();
      return s && TARGET_DEPARTMENTS.some(d => s.includes(d));
    });

    const targetIds = targetEmployees.map(e => e.Id || e.id).filter(Boolean);

    let presentCount = 0;
    let checkedOutCount = 0;
    if (targetIds.length > 0) {
      const presentRes = await db.query(
        pg
          ? `SELECT COUNT(DISTINCT "EmployeeId") as count FROM "TrackerAttendance" WHERE "Date" = $1 AND "EmployeeId" = ANY($2)`
          : `SELECT COUNT(DISTINCT EmployeeId) as count FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (${targetIds.join(',')})`,
        pg ? [queryDate, targetIds] : [queryDate]
      );
      const checkedOutRes = await db.query(
        pg
          ? `SELECT COUNT(DISTINCT "EmployeeId") as count FROM "TrackerAttendance" WHERE "Date" = $1 AND "EmployeeId" = ANY($2) AND "IsCheckedOut" = true`
          : `SELECT COUNT(DISTINCT EmployeeId) as count FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (${targetIds.join(',')}) AND IsCheckedOut = 1`,
        pg ? [queryDate, targetIds] : [queryDate]
      );
      presentCount = parseInt(presentRes[0]?.count || presentRes[0]?.COUNT || 0, 10);
      checkedOutCount = parseInt(checkedOutRes[0]?.count || checkedOutRes[0]?.COUNT || 0, 10);
    }

    let visitParams = [queryDate];
    let dateCondition = pg ? `tv."Date" = $1` : `tv.Date = ?`;
    if (startDate && endDate) {
      visitParams = [startDate, endDate];
      dateCondition = pg ? `tv."Date" >= $1 AND tv."Date" <= $2` : `tv.Date >= ? AND tv.Date <= ?`;
    }

    const visitsQuery = pg
      ? `SELECT tv.*, e."NomAr", e."PrenomAr", e."Nom", e."Prenom", e."Service", e."Grade"
         FROM "TrackerVisits" tv
         LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
         WHERE ${dateCondition}
         ORDER BY tv."CheckInTime" DESC`
      : `SELECT tv.*, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service, e.Grade
         FROM TrackerVisits tv
         LEFT JOIN Employes e ON tv.EmployeeId = e.Id
         WHERE ${dateCondition}
         ORDER BY tv.CheckInTime DESC`;

    const visitsResult = await db.query(visitsQuery, visitParams);
    const visits = visitsResult || [];

    const cumulativeQuery = pg
      ? `SELECT 
           COUNT(*) as total_cumulative_visits,
           COUNT(CASE WHEN "ViolationFound" = true THEN 1 END) as cumulative_violations,
           COALESCE(SUM("SeizureValue"), 0) as cumulative_seizures_value,
           COUNT(CASE WHEN "LegalAction" LIKE '%غلق%' OR "ViolationNotes" LIKE '%غلق%' THEN 1 END) as cumulative_closures,
           COUNT(CASE WHEN "LegalAction" LIKE '%عين%' OR "ViolationNotes" LIKE '%عين%' THEN 1 END) as cumulative_samples,
           COUNT(CASE WHEN "LegalAction" LIKE '%محضر%' OR "ViolationNotes" LIKE '%محضر%' THEN 1 END) as cumulative_court_referrals
         FROM "TrackerVisits"`
      : `SELECT 
           COUNT(*) as total_cumulative_visits,
           SUM(CASE WHEN ViolationFound = 1 THEN 1 ELSE 0 END) as cumulative_violations,
           ISNULL(SUM(SeizureValue), 0) as cumulative_seizures_value,
           SUM(CASE WHEN LegalAction LIKE '%غلق%' OR ViolationNotes LIKE '%غلق%' THEN 1 ELSE 0 END) as cumulative_closures,
           SUM(CASE WHEN LegalAction LIKE '%عين%' OR ViolationNotes LIKE '%عين%' THEN 1 ELSE 0 END) as cumulative_samples,
           SUM(CASE WHEN LegalAction LIKE '%محضر%' OR ViolationNotes LIKE '%محضر%' THEN 1 ELSE 0 END) as cumulative_court_referrals
         FROM TrackerVisits`;

    const cumResult = await db.query(cumulativeQuery);
    const cumRow = cumResult[0] || {};

    let totalVisits = visits.length;
    let violationsCount = 0;
    let totalSeizureValue = 0;
    let seizuresCount = 0;
    let approvedCount = 0;
    let closureProposalsCount = 0;
    let samplesCount = 0;
    let courtReferralsCount = 0;

    const deptStats = {
      fraudRepression: {
        name: 'مصلحة حماية المستهلك وقمع الغش',
        visits: 0,
        violations: 0,
        seizuresValue: 0,
        samples: 0,
        closures: 0,
      },
      competition: {
        name: 'مصلحة المنافسة والتحقيقات الاقتصادية',
        visits: 0,
        violations: 0,
        seizuresValue: 0,
        courtReferrals: 0,
        closures: 0,
      },
    };

    const inspectorBreakdown = {};

    visits.forEach(v => {
      const isViol = v.ViolationFound === true || v.violationfound === true || v.ViolationFound == 1;
      const sVal = parseFloat(v.SeizureValue || v.seizurevalue || 0) || 0;
      const isAppr = v.IsApproved === true || v.isapproved === true || v.IsApproved == 1;
      const lAction = (v.LegalAction || v.legalaction || '').toString();
      const vNotes = (v.ViolationNotes || v.violationnotes || '').toString();
      const fullNotes = `${lAction} ${vNotes}`;

      if (isViol) violationsCount++;
      if (sVal > 0) {
        totalSeizureValue += sVal;
        seizuresCount++;
      }
      if (isAppr) approvedCount++;
      if (fullNotes.includes('غلق') || fullNotes.includes('إغلاق')) closureProposalsCount++;
      if (fullNotes.includes('عين') || fullNotes.includes('تحليل') || fullNotes.includes('مخبر')) samplesCount++;
      if (fullNotes.includes('محضر') || fullNotes.includes('متابعة') || fullNotes.includes('عدالة')) courtReferralsCount++;

      const srv = (v.Service || v.service || '').toString();
      if (srv.includes('قمع الغش') || srv.includes('المستهلك')) {
        deptStats.fraudRepression.visits++;
        if (isViol) deptStats.fraudRepression.violations++;
        deptStats.fraudRepression.seizuresValue += sVal;
        if (fullNotes.includes('عين') || fullNotes.includes('تحليل')) deptStats.fraudRepression.samples++;
        if (fullNotes.includes('غلق')) deptStats.fraudRepression.closures++;
      } else if (srv.includes('المنافسة') || srv.includes('التحقيقات')) {
        deptStats.competition.visits++;
        if (isViol) deptStats.competition.violations++;
        deptStats.competition.seizuresValue += sVal;
        if (fullNotes.includes('محضر')) deptStats.competition.courtReferrals++;
        if (fullNotes.includes('غلق')) deptStats.competition.closures++;
      }

      const empId = v.EmployeeId || v.employeeid;
      const empName = (v.NomAr || v.nomar) ? `${v.NomAr || v.nomar} ${v.PrenomAr || v.prenomar || ''}`.trim() : `مفتش #${empId}`;
      if (!inspectorBreakdown[empId]) {
        inspectorBreakdown[empId] = {
          employeeId: empId,
          name: empName,
          service: srv,
          visitsCount: 0,
          violationsCount: 0,
          seizuresValue: 0,
        };
      }
      inspectorBreakdown[empId].visitsCount++;
      if (isViol) inspectorBreakdown[empId].violationsCount++;
      inspectorBreakdown[empId].seizuresValue += sVal;
    });

    const activeProgramsCount = await db.query(
      pg ? `SELECT COUNT(*) as count FROM "TrackerPrograms"` : `SELECT COUNT(*) as count FROM TrackerPrograms`
    );

    res.json({
      selectedDate: queryDate,
      attendance: {
        totalInspectors: targetIds.length,
        presentToday: presentCount,
        checkedOutToday: checkedOutCount,
        absentToday: Math.max(0, targetIds.length - presentCount),
        readinessRate: targetIds.length > 0 ? ((presentCount / targetIds.length) * 100).toFixed(1) : '0',
      },
      todayInspections: {
        totalVisits,
        violationsCount,
        seizuresCount,
        totalSeizureValue,
        approvedCount,
        closureProposalsCount,
        samplesCount,
        courtReferralsCount,
        complianceRate: totalVisits > 0 ? (((totalVisits - violationsCount) / totalVisits) * 100).toFixed(1) : '100',
      },
      cumulativeTotals: {
        totalVisits: parseInt(cumRow.total_cumulative_visits || cumRow.TOTAL_CUMULATIVE_VISITS || 0, 10),
        violationsCount: parseInt(cumRow.cumulative_violations || cumRow.CUMULATIVE_VIOLATIONS || 0, 10),
        totalSeizureValue: parseFloat(cumRow.cumulative_seizures_value || cumRow.CUMULATIVE_SEIZURES_VALUE || 0),
        closureProposalsCount: parseInt(cumRow.cumulative_closures || cumRow.CUMULATIVE_CLOSURES || 0, 10),
        samplesCount: parseInt(cumRow.cumulative_samples || cumRow.CUMULATIVE_SAMPLES || 0, 10),
        courtReferralsCount: parseInt(cumRow.cumulative_court_referrals || cumRow.CUMULATIVE_COURT_REFERRALS || 0, 10),
      },
      departmentBreakdown: deptStats,
      topInspectors: Object.values(inspectorBreakdown).sort((a, b) => b.visitsCount - a.visitsCount).slice(0, 5),
      recentVisits: visits.slice(0, 15),
      activeProgramsCount: parseInt(activeProgramsCount[0]?.count || activeProgramsCount[0]?.COUNT || 0, 10),
    });
  } catch (err) {
    console.error('Direct analytics error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب التحليلات الرقابية: ' + err.message });
  }
});

// ─── FULL ARCHIVAL STATISTICS REPORT ─────────────────────────────────────────
// GET /api/reports/inspection-summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Used by Director's dashboard to generate strategic PDF reports
app.get(['/api/reports/inspection-summary', '/api/inspection-summary'], async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();
    const { startDate, endDate, service } = req.query;

    const sDate = startDate || today;
    const eDate = endDate || today;

    // ── 1. All visits in range with GPS + approval + inspector info
    const visits = await db.query(
      pg
        ? `SELECT tv."Id", tv."EmployeeId", tv."Date", tv."CheckInTime", tv."CheckOutTime",
                  tv."Latitude", tv."Longitude", tv."Accuracy", tv."LocationName",
                  tv."ShopName", tv."ShopType", tv."ViolationFound", tv."ViolationType",
                  tv."ViolationNotes", tv."LegalAction", tv."SeizureValue",
                  tv."IsApproved", tv."ApprovedBy", tv."ApprovedAt",
                  tv."Notes", tv."Photo",
                  e."NomAr", e."PrenomAr", e."Nom", e."Prenom",
                  e."Service", e."Grade", e."NumeroMatricule"
           FROM "TrackerVisits" tv
           LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
           WHERE tv."Date" >= $1 AND tv."Date" <= $2
           ${service ? 'AND e."Service" ILIKE $3' : ''}
           ORDER BY tv."Date" DESC, tv."CheckInTime" DESC`
        : `SELECT tv.*,e.NomAr,e.PrenomAr,e.Nom,e.Prenom,e.Service,e.Grade,e.NumeroMatricule
           FROM TrackerVisits tv
           LEFT JOIN Employes e ON tv.EmployeeId = e.Id
           WHERE tv.Date >= ? AND tv.Date <= ?
           ORDER BY tv.Date DESC, tv.CheckInTime DESC`,
      service ? [sDate, eDate, `%${service}%`] : [sDate, eDate]
    );

    // ── 2. Attendance in range with GPS traces
    const attendance = await db.query(
      pg
        ? `SELECT ta."Id", ta."EmployeeId", ta."Date",
                  ta."CheckInTime", ta."CheckOutTime",
                  ta."CheckInLatitude", ta."CheckInLongitude",
                  ta."CheckOutLatitude", ta."CheckOutLongitude",
                  ta."CheckInLocation", ta."CheckOutLocation",
                  ta."IsCheckedOut", ta."IsWithinGeofence",
                  ta."EarlyReason", ta."LateMinutes",
                  e."NomAr", e."PrenomAr", e."Nom", e."Prenom",
                  e."Service", e."NumeroMatricule"
           FROM "TrackerAttendance" ta
           LEFT JOIN "Employes" e ON ta."EmployeeId" = e."Id"
           WHERE ta."Date" >= $1 AND ta."Date" <= $2
           ORDER BY ta."Date" DESC, ta."CheckInTime" DESC`
        : `SELECT ta.*,e.NomAr,e.PrenomAr,e.Nom,e.Prenom,e.Service,e.NumeroMatricule
           FROM TrackerAttendance ta
           LEFT JOIN Employes e ON ta.EmployeeId = e.Id
           WHERE ta.Date >= ? AND ta.Date <= ?
           ORDER BY ta.Date DESC, ta.CheckInTime DESC`,
      [sDate, eDate]
    );

    // ── 3. Per-inspector aggregation
    const inspectorMap = {};
    for (const v of visits) {
      const empId = v.EmployeeId || v.employeeid;
      const nomAr = v.NomAr || v.nomar || v.nomarr || '';
      const prenomAr = v.PrenomAr || v.prenomar || v.prenomarr || '';
      const nom = v.Nom || v.nom || '';
      const prenom = v.Prenom || v.prenom || '';
      const service_ = v.Service || v.service || 'غير محدد';
      const grade = v.Grade || v.grade || '';
      const mat = v.NumeroMatricule || v.numeromatricule || '';
      const isViol = v.ViolationFound === true || v.violationfound === true;
      const sVal = parseFloat(v.SeizureValue || v.seizurevalue || 0) || 0;
      const isApproved = v.IsApproved === true || v.isapproved === true;

      if (!inspectorMap[empId]) {
        const fullArName = `${nomAr} ${prenomAr}`.trim();
        const fullFrName = `${nom} ${prenom}`.trim();
        inspectorMap[empId] = {
          employeeId: empId,
          name: fullArName.length > 0 ? fullArName : (fullFrName.length > 0 ? fullFrName : `مفتش #${empId}`),
          matricule: mat,
          grade,
          service: service_,
          visitsCount: 0,
          violationsCount: 0,
          totalSeizureValue: 0,
          approvedVisits: 0,
          pendingVisits: 0,
          gpsTraces: [],
        };
      }

      const insp = inspectorMap[empId];
      insp.visitsCount++;
      if (isViol) insp.violationsCount++;
      insp.totalSeizureValue += sVal;
      if (isApproved) insp.approvedVisits++;
      else insp.pendingVisits++;

      // GPS trace archive
      const lat = v.Latitude || v.latitude;
      const lng = v.Longitude || v.longitude;
      if (lat && lng) {
        insp.gpsTraces.push({
          date: v.Date || v.date,
          time: v.CheckInTime || v.checkintime,
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
          location: v.LocationName || v.locationname || '',
          shopName: v.ShopName || v.shopname || '',
          hasViolation: isViol,
          seizureValue: sVal,
          isApproved,
        });
      }
    }

    // ── 4. Per-department aggregation
    const deptMap = {};
    for (const v of visits) {
      const dept = v.Service || v.service || 'غير محدد';
      const isViol = v.ViolationFound === true || v.violationfound === true;
      const sVal = parseFloat(v.SeizureValue || v.seizurevalue || 0) || 0;
      const isApproved = v.IsApproved === true || v.isapproved === true;

      if (!deptMap[dept]) {
        deptMap[dept] = {
          service: dept,
          visitsCount: 0,
          violationsCount: 0,
          seizureValue: 0,
          approvedCount: 0,
          inspectorCount: new Set(),
        };
      }
      deptMap[dept].visitsCount++;
      if (isViol) deptMap[dept].violationsCount++;
      deptMap[dept].seizureValue += sVal;
      if (isApproved) deptMap[dept].approvedCount++;
      const empId2 = v.EmployeeId || v.employeeid;
      if (empId2) deptMap[dept].inspectorCount.add(empId2);
    }
    // Convert Set to count
    for (const k of Object.keys(deptMap)) {
      deptMap[k].inspectorCount = deptMap[k].inspectorCount.size;
    }

    // ── 5. Daily trend (visits per day)
    const dailyMap = {};
    for (const v of visits) {
      const d = (v.Date || v.date || '').toString().substring(0, 10);
      if (!dailyMap[d]) dailyMap[d] = { date: d, visits: 0, violations: 0, seizureValue: 0, approved: 0 };
      dailyMap[d].visits++;
      if (v.ViolationFound === true || v.violationfound === true) dailyMap[d].violations++;
      dailyMap[d].seizureValue += parseFloat(v.SeizureValue || v.seizurevalue || 0) || 0;
      if (v.IsApproved === true || v.isapproved === true) dailyMap[d].approved++;
    }

    // ── 6. Attendance GPS archive (daily presence with coordinates)
    const attendanceGPS = attendance.map(a => {
      const nAr = (a.NomAr || a.nomar || a.nomarr || '').trim();
      const pAr = (a.PrenomAr || a.prenomar || a.prenomarr || '').trim();
      const nFr = (a.Nom || a.nom || '').trim();
      const pFr = (a.Prenom || a.prenom || '').trim();
      const arName = `${nAr} ${pAr}`.trim();
      const frName = `${nFr} ${pFr}`.trim();
      return {
        employeeId: a.EmployeeId || a.employeeid,
        name: arName.length > 0 ? arName : (frName.length > 0 ? frName : `موظف #${a.EmployeeId || a.employeeid}`),
        matricule: a.NumeroMatricule || a.numeromatricule || '',
        service: a.Service || a.service || '',
        date: a.Date || a.date,
        checkInTime: a.CheckInTime || a.checkintime,
        checkOutTime: a.CheckOutTime || a.checkouttime,
        checkInLatitude: parseFloat(a.CheckInLatitude || a.checkinlatitude || 0) || null,
        checkInLongitude: parseFloat(a.CheckInLongitude || a.checkinlongitude || 0) || null,
        checkOutLatitude: parseFloat(a.CheckOutLatitude || a.checkoutlatitude || 0) || null,
        checkOutLongitude: parseFloat(a.CheckOutLongitude || a.checkoutlongitude || 0) || null,
        checkInLocation: a.CheckInLocation || a.checkinlocation || '',
        checkOutLocation: a.CheckOutLocation || a.checkoutlocation || '',
        isWithinGeofence: a.IsWithinGeofence === true || a.iswithingeofence === true,
        lateMinutes: a.LateMinutes || a.lateminutes || 0,
        earlyReason: a.EarlyReason || a.earlyreason || null,
      };
    });

    // ── 7. Global totals
    const totalVisits = visits.length;
    const totalViolations = visits.filter(v => v.ViolationFound === true || v.violationfound === true).length;
    const totalSeizure = visits.reduce((s, v) => s + (parseFloat(v.SeizureValue || v.seizurevalue || 0) || 0), 0);
    const totalApproved = visits.filter(v => v.IsApproved === true || v.isapproved === true).length;
    const violationRate = totalVisits > 0 ? Math.round((totalViolations / totalVisits) * 100) : 0;
    const approvalRate = totalVisits > 0 ? Math.round((totalApproved / totalVisits) * 100) : 0;

    res.json({
      meta: {
        generatedAt: getNowAlgeriaIso(),
        generatedBy: 'DCW-SETIF-TRACKER API v3.2',
        reportTitle: 'تقرير الإحصائيات الرقابية الشامل — مديرية التجارة سطيف',
        periodStart: sDate,
        periodEnd: eDate,
        daysCount: Math.max(1, Math.round((new Date(eDate) - new Date(sDate)) / 86400000) + 1),
      },
      summary: {
        totalVisits,
        totalViolations,
        violationRate,
        totalSeizureValueDZD: Math.round(totalSeizure * 100) / 100,
        totalApproved,
        approvalRate,
        totalInspectors: Object.keys(inspectorMap).length,
        totalAttendanceDays: attendance.length,
      },
      inspectorBreakdown: Object.values(inspectorMap).sort((a, b) => b.visitsCount - a.visitsCount),
      departmentBreakdown: Object.values(deptMap),
      dailyTrend: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
      attendanceGPSArchive: attendanceGPS,
      allVisits: visits,
    });
  } catch (err) {
    console.error('Inspection summary report error:', err.message);
    res.status(500).json({ error: 'خطأ في توليد تقرير الإحصاء الشامل: ' + err.message });
  }
});


app.all(['/api/visits/:id/approve', '/api/visits/:id/vise'], async (req, res) => {
  try {
    const { approvedBy } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    const numId = parseInt(req.params.id, 10);
    await db.query(
      pg
        ? `UPDATE "TrackerVisits" SET "IsApproved"=true, "ApprovedBy"=$1, "ApprovedAt"=NOW() WHERE "Id"=$2`
        : `UPDATE TrackerVisits SET IsApproved=1, ApprovedBy=?, ApprovedAt=GETDATE() WHERE Id=?`,
      [approvedBy || 'المدير الولائي للتجارة', numId]
    );
    const result = await db.query(
      pg ? `SELECT * FROM "TrackerVisits" WHERE "Id" = $1` : 'SELECT * FROM TrackerVisits WHERE Id = ?',
      [numId]
    );
    res.json({ success: true, message: 'تم تأشير واعتماد المعاينة رسمياً بنجاح ✅', visit: result[0] });
  } catch (err) {
    console.error('Direct approve visit error:', err.message);
    res.status(500).json({ error: 'خطأ في تأشير المعاينة' });
  }
});

app.delete('/api/visits/:id', async (req, res) => {
  try {
    const numId = parseInt(req.params.id, 10);
    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg ? 'DELETE FROM "TrackerVisits" WHERE "Id" = $1' : 'DELETE FROM TrackerVisits WHERE Id = ?',
      [numId]
    );
    res.json({ success: true, message: 'تم حذف محضر المعاينة بنجاح ✅' });
  } catch (err) {
    console.error('Direct delete visit error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء حذف المعاينة' });
  }
});

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/deductions', deductionRoutes);
app.use('/api/justifications', justificationRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/means', meansRoutes);

// Reset / Clean test attendance for fresh live demonstration
app.all(['/api/clean-test-data', '/clean-test-data', '/api/settings/clean-test-data'], async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    if (pg) {
      await db.query('TRUNCATE TABLE "TrackerVisits" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerAttendance" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerDeductions" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerAbsences" RESTART IDENTITY CASCADE');
    } else {
      await db.query('DELETE FROM TrackerVisits');
      await db.query('DELETE FROM TrackerAttendance');
      await db.query('DELETE FROM TrackerDeductions');
      await db.query('DELETE FROM TrackerAbsences');
    }
    res.json({
      success: true,
      message: '✅ تم تصفير جميع سجلات الحضور والمعاينات الوهمية السابقة بنجاح. يمكنك الآن بدء البث الحي الحقيقي بهاتفك!',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DCW-SETIF-TRACKER API v3.1.0-cancel-checkout',
    timezone: 'Africa/Algiers (UTC+1)',
    algeriaDate: getTodayAlgeria(),
    algeriaTime: getNowAlgeriaIso(),
    db: isPostgres() ? 'postgresql' : 'sqlserver'
  });
});

// Download endpoints for Android APK
const serveApk = (req, res) => {
  const fs = require('fs');
  const possiblePaths = [
    path.join(__dirname, 'public', 'app-release.apk'),
    path.join(__dirname, 'public', 'download', 'app-release.apk'),
    path.join(__dirname, 'public', 'DCW-SETIF-TRACKER.apk'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      return res.download(p, 'DCW-SETIF-TRACKER.apk');
    }
  }
  res.status(404).send('APK not found on server');
};

app.get('/app-release.apk', serveApk);
app.get('/DCW-SETIF-TRACKER.apk', serveApk);
app.get('/download/app-release.apk', serveApk);
app.get('/download/DCW-SETIF-TRACKER.apk', serveApk);
app.get('/download', serveApk);
app.get('/apk', serveApk);

// Fallback for Flutter Web SPA routes
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || req.path || '';
  if (url.startsWith('/api') || req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'مسار غير موجود في الواجهة البرمجية' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function ensureTables() {
  const db = await getConnection();
  const pg = isPostgres();

  const tables = [
    pg ? `CREATE TABLE IF NOT EXISTS "Employes" (
      "Id" SERIAL PRIMARY KEY, "NumeroMatricule" VARCHAR(50), "Nom" VARCHAR(100), "Prenom" VARCHAR(100),
      "NomAr" VARCHAR(200), "PrenomAr" VARCHAR(200), "Service" VARCHAR(300),
      "Grade" VARCHAR(100), "FonctionExercee" VARCHAR(200), "PosteFinancier" VARCHAR(100),
      "EstActif" BOOLEAN DEFAULT true
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "UtilisateursSysteme" (
      "Id" SERIAL PRIMARY KEY, "NomUtilisateur" VARCHAR(100) UNIQUE,
      "MotDePasseHash" TEXT, "NomComplet" VARCHAR(200), "Role" INT DEFAULT 4,
      "EstActif" BOOLEAN DEFAULT true, "DateCreation" TIMESTAMP DEFAULT NOW(),
      "DerniereConnexion" TIMESTAMP, "EmployeeId" INT, "Notes" TEXT
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerAttendance" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL, "Date" DATE NOT NULL,
      "CheckInTime" TIMESTAMP, "CheckOutTime" TIMESTAMP,
      "CheckInLocation" VARCHAR(200), "CheckOutLocation" VARCHAR(200),
      "CheckInLatitude" DOUBLE PRECISION, "CheckInLongitude" DOUBLE PRECISION,
      "CheckOutLatitude" DOUBLE PRECISION, "CheckOutLongitude" DOUBLE PRECISION,
      "CheckInPhoto" TEXT, "IsCheckedOut" BOOLEAN DEFAULT false,
      "Notes" TEXT, "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerPrograms" (
      "Id" SERIAL PRIMARY KEY, "Title" VARCHAR(200) NOT NULL,
      "Description" TEXT, "Type" VARCHAR(20) DEFAULT 'weekly',
      "WeekDate" VARCHAR(50), "MonthYear" VARCHAR(20),
      "TargetArea" VARCHAR(200), "TargetType" VARCHAR(100),
      "FocusPoints" TEXT, "CreatedBy" INT, "ServiceName" VARCHAR(200),
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerVisits" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "AssignmentId" INT, "Date" DATE NOT NULL,
      "CheckInTime" TIMESTAMP DEFAULT NOW(), "CheckOutTime" TIMESTAMP,
      "Latitude" DOUBLE PRECISION NOT NULL, "Longitude" DOUBLE PRECISION NOT NULL,
      "Accuracy" DOUBLE PRECISION, "LocationName" VARCHAR(300),
      "ShopName" VARCHAR(200), "ShopType" VARCHAR(100), "Photo" TEXT,
      "Status" VARCHAR(20) DEFAULT 'active', "Notes" TEXT,
      "ViolationFound" BOOLEAN DEFAULT false, "ViolationType" VARCHAR(200),
      "ViolationNotes" TEXT, "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerDeductions" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "RequestedBy" INT NOT NULL, "ApprovedBy" INT,
      "Date" DATE DEFAULT CURRENT_DATE, "Reason" TEXT NOT NULL,
      "Amount" DECIMAL(10,2), "DaysCount" INT,
      "Status" VARCHAR(20) DEFAULT 'pending', "Evidence" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerJustifications" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "Type" VARCHAR(50) DEFAULT 'general', "Title" VARCHAR(200),
      "StartDate" DATE NOT NULL, "EndDate" DATE NOT NULL,
      "DaysCount" INT DEFAULT 1, "DocumentPhoto" TEXT,
      "Notes" TEXT, "Status" VARCHAR(20) DEFAULT 'pending',
      "ReviewedBy" INT, "ReviewNotes" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerEmployeeAdmin" (
      "EmployeeId" INT PRIMARY KEY,
      "AdministrativeStatus" VARCHAR(50) DEFAULT 'active',
      "StatusStartDate" DATE,
      "StatusEndDate" DATE,
      "StatusNotes" TEXT,
      "IsBrigadeLeader" BOOLEAN DEFAULT false,
      "BrigadeName" VARCHAR(200),
      "AssignedDepartment" VARCHAR(300),
      "AssignedPosition" VARCHAR(200),
      "UpdatedBy" INT,
      "UpdatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerAbsences" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "Date" DATE NOT NULL, "Type" VARCHAR(20) DEFAULT 'absent',
      "Reason" TEXT, "VerifiedBy" INT
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerInquiries" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "Type" VARCHAR(50) DEFAULT 'unjustified_absence',
      "Subject" VARCHAR(300) NOT NULL,
      "IncidentDate" DATE NOT NULL,
      "LateMinutes" INT DEFAULT 0,
      "Details" TEXT,
      "Status" VARCHAR(30) DEFAULT 'sent',
      "SentBy" INT NOT NULL,
      "SentAt" TIMESTAMP DEFAULT NOW(),
      "EmployeeReply" TEXT,
      "ReplyDate" TIMESTAMP,
      "ReplyAttachment" TEXT,
      "DirectorDecision" VARCHAR(50),
      "DirectorNotes" TEXT,
      "DeductionDays" DECIMAL(4,1) DEFAULT 0.0,
      "DecisionDate" TIMESTAMP,
      "ExecutedBy" INT,
      "ExecutedAt" TIMESTAMP,
      "ExecutionNotes" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerSettings" (
      "Key" VARCHAR(100) PRIMARY KEY,
      "Value" VARCHAR(500) NOT NULL,
      "Description" TEXT,
      "UpdatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerVehicles" (
      "Id" SERIAL PRIMARY KEY,
      "Matricule" VARCHAR(50) NOT NULL UNIQUE,
      "Model" VARCHAR(150) NOT NULL,
      "Type" VARCHAR(100) DEFAULT 'سيارة رقابة وتدخل',
      "FuelLevel" INT DEFAULT 85,
      "Kilometrage" INT DEFAULT 50000,
      "Status" VARCHAR(50) DEFAULT 'disponible',
      "AssignedService" VARCHAR(200),
      "AssignedDriver" VARCHAR(200),
      "LastPosition" VARCHAR(200),
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : `CREATE TABLE IF NOT EXISTS TrackerVehicles (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      Matricule VARCHAR(50) NOT NULL UNIQUE,
      Model VARCHAR(150) NOT NULL,
      Type VARCHAR(100) DEFAULT 'سيارة رقابة وتدخل',
      FuelLevel INT DEFAULT 85,
      Kilometrage INT DEFAULT 50000,
      Status VARCHAR(50) DEFAULT 'disponible',
      AssignedService VARCHAR(200),
      AssignedDriver VARCHAR(200),
      LastPosition VARCHAR(200),
      CreatedAt DATETIME DEFAULT GETDATE()
    )`,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerVehicleMissions" (
      "Id" SERIAL PRIMARY KEY,
      "VehicleId" INT NOT NULL,
      "DriverName" VARCHAR(200) NOT NULL,
      "EmployeeId" INT,
      "Destination" VARCHAR(300) NOT NULL,
      "MissionPurpose" TEXT,
      "DepartureTime" TIMESTAMP DEFAULT NOW(),
      "ReturnTime" TIMESTAMP,
      "Status" VARCHAR(50) DEFAULT 'active',
      "DepartureKm" INT DEFAULT 0,
      "ReturnKm" INT,
      "FuelDeparture" INT DEFAULT 85,
      "FuelReturn" INT,
      "Notes" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : `CREATE TABLE IF NOT EXISTS TrackerVehicleMissions (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      VehicleId INT NOT NULL,
      DriverName VARCHAR(200) NOT NULL,
      EmployeeId INT,
      Destination VARCHAR(300) NOT NULL,
      MissionPurpose TEXT,
      DepartureTime DATETIME DEFAULT GETDATE(),
      ReturnTime DATETIME,
      Status VARCHAR(50) DEFAULT 'active',
      DepartureKm INT DEFAULT 0,
      ReturnKm INT,
      FuelDeparture INT DEFAULT 85,
      FuelReturn INT,
      Notes TEXT,
      CreatedAt DATETIME DEFAULT GETDATE()
    )`,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerEquipments" (
      "Id" SERIAL PRIMARY KEY,
      "Designation" VARCHAR(300) NOT NULL,
      "Code" VARCHAR(50) UNIQUE,
      "TotalQuantity" INT DEFAULT 1,
      "InServiceQuantity" INT DEFAULT 1,
      "ReserveQuantity" INT DEFAULT 0,
      "Status" VARCHAR(50) DEFAULT 'conforme',
      "AssignedTo" VARCHAR(200) DEFAULT 'فرق الرقابة وقمع الغش',
      "LastCheckedDate" DATE DEFAULT CURRENT_DATE,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : `CREATE TABLE IF NOT EXISTS TrackerEquipments (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      Designation VARCHAR(300) NOT NULL,
      Code VARCHAR(50) UNIQUE,
      TotalQuantity INT DEFAULT 1,
      InServiceQuantity INT DEFAULT 1,
      ReserveQuantity INT DEFAULT 0,
      Status VARCHAR(50) DEFAULT 'conforme',
      AssignedTo VARCHAR(200) DEFAULT 'فرق الرقابة وقمع الغش',
      LastCheckedDate DATE,
      CreatedAt DATETIME DEFAULT GETDATE()
    )`,
  ];

  for (const sql of tables) {
    if (sql) await db.query(sql);
  }

  // Ensure new columns on TrackerVisits, UtilisateursSysteme, and TrackerAttendance
  if (pg) {
    try {
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "LegalAction" VARCHAR(200)`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "SeizureValue" DECIMAL(15,2) DEFAULT 0`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "IsApproved" BOOLEAN DEFAULT false`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "ApprovedBy" VARCHAR(200)`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "ApprovedAt" TIMESTAMP`);

      await db.query(`ALTER TABLE "UtilisateursSysteme" ADD COLUMN IF NOT EXISTS "DeviceId" VARCHAR(150)`);
      await db.query(`ALTER TABLE "UtilisateursSysteme" ADD COLUMN IF NOT EXISTS "DeviceName" VARCHAR(100)`);

      await db.query(`ALTER TABLE "TrackerAttendance" ADD COLUMN IF NOT EXISTS "DeviceId" VARCHAR(150)`);
      await db.query(`ALTER TABLE "TrackerAttendance" ADD COLUMN IF NOT EXISTS "EarlyReason" TEXT`);
      await db.query(`ALTER TABLE "TrackerAttendance" ADD COLUMN IF NOT EXISTS "IsWithinGeofence" BOOLEAN DEFAULT true`);
    } catch (e) {
      console.log('Postgres columns migration check:', e.message);
    }
  } else {
    try {
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'LegalAction') ALTER TABLE TrackerVisits ADD LegalAction NVARCHAR(200) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'SeizureValue') ALTER TABLE TrackerVisits ADD SeizureValue DECIMAL(15,2) DEFAULT 0`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'IsApproved') ALTER TABLE TrackerVisits ADD IsApproved BIT DEFAULT 0`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'ApprovedBy') ALTER TABLE TrackerVisits ADD ApprovedBy NVARCHAR(200) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'ApprovedAt') ALTER TABLE TrackerVisits ADD ApprovedAt DATETIME NULL`);

      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('UtilisateursSysteme') AND name = 'DeviceId') ALTER TABLE UtilisateursSysteme ADD DeviceId NVARCHAR(150) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('UtilisateursSysteme') AND name = 'DeviceName') ALTER TABLE UtilisateursSysteme ADD DeviceName NVARCHAR(100) NULL`);

      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerAttendance') AND name = 'DeviceId') ALTER TABLE TrackerAttendance ADD DeviceId NVARCHAR(150) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerAttendance') AND name = 'EarlyReason') ALTER TABLE TrackerAttendance ADD EarlyReason NVARCHAR(MAX) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerAttendance') AND name = 'IsWithinGeofence') ALTER TABLE TrackerAttendance ADD IsWithinGeofence BIT DEFAULT 1`);
    } catch (e) {}
  }

  if (!pg) {
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerEmployeeAdmin')
    BEGIN CREATE TABLE TrackerEmployeeAdmin (
      EmployeeId INT PRIMARY KEY,
      AdministrativeStatus NVARCHAR(50) DEFAULT 'active',
      StatusStartDate DATE NULL,
      StatusEndDate DATE NULL,
      StatusNotes NVARCHAR(500) NULL,
      IsBrigadeLeader BIT DEFAULT 0,
      BrigadeName NVARCHAR(200) NULL,
      AssignedDepartment NVARCHAR(300) NULL,
      AssignedPosition NVARCHAR(200) NULL,
      UpdatedBy INT NULL,
      UpdatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerJustifications')
    BEGIN CREATE TABLE TrackerJustifications (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      Type NVARCHAR(50) DEFAULT 'general', Title NVARCHAR(200) NULL,
      StartDate DATE NOT NULL, EndDate DATE NOT NULL,
      DaysCount INT DEFAULT 1, DocumentPhoto NVARCHAR(MAX) NULL,
      Notes NVARCHAR(500) NULL, Status NVARCHAR(20) DEFAULT 'pending',
      ReviewedBy INT NULL, ReviewNotes NVARCHAR(500) NULL,
      CreatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerAttendance')
    BEGIN CREATE TABLE TrackerAttendance (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL, Date DATE NOT NULL,
      CheckInTime DATETIME NULL, CheckOutTime DATETIME NULL,
      CheckInLocation NVARCHAR(200) NULL, CheckOutLocation NVARCHAR(200) NULL,
      CheckInLatitude FLOAT NULL, CheckInLongitude FLOAT NULL,
      CheckOutLatitude FLOAT NULL, CheckOutLongitude FLOAT NULL,
      CheckInPhoto NVARCHAR(MAX) NULL, IsCheckedOut BIT DEFAULT 0,
      Notes NVARCHAR(500) NULL, CreatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerPrograms')
    BEGIN CREATE TABLE TrackerPrograms (
      Id INT IDENTITY(1,1) PRIMARY KEY, Title NVARCHAR(200) NOT NULL,
      Description NVARCHAR(500) NULL, Type NVARCHAR(20) DEFAULT 'weekly',
      WeekDate NVARCHAR(50) NULL, MonthYear NVARCHAR(20) NULL,
      TargetArea NVARCHAR(200) NULL, TargetType NVARCHAR(100) NULL,
      FocusPoints NVARCHAR(500) NULL, CreatedBy INT NULL,
      ServiceName NVARCHAR(200) NULL, CreatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerVisits')
    BEGIN CREATE TABLE TrackerVisits (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      AssignmentId INT NULL, Date DATE NOT NULL,
      CheckInTime DATETIME DEFAULT GETDATE(), CheckOutTime DATETIME NULL,
      Latitude FLOAT NOT NULL, Longitude FLOAT NOT NULL,
      Accuracy FLOAT NULL, LocationName NVARCHAR(300) NULL,
      ShopName NVARCHAR(200) NULL, ShopType NVARCHAR(100) NULL,
      Photo NVARCHAR(MAX) NULL, Status NVARCHAR(20) DEFAULT 'active',
      Notes NVARCHAR(500) NULL, ViolationFound BIT DEFAULT 0,
      ViolationType NVARCHAR(200) NULL, ViolationNotes NVARCHAR(500) NULL,
      CreatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerDeductions')
    BEGIN CREATE TABLE TrackerDeductions (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      RequestedBy INT NOT NULL, ApprovedBy INT NULL,
      Date DATE DEFAULT GETDATE(), Reason NVARCHAR(500) NOT NULL,
      Amount DECIMAL(10,2) NULL, DaysCount INT NULL,
      Status NVARCHAR(20) DEFAULT 'pending', Evidence NVARCHAR(MAX) NULL,
      CreatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerInquiries')
    BEGIN CREATE TABLE TrackerInquiries (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      Type NVARCHAR(50) DEFAULT 'unjustified_absence',
      Subject NVARCHAR(300) NOT NULL, IncidentDate DATE NOT NULL,
      LateMinutes INT DEFAULT 0, Details NVARCHAR(MAX) NULL,
      Status NVARCHAR(30) DEFAULT 'sent', SentBy INT NOT NULL,
      SentAt DATETIME DEFAULT GETDATE(), EmployeeReply NVARCHAR(MAX) NULL,
      ReplyDate DATETIME NULL, ReplyAttachment NVARCHAR(MAX) NULL,
      DirectorDecision NVARCHAR(50) NULL, DirectorNotes NVARCHAR(MAX) NULL,
      DeductionDays DECIMAL(4,1) DEFAULT 0.0, DecisionDate DATETIME NULL,
      ExecutedBy INT NULL, ExecutedAt DATETIME NULL, ExecutionNotes NVARCHAR(MAX) NULL,
      CreatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerSettings')
    BEGIN CREATE TABLE TrackerSettings (
      [Key] NVARCHAR(100) PRIMARY KEY,
      [Value] NVARCHAR(500) NOT NULL,
      Description NVARCHAR(500) NULL,
      UpdatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    console.log('✅ SQL Server tables ensured');
  } else {
    console.log('✅ PostgreSQL tables ensured');
  }
}

async function seedUsers() {
  const db = await getConnection();
  const pg = isPostgres();

  // Clean Slate: Ensure only the protected tracker_admin account exists
  try {
    const adminHash = await bcrypt.hash('admin123', 10);
    const existing = await db.query(
      pg
        ? 'SELECT "Id" FROM "UtilisateursSysteme" WHERE "NomUtilisateur" = $1'
        : 'SELECT Id FROM UtilisateursSysteme WHERE NomUtilisateur = ?',
      ['tracker_admin']
    );

    if (!existing || existing.length === 0) {
      await db.query(
        pg
          ? 'INSERT INTO "UtilisateursSysteme" ("NomUtilisateur","MotDePasseHash","NomComplet","Role","EstActif","DateCreation") VALUES ($1,$2,$3,5,true,NOW())'
          : 'INSERT INTO UtilisateursSysteme (NomUtilisateur,MotDePasseHash,NomComplet,Role,EstActif,DateCreation) VALUES (?,?,?,5,1,GETDATE())',
        ['tracker_admin', adminHash, 'مدير النظام التقني']
      );
      console.log('✅ Main admin account initialized: tracker_admin');
    } else {
      await db.query(
        pg
          ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash"=$1, "NomComplet"=$2, "Role"=5, "EstActif"=true WHERE "NomUtilisateur"=$3'
          : 'UPDATE UtilisateursSysteme SET MotDePasseHash=?, NomComplet=?, Role=5, EstActif=1 WHERE NomUtilisateur=?',
        [adminHash, 'مدير النظام التقني', 'tracker_admin']
      );
    }

    // Delete all test accounts except tracker_admin
    await db.query(
      pg
        ? 'DELETE FROM "UtilisateursSysteme" WHERE "NomUtilisateur" != \'tracker_admin\''
        : 'DELETE FROM UtilisateursSysteme WHERE NomUtilisateur != \'tracker_admin\''
    );
    console.log('🧹 All test accounts purged. Only tracker_admin remains active.');
  } catch (err) {
    console.log('seedUsers error:', err.message);
  }
}

async function seedEmployees() {
  // Clean slate: 0 mock employees
  return;
}

async function seedPrograms() {
  // Clean slate: 0 mock programs
  return;
}

async function seedMeansData() {
  // Clean slate: 0 mock vehicles/equipment
  return;
}

// Full Database Purge Endpoint (For Resetting System to 0 Data)
app.all(['/api/admin/purge-all-data', '/api/clean-test-data', '/clean-test-data'], async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    if (pg) {
      await db.query('TRUNCATE TABLE "TrackerVisits" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerAttendance" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerDeductions" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerAbsences" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerInquiries" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerPrograms" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerVehicles" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerEquipments" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "Employes" RESTART IDENTITY CASCADE');
      await db.query('DELETE FROM "UtilisateursSysteme" WHERE "NomUtilisateur" != \'tracker_admin\'');
    } else {
      await db.query('DELETE FROM TrackerVisits');
      await db.query('DELETE FROM TrackerAttendance');
      await db.query('DELETE FROM TrackerDeductions');
      await db.query('DELETE FROM TrackerAbsences');
      await db.query('DELETE FROM TrackerInquiries');
      await db.query('DELETE FROM TrackerPrograms');
      await db.query('DELETE FROM TrackerVehicles');
      await db.query('DELETE FROM TrackerEquipments');
      await db.query('DELETE FROM Employes');
      await db.query('DELETE FROM UtilisateursSysteme WHERE NomUtilisateur != \'tracker_admin\'');
    }
    await seedUsers();
    res.json({
      success: true,
      message: '✅ تم تصفير وحذف جميع البيانات الوهمية السابقة بنجاح. النظام الآن برصيد 0 موظفين و0 معاينات وحساب الأدمن الوحيد.',
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تفريغ قاعدة البيانات: ' + err.message });
  }
});

async function start() {
  try {
    await ensureTables();
    await seedUsers();
    // Auto-purge any leftover test data on startup for clean slate
    const db = await getConnection();
    const pg = isPostgres();
    try {
      await db.query(pg ? 'TRUNCATE TABLE "Employes" RESTART IDENTITY CASCADE' : 'DELETE FROM Employes');
      await db.query(pg ? 'TRUNCATE TABLE "TrackerVisits" RESTART IDENTITY CASCADE' : 'DELETE FROM TrackerVisits');
      await db.query(pg ? 'TRUNCATE TABLE "TrackerAttendance" RESTART IDENTITY CASCADE' : 'DELETE FROM TrackerAttendance');
      await db.query(pg ? 'TRUNCATE TABLE "TrackerPrograms" RESTART IDENTITY CASCADE' : 'DELETE FROM TrackerPrograms');
      await db.query(pg ? 'DELETE FROM "UtilisateursSysteme" WHERE "NomUtilisateur" != \'tracker_admin\'' : 'DELETE FROM UtilisateursSysteme WHERE NomUtilisateur != \'tracker_admin\'');
    } catch (_) {}

    const publicPath = path.join(__dirname, 'public');
    if (fs.existsSync(publicPath)) {
      app.use(express.static(publicPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(publicPath, 'index.html'));
      });
      console.log('🌐 Static Flutter web app enabled from public/');
    }

    app.listen(PORT, () => {
      console.log(`🚀 DRH-SETIF-TRACKER API v3.1 running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
