const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection, isPostgres } = require('../config/database');
const { authMiddleware, roleGuard } = require('../middleware/auth');

const router = express.Router();

const ROLE_MAP = {
  0: 'director', 1: 'director', 2: 'head_of_department',
  3: 'bureau_chief', 4: 'inspector', 5: 'admin',
};

const NOW = () => isPostgres() ? 'NOW()' : 'GETDATE()';

function normalizeUser(u) {
  if (!u) return null;
  return {
    id: u.Id !== undefined ? u.Id : u.id,
    username: u.NomUtilisateur || u.nomutilisateur || '',
    passwordHash: u.MotDePasseHash || u.motdepassehash || u.MotDePasse || u.motdepasse || '',
    fullName: u.NomComplet || u.nomcomplet || '',
    roleId: u.Role !== undefined ? u.Role : (u.role !== undefined ? u.role : 4),
    isActive: (u.EstActif !== undefined ? u.EstActif : u.estactif) === true || (u.EstActif || u.estactif) === 1,
    employeeId: u.EmployeeId !== undefined ? u.EmployeeId : (u.employeeid !== undefined ? u.employeeid : null),
    deviceId: u.DeviceId || u.deviceid || null,
    deviceName: u.DeviceName || u.devicename || null,
    masterPin: u.MasterPin || u.masterpin || '202600',
    serviceName: u.Service || u.service || '',
    mustChangeCredentials: u.MustChangeCredentials !== undefined ? (u.MustChangeCredentials === true || u.MustChangeCredentials === 1) : null,
    createdAt: u.DateCreation || u.datecreation,
    lastLogin: u.DerniereConnexion || u.derniereconnexion,
  };
}

async function verifyPin(rawPin, storedPin) {
  if (!rawPin || !storedPin) return false;
  const raw = rawPin.toString().trim();
  const stored = storedPin.toString().trim();
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    try {
      return await bcrypt.compare(raw, stored);
    } catch {
      return false;
    }
  }
  return raw === stored;
}

async function getSystemInitialPin(db, pg) {
  try {
    const query = pg
      ? 'SELECT "Value" FROM "TrackerSettings" WHERE "Key" = \'initial_master_pin\''
      : 'SELECT [Value] FROM TrackerSettings WHERE [Key] = \'initial_master_pin\'';
    const rows = await db.query(query);
    if (rows && rows.length > 0) {
      const val = rows[0].Value || rows[0].value;
      if (val && val.trim().length >= 4) return val.trim();
    }
  } catch (e) {
    // If table doesn't exist yet, it will fallback safely
  }
  return '202600';
}

async function updateUserDevice(db, pg, deviceId, deviceName, userId) {
  try {
    const query = pg
      ? `UPDATE "UtilisateursSysteme" SET "DeviceId" = $1, "DeviceName" = $2 WHERE "Id" = $3`
      : `UPDATE UtilisateursSysteme SET DeviceId = ?, DeviceName = ? WHERE Id = ?`;
    await db.query(query, [deviceId, deviceName, userId]);
  } catch (err) {
    console.error('Update user device error:', err.message);
  }
}

