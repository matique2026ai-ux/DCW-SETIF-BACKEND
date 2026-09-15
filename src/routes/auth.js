const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection, isPostgres } = require('../config/database');

const router = express.Router();

const ROLE_MAP = {
  0: 'director', 1: 'director', 2: 'head_of_department',
  3: 'bureau_chief', 4: 'inspector', 5: 'admin',
};

const NOW = () => isPostgres() ? 'NOW()' : 'GETDATE()';

router.post('/login', async (req, res) => {
  try {
    const rawUsername = (req.body.username || '').trim();
    const rawPassword = (req.body.password || '').trim();
    if (!rawUsername || !rawPassword) {
      return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const users = await db.query(
      pg
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE LOWER(TRIM("NomUtilisateur")) = LOWER($1) AND "EstActif" = true'
        : 'SELECT * FROM UtilisateursSysteme WHERE LOWER(LTRIM(RTRIM(NomUtilisateur))) = LOWER(?) AND EstActif = 1',
      [rawUsername]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'مستخدم غير موجود' });
    }

    const user = users[0];
    let valid = false;

    try {
      valid = await bcrypt.compare(rawPassword, user.MotDePasseHash || user['MotDePasseHash']);
    } catch {
      valid = false;
    }

    if (!valid && (user.MotDePasseHash || user['MotDePasseHash']) === rawPassword) {
      valid = true;
      try {
        const newHash = await bcrypt.hash(rawPassword, 10);
        await db.query(
          pg
            ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash"=$1 WHERE "Id"=$2'
            : 'UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?',
          [newHash, user.Id]
        );
      } catch {}
    }

    if (!valid) {
      return res.status(401).json({ error: 'كلمة المرور خاطئة' });
    }

    const role = ROLE_MAP[user.Role] || 'inspector';

    await db.query(
      pg
        ? `UPDATE "UtilisateursSysteme" SET "DerniereConnexion" = NOW() WHERE "Id" = $1`
        : 'UPDATE UtilisateursSysteme SET DerniereConnexion = GETDATE() WHERE Id = ?',
      [user.Id]
    );

    const token = jwt.sign(
      { id: user.Id, username: user.NomUtilisateur || user['NomUtilisateur'], role, fullName: user.NomComplet || user['NomComplet'], employeeId: user.EmployeeId || user['EmployeeId'] },
      process.env.JWT_SECRET || 'drh-setif-secret-2024',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.Id,
        username: user.NomUtilisateur || user['NomUtilisateur'],
        fullName: user.NomComplet || user['NomComplet'],
        role,
        employeeId: user.EmployeeId || user['EmployeeId'] || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'غير مصرح' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');

    const db = await getConnection();
    const pg = isPostgres();
    const users = await db.query(
      pg
        ? 'SELECT "Id","NomUtilisateur","NomComplet","Role","EstActif","DateCreation","DerniereConnexion" FROM "UtilisateursSysteme" WHERE "Id" = $1'
        : 'SELECT Id,NomUtilisateur,NomComplet,Role,EstActif,DateCreation,DerniereConnexion FROM UtilisateursSysteme WHERE Id = ?',
      [decoded.id]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const u = users[0];
    res.json({
      id: u.Id,
      username: u.NomUtilisateur,
      fullName: u.NomComplet,
      role: ROLE_MAP[u.Role] || 'inspector',
      isActive: u.EstActif,
      createdAt: u.DateCreation,
      lastLogin: u.DerniereConnexion,
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'غير مصرح - الرجاء تسجيل الدخول أولاً' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');
    } catch (e) {
      return res.status(401).json({ error: 'جلسة العمل منتهية الصلاحية، يرجى تسجيل الدخول مجدداً' });
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
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE "Id" = $1 AND "EstActif" = true'
        : 'SELECT * FROM UtilisateursSysteme WHERE Id = ? AND EstActif = 1',
      [decoded.id]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = users[0];
    const userId = user.Id !== undefined ? user.Id : (user.id !== undefined ? user.id : decoded.id);
    const existingHash = user.MotDePasseHash || user.motdepassehash || user.MotDePasse || user.motdepasse || '';

    let valid = false;
    try {
      valid = await bcrypt.compare(currentPassword, existingHash);
    } catch {
      valid = false;
    }

    if (!valid && (existingHash === currentPassword || existingHash === '')) {
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
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم أثناء تغيير كلمة المرور' });
  }
});

// Admin: Get all system users
router.get('/users', async (req, res) => {
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
    console.error('Fetch users error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب قائمة المستخدمين' });
  }
});

// Admin: Create a new system user
router.post('/users', async (req, res) => {
  try {
    const { username, password, fullName, role, employeeId } = req.body;
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور والاسم الكامل حقول إجبارية' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const db = await getConnection();
    const pg = isPostgres();

    // Check if username already exists
    const existing = await db.query(
      pg
        ? 'SELECT "Id" FROM "UtilisateursSysteme" WHERE LOWER("NomUtilisateur") = $1'
        : 'SELECT Id FROM UtilisateursSysteme WHERE LOWER(NomUtilisateur) = ?',
      [cleanUsername]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر' });
    }

    const REVERSE_ROLE_MAP = {
      director: 1,
      head_of_department: 2,
      bureau_chief: 3,
      inspector: 4,
      admin: 5,
    };
    const dbRole = typeof role === 'number' ? role : (REVERSE_ROLE_MAP[role] || 4);
    const hash = await bcrypt.hash(password.trim(), 10);

    const insertQuery = pg
      ? `INSERT INTO "UtilisateursSysteme" ("NomUtilisateur", "MotDePasseHash", "NomComplet", "Role", "EstActif", "DateCreation", "EmployeeId")
         VALUES ($1, $2, $3, $4, true, NOW(), $5) RETURNING "Id"`
      : `INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, DateCreation, EmployeeId)
         VALUES (?, ?, ?, ?, 1, GETDATE(), ?)`;

    await db.query(insertQuery, [cleanUsername, hash, fullName.trim(), dbRole, employeeId || null]);

    res.json({ success: true, message: 'تم إنشاء المستخدم بنجاح ✅' });
  } catch (err) {
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
  }
});

// Admin: Update user details / role / status
router.put('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
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
         WHERE "Id" = $5`
      : `UPDATE UtilisateursSysteme
         SET NomComplet = ?, Role = ?, EstActif = ?, EmployeeId = ?
         WHERE Id = ?`;

    await db.query(updateQuery, [fullName, dbRole, activeVal, employeeId || null, userId]);

    res.json({ success: true, message: 'تم تحديث بيانات المستخدم بنجاح ✅' });
  } catch (err) {
    console.error('Update user error:', err.message);
    res.status(500).json({ error: 'خطأ في تحديث المستخدم' });
  }
});

// Admin: Reset a specific user's password
router.post('/users/:id/reset-password', async (req, res) => {
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
      ? `UPDATE "UtilisateursSysteme" SET "MotDePasseHash" = $1 WHERE "Id" = $2`
      : `UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?`;

    await db.query(updateQuery, [hash, userId]);

    res.json({ success: true, message: 'تمت إعادة تعيين كلمة المرور بنجاح ✅' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'خطأ في إعادة تعيين كلمة المرور' });
  }
});

// Admin: Bulk generate accounts for all 267 employees
router.post('/generate-all-accounts', async (req, res) => {
  try {
    const defaultPassword = (req.body.defaultPassword || 'Setif@2025').trim();
    const db = await getConnection();
    const pg = isPostgres();

    // Fetch all employees
    const employees = await db.query(
      pg ? 'SELECT "Id", "Nom", "Prenom", "NomAr", "PrenomAr", "Service" FROM "Employes"' : 'SELECT Id, Nom, Prenom, NomAr, PrenomAr, Service FROM Employes'
    );

    // Fetch all existing employeeIds linked in UtilisateursSysteme
    const existingUsers = await db.query(
      pg ? 'SELECT "EmployeeId", "NomUtilisateur" FROM "UtilisateursSysteme"' : 'SELECT EmployeeId, NomUtilisateur FROM UtilisateursSysteme'
    );

    const linkedEmployeeIds = new Set(
      existingUsers.map((u) => u.EmployeeId || u.employeeid).filter(Boolean)
    );
    const existingUsernames = new Set(
      existingUsers.map((u) => (u.NomUtilisateur || u.nomutilisateur || '').toLowerCase())
    );

    const hash = await bcrypt.hash(defaultPassword, 10);
    let createdCount = 0;

    for (const emp of employees) {
      const empId = emp.Id || emp.id;
      if (linkedEmployeeIds.has(empId)) continue; // Already has an account

      // Generate a clean username
      const rawNom = (emp.Nom || emp.nom || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const rawPrenom = (emp.Prenom || emp.prenom || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      
      let baseUsername = rawPrenom && rawNom ? `${rawPrenom}.${rawNom}` : `emp.${empId}`;
      let candidate = baseUsername;
      let counter = 1;
      while (existingUsernames.has(candidate)) {
        candidate = `${baseUsername}${counter++}`;
      }
      existingUsernames.add(candidate);

      const fullNameAr = `${emp.NomAr || emp.nomar || emp.Nom || emp.nom || ''} ${emp.PrenomAr || emp.prenomar || emp.Prenom || emp.prenom || ''}`.trim();
      const finalName = fullNameAr || `${emp.Nom || ''} ${emp.Prenom || ''}`.trim() || `موظف ${empId}`;

      const insertQuery = pg
        ? `INSERT INTO "UtilisateursSysteme" ("NomUtilisateur", "MotDePasseHash", "NomComplet", "Role", "EstActif", "DateCreation", "EmployeeId")
           VALUES ($1, $2, $3, 4, true, NOW(), $4)`
        : `INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, DateCreation, EmployeeId)
           VALUES (?, ?, ?, 4, 1, GETDATE(), ?)`;

      await db.query(insertQuery, [candidate, hash, finalName, empId]);
      linkedEmployeeIds.add(empId);
      createdCount++;
    }

    res.json({
      success: true,
      createdCount,
      totalEmployees: employees.length,
      defaultPassword,
      message: `تم إنشاء ${createdCount} حساب مستخدم جديد بنجاح بكلمة سر افتراضية: (${defaultPassword})`,
    });
  } catch (err) {
    console.error('Generate accounts error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء إنشاء حسابات الموظفين' });
  }
});

// Admin: Delete user account permanently
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const db = await getConnection();
    const pg = isPostgres();

    // Prevent deleting the main admin account (id 1 or username tracker_admin)
    const users = await db.query(
      pg
        ? 'SELECT "NomUtilisateur" FROM "UtilisateursSysteme" WHERE "Id" = $1'
        : 'SELECT NomUtilisateur FROM UtilisateursSysteme WHERE Id = ?',
      [userId]
    );

    if (users && users.length > 0) {
      const username = (users[0].NomUtilisateur || users[0].nomutilisateur || '').toLowerCase();
      if (username === 'tracker_admin') {
        return res.status(400).json({ error: 'لا يمكن حذف الحساب الرئيسي لمدير النظام' });
      }
    }

    const deleteQuery = pg
      ? 'DELETE FROM "UtilisateursSysteme" WHERE "Id" = $1'
      : 'DELETE FROM UtilisateursSysteme WHERE Id = ?';

    await db.query(deleteQuery, [userId]);

    res.json({ success: true, message: 'تم حذف الحساب نهائياً بنجاح ✅' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء حذف الحساب: ' + err.message });
  }
});

module.exports = router;