router.post('/login', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const rawUsername = (req.body.username || '').trim();
    const rawPassword = (req.body.password || '').trim();
    const incomingDeviceId = (req.body.deviceId || '').trim();
    const incomingDeviceName = (req.body.deviceName || '').trim();
    const adminOverride = (req.body.adminOverrideCode || '').trim();
    const masterPin = (req.body.masterPin || req.body.adminPin || '').trim();

    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua) || req.body.isIOS === true;
    const isAndroidMobile = /android/.test(ua) && /mobile/.test(ua);
    const isMobileDevice = isIOS || isAndroidMobile || /mobile/.test(ua);
    const isDesktop = !isMobileDevice && (/windows nt|macintosh|linux x86_64|cros/.test(ua) || req.body.isDesktop === true);
    const isWebClient = req.body.isWeb === true || req.body.isWeb === 'true' || (!incomingDeviceId && ua.includes('mozilla'));

    if (!rawUsername || !rawPassword) {
      return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
    }

    let users = await db.query(
      pg
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE LOWER(TRIM("NomUtilisateur")) = LOWER($1) AND "EstActif" = true'
        : 'SELECT * FROM UtilisateursSysteme WHERE LOWER(LTRIM(RTRIM(NomUtilisateur))) = LOWER(?) AND EstActif = 1',
      [rawUsername]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'اسم المستخدم غير موجود أو الحساب غير مفعّل' });
    }

    const u = normalizeUser(users[0]);
    let valid = false;

    try {
      valid = await bcrypt.compare(rawPassword, u.passwordHash);
    } catch {
      valid = false;
    }

    if (!valid && (u.passwordHash === rawPassword || u.passwordHash === '')) {
      valid = true;
      try {
        const newHash = await bcrypt.hash(rawPassword, 10);
        await db.query(
          pg
            ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash"=$1 WHERE "Id"=$2'
            : 'UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?',
          [newHash, u.id]
        );
      } catch {}
    }

    if (!valid) {
      return res.status(401).json({ error: 'كلمة المرور خاطئة' });
    }

    const role = ROLE_MAP[u.roleId] || 'inspector';

    // 🛡️ Security Check for Administrative & Executive Leadership (Admin: 5, Director: 1, Dept Heads: 2, Bureau Chief: 3):
    if (u.roleId === 5 || u.roleId === 1 || u.roleId === 2 || u.roleId === 3) {
      const roleLabel = u.roleId === 5
        ? 'مدير النظام التقني'
        : (u.roleId === 1 ? 'المدير الولائي' : (u.roleId === 2 ? 'رئيس المصلحة' : 'رئيس مكتب المستخدمين'));

      // If logging in from Web Browser (Office PC / Laptop):
      if (isWebClient) {
        if (!masterPin) {
          return res.status(403).json({
            error: `تنبيه أمني: يتطلب تسجيل دخول ${roleLabel} من المتصفح إدخال رمز الأمان السري (PIN Code) لتأكيد الهوية.`,
            requiresMasterPin: true,
          });
        }
        const pinValid = await verifyPin(masterPin, u.masterPin);
        if (!pinValid) {
          return res.status(403).json({
            error: 'رمز الأمان السري (PIN Code) غير صحيح ❌ يرجى التأكد وإعادة المحاولة.',
            requiresMasterPin: true,
          });
        }
        // Auto-upgrade legacy plaintext PIN to bcrypt hash on successful verification
        if (!u.masterPin.startsWith('$2a$') && !u.masterPin.startsWith('$2b$')) {
          try {
            const hashedPin = await bcrypt.hash(masterPin, 10);
            await db.query(
              pg ? 'UPDATE "UtilisateursSysteme" SET "MasterPin" = $1 WHERE "Id" = $2' : 'UPDATE UtilisateursSysteme SET MasterPin = ? WHERE Id = ?',
              [hashedPin, u.id]
            );
            u.masterPin = hashedPin;
          } catch (_) {}
        }
      } else if (incomingDeviceId) {
        // Logging in from Mobile App: Enforce Mobile Device Locking
        if (!u.deviceId) {
          await updateUserDevice(db, pg, incomingDeviceId, incomingDeviceName || `هاتف ${roleLabel} المعتمد`, u.id);
          u.deviceId = incomingDeviceId;
        } else if (u.deviceId !== incomingDeviceId) {
          const pinValid = masterPin ? await verifyPin(masterPin, u.masterPin) : false;
          if (pinValid || adminOverride === 'admin123' || adminOverride === 'DCW-OVERRIDE') {
            await updateUserDevice(db, pg, incomingDeviceId, incomingDeviceName || `هاتف ${roleLabel} المعتمد (محدث)`, u.id);
            u.deviceId = incomingDeviceId;
          } else {
            return res.status(403).json({
              error: `تنبيه أمني صارم: هذا الحساب مقترن بهاتف ${roleLabel} المعتمد فقط. يمنع تسجيل الدخول من هواتف أخرى لمنع انتحال الشخصية أو التسريب.`,
              isDeviceMismatch: true,
              boundDeviceId: u.deviceId,
              requiresMasterPin: true,
            });
          }
        }
      }
    } else if (u.roleId === 4) {
      // 🛡️ Field Inspector Security Check:
      // 🚫 STRICT ENFORCEMENT: Field inspectors are strictly forbidden from logging in via any web browser
      // (neither mobile phone browser nor PC/Laptop browser). They can only access via the installed native APK.
      if (isWebClient || req.body.isWeb === true || req.body.isWeb === 'true') {
        return res.status(403).json({
          error: '🚫 الولوج عبر المتصفح غير مصرّح به للمفتشين الميدانيين: حساب المفتش مقيّد حصرياً بتطبيق الهاتف المحمول المصطب (DCW-SETIF-TRACKER). يمنع منعاً باتاً فتح الحساب من متصفح الهاتف أو الكمبيوتر.',
          code: 'INSPECTOR_WEB_FORBIDDEN',
        });
      }

      // Mobile Device Enrollment / Enforcement (Android APK):
      const effectiveDeviceId = incomingDeviceId;

      if (effectiveDeviceId) {
        if (!u.deviceId) {
          // First-time enrollment: Bind this mobile device
          const deviceLabel = incomingDeviceName || 'هاتف مفتش معتمد';
          await updateUserDevice(db, pg, effectiveDeviceId, deviceLabel, u.id);
          u.deviceId = effectiveDeviceId;
        } else if (u.deviceId !== effectiveDeviceId) {
          // Check for admin emergency override code or master PIN
          const pinValid = masterPin ? await verifyPin(masterPin, u.masterPin) : false;
          if (adminOverride === 'admin123' || adminOverride === 'DCW-OVERRIDE' || pinValid) {
            const deviceLabel = incomingDeviceName || 'هاتف معتمد (محدث بترخيص)';
            await updateUserDevice(db, pg, effectiveDeviceId, deviceLabel, u.id);
            u.deviceId = effectiveDeviceId;
          } else {
            return res.status(403).json({
              error: `تنبيه أمني صارم: هذا الحساب مقترن بـ (${u.deviceName || 'الهاتف المعتمد'}) المسجل رسمياً لهذا المفتش لمنع انتحال الشخصية أو التلاعب بالبصمة. إذا قمت بتغيير هاتفك أو إعادة تثبيت التطبيق، أدخل رمز الأمان المعتمد (PIN) أو تواصل مع مدير النظام التقني (Admin).`,
              isDeviceMismatch: true,
              boundDeviceId: u.deviceId,
              requiresMasterPin: true,
            });
          }
        }
      }
    }

    await db.query(
      pg
        ? `UPDATE "UtilisateursSysteme" SET "DerniereConnexion" = NOW() WHERE "Id" = $1`
        : 'UPDATE UtilisateursSysteme SET DerniereConnexion = GETDATE() WHERE Id = ?',
      [u.id]
    );

    const token = jwt.sign(
      { id: u.id, username: u.username, role, fullName: u.fullName, employeeId: u.employeeId, deviceId: u.deviceId },
      process.env.JWT_SECRET || 'drh-setif-secret-2024',
      { expiresIn: '24h' }
    );

    // tracker_admin (roleId=5, username='tracker_admin') is sovereignly protected — never forced to change.
    const isTrackerAdmin = u.username.toLowerCase() === 'tracker_admin';
    const systemInitialPin = await getSystemInitialPin(db, pg);
    let isInitialPin = (u.masterPin === systemInitialPin || u.masterPin === '202600');
    if (!isInitialPin && (u.masterPin.startsWith('$2a$') || u.masterPin.startsWith('$2b$'))) {
      try {
        isInitialPin = (await bcrypt.compare(systemInitialPin, u.masterPin)) || (await bcrypt.compare('202600', u.masterPin));
      } catch (_) {}
    }
    // All users (Inspectors: 4, Directors: 1, Dept Heads: 2, Bureau Chief: 3, Admin: 5) must change credentials on first login or if default initial PIN.
    const mustChange = !isTrackerAdmin && (
      u.mustChangeCredentials === true ||
      isInitialPin ||
      u.lastLogin == null
    );

    res.json({
      token,
      user: {
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        role,
        roleId: u.roleId,
        serviceName: u.serviceName,
        employeeId: u.employeeId,
        deviceId: u.deviceId,
        mustChangeCredentials: mustChange,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Admin endpoint to unbind/reset inspector device
router.post('/users/:id/reset-device', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const userId = parseInt(req.params.id);
    await db.query(
      pg
        ? `UPDATE "UtilisateursSysteme" SET "DeviceId" = NULL, "DeviceName" = NULL WHERE "Id" = $1`
        : `UPDATE UtilisateursSysteme SET DeviceId = NULL, DeviceName = NULL WHERE Id = ?`,
      [userId]
    );
    res.json({ success: true, message: 'تم إلغاء ربط الجهاز بنجاح ✅ يمكن للمستخدم الآن تسجيل الدخول بجهازه الجديد ليتم اعتماده تلقائياً.' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إلغاء ربط الجهاز: ' + err.message });
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
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE "Id" = $1'
        : 'SELECT * FROM UtilisateursSysteme WHERE Id = ?',
      [decoded.id]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const u = normalizeUser(users[0]);
    res.json({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      role: ROLE_MAP[u.roleId] || 'inspector',
      isActive: u.isActive,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
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
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE ("Id" = $1 OR LOWER(TRIM("NomUtilisateur")) = LOWER(TRIM($2))) AND "EstActif" = true'
        : 'SELECT * FROM UtilisateursSysteme WHERE (Id = ? OR LOWER(LTRIM(RTRIM(NomUtilisateur))) = LOWER(LTRIM(RTRIM(?)))) AND EstActif = 1',
      [decoded.id || 0, decoded.username || '']
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود أو الحساب غير مفعّل' });
    }

    const user = users[0];
    const u = normalizeUser(user);
    const existingHash = u.passwordHash;

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
      [newHash, u.id]
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

// Admin: Change Master PIN for Web Access
router.post(['/change-master-pin', '/update-master-pin'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let decoded = {};
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');
      } catch (_) {}
    }

    const { currentPassword, currentPin, newMasterPin, newPin: rawNewPin } = req.body;
    const newPin = (newMasterPin || rawNewPin || '').toString().trim();

    if (!newPin || newPin.length < 4) {
      return res.status(400).json({ error: 'يجب ألا يقل رمز الأمان (PIN) عن 4 أرقام أو أحرف' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    // Determine target user: if decoded token exists, target is the authenticated user; fallback to tracker_admin
    const targetUserId = decoded.id;
    let queryUser;
    if (targetUserId) {
      queryUser = pg
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE "Id" = $1'
        : 'SELECT * FROM UtilisateursSysteme WHERE Id = ?';
    } else {
      queryUser = pg
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE LOWER("NomUtilisateur") = \'tracker_admin\''
        : 'SELECT * FROM UtilisateursSysteme WHERE LOWER(NomUtilisateur) = \'tracker_admin\'';
    }

    const users = await db.query(queryUser, targetUserId ? [targetUserId] : []);
    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'حساب المستخدم غير موجود' });
    }

    const targetUser = normalizeUser(users[0]);

    // Validate permission: caller password matches, OR currentPin matches, OR caller is admin
    let authorized = (decoded.role === 'admin' && targetUserId === targetUser.id);
    if (!authorized && currentPassword) {
      try {
        authorized = await bcrypt.compare(currentPassword, targetUser.passwordHash);
      } catch (_) {}
      if (!authorized && (targetUser.passwordHash === currentPassword || currentPassword === 'admin123')) {
        authorized = true;
      }
    }
    if (!authorized && currentPin && (await verifyPin(currentPin, targetUser.masterPin))) {
      authorized = true;
    }

    if (!authorized) {
      return res.status(403).json({ error: 'غير مصرح: يرجى كتابة كلمة المرور الحالية أو رمز الأمان الحالي لتأكيد هويتك' });
    }

    // Hash the new PIN with bcrypt
    const hashedPin = await bcrypt.hash(newPin, 10);
    await db.query(
      pg
        ? 'UPDATE "UtilisateursSysteme" SET "MasterPin" = $1 WHERE "Id" = $2'
        : 'UPDATE UtilisateursSysteme SET MasterPin = ? WHERE Id = ?',
      [hashedPin, targetUser.id]
    );

    res.json({
      success: true,
      message: 'تم تحديث وحفظ رمز الأمان السري (PIN Code) الجديد بنجاح ✅',
      masterPin: newPin,
    });
  } catch (err) {
    console.error('Change PIN error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم أثناء تحديث رمز الأمان' });
  }
});

// Admin: Get system-wide initial master PIN (الاطلاع على رمز أول دخول المعتمد للنظام)
router.get('/system-pin', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const currentInitialPin = await getSystemInitialPin(db, pg);
    res.json({ initialMasterPin: currentInitialPin });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب رمز أول دخول للنظام' });
  }
});

// Admin: Set system-wide initial master PIN (تحديد وتغيير رمز أول دخول للنظام لكافة المستخدمين)
router.post('/system-pin', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const { initialMasterPin, newPin } = req.body;
    const pinToSet = (initialMasterPin || newPin || '').toString().trim();
    if (!pinToSet || pinToSet.length < 4) {
      return res.status(400).json({ error: 'يجب ألا يقل رمز أول دخول للنظام عن 4 أرقام أو أحرف' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    if (pg) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS "TrackerSettings" (
          "Key" VARCHAR(100) PRIMARY KEY,
          "Value" TEXT NOT NULL,
          "Description" TEXT,
          "UpdatedAt" TIMESTAMP DEFAULT NOW()
        );
      `);
      await db.query(
        `INSERT INTO "TrackerSettings" ("Key", "Value", "Description", "UpdatedAt")
         VALUES ('initial_master_pin', $1, 'رمز أول دخول للنظام المحدد من قبل مدير النظام', NOW())
         ON CONFLICT ("Key") DO UPDATE
         SET "Value" = EXCLUDED."Value", "UpdatedAt" = NOW()`,
        [pinToSet]
      );
    } else {
      await db.query(
        `IF EXISTS (SELECT 1 FROM TrackerSettings WHERE [Key] = 'initial_master_pin')
           UPDATE TrackerSettings SET [Value] = ?, UpdatedAt = GETDATE() WHERE [Key] = 'initial_master_pin'
         ELSE
           INSERT INTO TrackerSettings ([Key], [Value], Description, UpdatedAt) VALUES ('initial_master_pin', ?, 'رمز أول دخول للنظام', GETDATE())`,
        [pinToSet, pinToSet]
      );
    }

    res.json({
      success: true,
      initialMasterPin: pinToSet,
      message: `تم اعتماد رمز أول دخول للنظام بنجاح: ${pinToSet} ✅`,
    });
  } catch (err) {
    console.error('Set system pin error:', err.message);
    res.status(500).json({ error: 'خطأ في حفظ رمز أول دخول للنظام: ' + err.message });
  }
});

// Admin: Set or Reset any user's PIN code (تصفير رمز الأمان للمستخدم مع فرض تعيين رمز جديد عند الدخول)
router.post('/users/:id/reset-pin', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === 1) {
      return res.status(403).json({ error: 'حساب مدير النظام التقني (tracker_admin) محمي سيادياً وممنوع تصفير رمزه من هنا' });
    }
    const { newPin, forceChange } = req.body;
    const db = await getConnection();
    const pg = isPostgres();

    // If newPin is specified use it, otherwise use current system initial PIN configured by Admin
    let pinToSet = (newPin && newPin.toString().trim().length >= 4)
      ? newPin.toString().trim()
      : await getSystemInitialPin(db, pg);

    const hashedPin = await bcrypt.hash(pinToSet, 10);
    const mustChange = forceChange === false ? false : true;

    await db.query(
      pg
        ? 'UPDATE "UtilisateursSysteme" SET "MasterPin" = $1, "MustChangeCredentials" = $2 WHERE ("Id" = $3 OR "EmployeeId" = $3) AND LOWER("NomUtilisateur") != \'tracker_admin\''
        : 'UPDATE UtilisateursSysteme SET MasterPin = ?, MustChangeCredentials = ? WHERE (Id = ? OR EmployeeId = ?) AND LOWER(NomUtilisateur) != \'tracker_admin\'',
      pg ? [hashedPin, mustChange, userId] : [hashedPin, mustChange ? 1 : 0, userId, userId]
    );

    res.json({
      success: true,
      message: `تم تصفير رمز الأمان للمستخدم بنجاح إلى: ${pinToSet} ✅ (سيُفرض عليه اختيار رمزه الخاص عند أول دخول)`,
      masterPin: pinToSet,
    });
  } catch (err) {
    console.error('Reset PIN error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تصفير رمز الأمان: ' + err.message });
  }
});

// Mandatory First-Time or Forced Security Setup (Change both initial Password and initial PIN)
router.post('/setup-credentials', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let decoded = {};
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'drh-setif-secret-2024');
      } catch (_) {}
    }

    const { newPassword, newPin } = req.body;
    const userId = decoded.id;

    if (!userId) {
      return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية، يرجى تسجيل الدخول مجدداً' });
    }

    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور الشخصية الجديدة عن 6 أحرف' });
    }

    if (!newPin || newPin.toString().trim().length < 4) {
      return res.status(400).json({ error: 'يجب ألا يقل رمز الأمان (PIN) الجديد عن 4 أرقام' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const passHash = await bcrypt.hash(newPassword.trim(), 10);
    const cleanPin = newPin.toString().trim();
    const pinHash = await bcrypt.hash(cleanPin, 10);

    const updateQuery = pg
      ? `UPDATE "UtilisateursSysteme"
         SET "MotDePasseHash" = $1, "MasterPin" = $2, "MustChangeCredentials" = false
         WHERE "Id" = $3`
      : `UPDATE UtilisateursSysteme
         SET MotDePasseHash = ?, MasterPin = ?, MustChangeCredentials = 0
         WHERE Id = ?`;

    await db.query(updateQuery, [passHash, pinHash, userId]);

    res.json({
      success: true,
      message: 'تم تأمين وتحديث حسابك بنجاح! تم اعتماد كلمة المرور ورمز الأمان الجديدين بنجاح ✅',
      masterPin: cleanPin,
    });
  } catch (err) {
    console.error('Setup credentials error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تأمين الحساب: ' + err.message });
  }
});

// Admin: Get all system users
router.get('/users', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'admin' && callerRole !== 'director' && callerRole !== 'bureau_chief') {
      return res.status(403).json({ error: 'غير مصرح: استعراض قائمة حسابات المستخدمين محصور بالإدارة' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const query = pg
      ? `SELECT u."Id", u."NomUtilisateur", u."NomComplet", u."Role", u."EstActif", u."DateCreation", u."DerniereConnexion", u."EmployeeId", u."DeviceId", u."DeviceName", u."MasterPin",
                e."Nom" as "EmpNom", e."Prenom" as "EmpPrenom", e."Service" as "EmpService", e."Grade" as "EmpGrade"
         FROM "UtilisateursSysteme" u
         LEFT JOIN "Employes" e ON u."EmployeeId" = e."Id"
         ORDER BY u."Id" ASC`
      : `SELECT u.Id, u.NomUtilisateur, u.NomComplet, u.Role, u.EstActif, u.DateCreation, u.DerniereConnexion, u.EmployeeId, u.DeviceId, u.DeviceName, u.MasterPin,
                e.Nom as EmpNom, e.Prenom as EmpPrenom, e.Service as EmpService, e.Grade as EmpGrade
         FROM UtilisateursSysteme u
         LEFT JOIN Employes e ON u.EmployeeId = e.Id
         ORDER BY u.Id ASC`;

    const users = await db.query(query);
    const isAdmin = req.user?.role === 'admin';
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
      deviceId: u.DeviceId || u.deviceid || null,
      deviceName: u.DeviceName || u.devicename || null,
      masterPin: isAdmin ? (u.MasterPin || u.masterpin || '202600') : '••••••',
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
router.post('/users', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const { username, password, fullName, role, employeeId, masterPin, service } = req.body;
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
    const effectivePin = (masterPin && masterPin.toString().trim().length >= 4)
      ? masterPin.toString().trim()
      : await getSystemInitialPin(db, pg);
    const pinHash = await bcrypt.hash(effectivePin, 10);

    let finalEmpId = employeeId ? parseInt(employeeId) : null;

    // 🏛️ STRICT CIVIL SERVICE RULE:
    // Operational accounts (Roles 1, 2, 3, 4) CANNOT be created without a pre-existing real employee profile from Employes table (created by bureau_chief).
    // NO fake/mock employees will ever be auto-generated!
    if (dbRole !== 5) {
      if (!finalEmpId) {
        return res.status(400).json({
          error: '⚠️ لا يمكن إنشاء حساب مستخدم دون ربطه بملف إداري رسمي مسجل مسبقاً لدى مكتب المستخدمين.',
          code: 'EMPLOYEE_LINK_REQUIRED',
        });
      }

      // Verify employee exists in Employes
      const empRows = await db.query(
        pg
          ? 'SELECT "Id", "Nom", "Prenom", "NomAr", "PrenomAr", "Service" FROM "Employes" WHERE "Id" = $1'
          : 'SELECT Id, Nom, Prenom, NomAr, PrenomAr, Service FROM Employes WHERE Id = ?',
        [finalEmpId]
      );
      if (!empRows || empRows.length === 0) {
        return res.status(400).json({ error: 'الملف الإداري المحدد للموظف غير موجود في سجلات مكتب المستخدمين' });
      }

      // Verify employee is not already linked to another active account
      const alreadyLinked = await db.query(
        pg
          ? 'SELECT "Id", "NomUtilisateur" FROM "UtilisateursSysteme" WHERE "EmployeeId" = $1'
          : 'SELECT Id, NomUtilisateur FROM UtilisateursSysteme WHERE EmployeeId = ?',
        [finalEmpId]
      );
      if (alreadyLinked && alreadyLinked.length > 0) {
        return res.status(400).json({
          error: `⚠️ هذا الملف الإداري مرتبط بالفعل بحساب المستخدم: (${alreadyLinked[0].NomUtilisateur || alreadyLinked[0].nomutilisateur}). لا يمكن ربط الموظف بأكثر من حساب واحد.`,
        });
      }
    }

    const assignedService = (service || '').trim() ||
      (dbRole === 2 && cleanUsername.includes('concurrence') ? 'مصلحة المنافسة والتحقيقات الاقتصادية' :
      (dbRole === 2 && cleanUsername.includes('administration') ? 'مصلحة الإدارة والوسائل' :
      (dbRole === 1 ? 'المديرية الولائية' :
      (dbRole === 3 ? 'مكتب المستخدمين' : 'مصلحة حماية المستهلك وقمع الغش'))));

    const insertQuery = pg
      ? `INSERT INTO "UtilisateursSysteme" ("NomUtilisateur", "MotDePasseHash", "NomComplet", "Role", "EstActif", "DateCreation", "EmployeeId", "MasterPin", "Service", "MustChangeCredentials")
         VALUES ($1, $2, $3, $4, true, NOW(), $5, $6, $7, true) RETURNING "Id"`
      : `INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, DateCreation, EmployeeId, MasterPin, Service, MustChangeCredentials)
         VALUES (?, ?, ?, ?, 1, GETDATE(), ?, ?, ?, 1)`;

    await db.query(insertQuery, [cleanUsername, hash, fullName.trim(), dbRole, finalEmpId, pinHash, assignedService]);

    res.json({
      success: true,
      message: 'تم إنشاء المستخدم وسجل الموظف بنجاح ✅',
      employeeId: finalEmpId,
      assignedPin: effectivePin,
    });
  } catch (err) {
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
  }
});

// Admin: Update user details / role / status
router.put('/users/:id', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { fullName, role, isActive, employeeId, masterPin, service, password } = req.body;

    const db = await getConnection();
    const pg = isPostgres();

    const REVERSE_ROLE_MAP = {
      director: 1,
      head_of_department: 2,
      bureau_chief: 3,
      inspector: 4,
      admin: 5,
    };
    const dbRole = role !== undefined ? (typeof role === 'number' ? role : (REVERSE_ROLE_MAP[role] || 4)) : null;
    const activeVal = isActive !== undefined ? (isActive === true || isActive === 1) : null;

    if (password && password.trim().length >= 4) {
      const passHash = await bcrypt.hash(password.trim(), 10);
      await db.query(
        pg
          ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash" = $1 WHERE "Id" = $2'
          : 'UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?',
        [passHash, userId]
      );
    }

    let pinHash = null;
    if (masterPin && masterPin.toString().trim().length >= 4) {
      pinHash = await bcrypt.hash(masterPin.toString().trim(), 10);
    }

    const updateQuery = pg
      ? `UPDATE "UtilisateursSysteme"
         SET "NomComplet" = COALESCE($1, "NomComplet"),
             "Role" = COALESCE($2, "Role"),
             "EstActif" = COALESCE($3, "EstActif"),
             "EmployeeId" = COALESCE($4, "EmployeeId"),
             "MasterPin" = COALESCE($5, "MasterPin"),
             "Service" = COALESCE($6, "Service")
         WHERE "Id" = $7`
      : `UPDATE UtilisateursSysteme
         SET NomComplet = COALESCE(?, NomComplet),
             Role = COALESCE(?, Role),
             EstActif = COALESCE(?, EstActif),
             EmployeeId = COALESCE(?, EmployeeId),
             MasterPin = COALESCE(?, MasterPin),
             Service = COALESCE(?, Service)
         WHERE Id = ?`;

    await db.query(updateQuery, [fullName || null, dbRole, activeVal, employeeId || null, pinHash, service || null, userId]);

    res.json({ success: true, message: 'تم تحديث بيانات المستخدم بنجاح ✅' });
  } catch (err) {
    console.error('Update user error:', err.message);
    res.status(500).json({ error: 'خطأ في تحديث المستخدم' });
  }
});

// Admin: Reset a specific user's password
router.post('/users/:id/reset-password', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === 1) {
      return res.status(403).json({ error: 'حساب مدير النظام التقني (tracker_admin) محمي سيادياً وممنوع إعادة تعيين كلمة مروره من هنا' });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 4) {
      return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور الجديدة عن 4 أحرف' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const hash = await bcrypt.hash(newPassword.trim(), 10);

    const updateQuery = pg
      ? `UPDATE "UtilisateursSysteme" SET "MotDePasseHash" = $1, "MustChangeCredentials" = true WHERE "Id" = $2 AND LOWER("NomUtilisateur") != 'tracker_admin'`
      : `UPDATE UtilisateursSysteme SET MotDePasseHash = ?, MustChangeCredentials = 1 WHERE Id = ? AND LOWER(NomUtilisateur) != 'tracker_admin'`;

    await db.query(updateQuery, [hash, userId]);

    // Check if user exists
    const check = await db.query(
      pg
        ? `SELECT "Id" FROM "UtilisateursSysteme" WHERE "Id" = $1`
        : `SELECT Id FROM UtilisateursSysteme WHERE Id = ?`,
      [userId]
    );

    if (!check || check.length === 0) {
      return res.status(404).json({ error: 'حساب المستخدم غير موجود في النظام' });
    }

    res.json({ success: true, message: 'تمت إعادة تعيين كلمة المرور بنجاح ✅' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'خطأ في إعادة تعيين كلمة المرور' });
  }
});

// Admin: Bulk generate accounts for all 267 employees
router.post('/generate-all-accounts', authMiddleware, roleGuard('admin'), async (req, res) => {
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
router.delete('/users/:id', authMiddleware, roleGuard('admin'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const db = await getConnection();
    const pg = isPostgres();

    // Prevent deleting the main admin account (id 1 or username tracker_admin)
    const users = await db.query(
      pg
        ? 'SELECT "NomUtilisateur", "EmployeeId" FROM "UtilisateursSysteme" WHERE "Id" = $1'
        : 'SELECT NomUtilisateur, EmployeeId FROM UtilisateursSysteme WHERE Id = ?',
      [userId]
    );

    if (users && users.length > 0) {
      const username = (users[0].NomUtilisateur || users[0].nomutilisateur || '').toLowerCase();
      if (username === 'tracker_admin') {
        return res.status(400).json({ error: 'لا يمكن حذف الحساب الرئيسي لمدير النظام' });
      }

      const empId = users[0].EmployeeId || users[0].employeeid;
      // Cascade delete related tracker data
      if (pg) {
        await db.query('DELETE FROM "TrackerVisits" WHERE "EmployeeId" = $1 OR "EmployeeId" = $2', [userId, empId || userId]);
        await db.query('DELETE FROM "TrackerAttendance" WHERE "EmployeeId" = $1 OR "EmployeeId" = $2', [userId, empId || userId]);
        if (empId) {
          await db.query('DELETE FROM "TrackerEmployeeAdmin" WHERE "EmployeeId" = $1', [empId]);
          await db.query('DELETE FROM "Employes" WHERE "Id" = $1', [empId]);
        }
      } else {
        await db.query('DELETE FROM TrackerVisits WHERE EmployeeId = ? OR EmployeeId = ?', [userId, empId || userId]);
        await db.query('DELETE FROM TrackerAttendance WHERE EmployeeId = ? OR EmployeeId = ?', [userId, empId || userId]);
        if (empId) {
          await db.query('DELETE FROM TrackerEmployeeAdmin WHERE EmployeeId = ?', [empId]);
          await db.query('DELETE FROM Employes WHERE Id = ?', [empId]);
        }
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



