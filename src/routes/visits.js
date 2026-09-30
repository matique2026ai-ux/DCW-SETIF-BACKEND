const express = require('express');
const jwt = require('jsonwebtoken');
const { getConnection, isPostgres } = require('../config/database');
const { getTodayAlgeria } = require('../utils/dateUtils');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const {
  encryptText,
  decryptVisitRecord,
  decryptVisitsList,
  generatePvSeal,
  verifyPvSeal,
} = require('../utils/cryptoUtils');

const router = express.Router();

const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { date, employeeId, isApproved } = req.query;

    let query = pg_q(pg,
      `SELECT tv.*,
              COALESCE(e."NomAr", u."NomComplet", 'مفتش ميداني') as "NomAr",
              COALESCE(e."PrenomAr", '') as "PrenomAr",
              COALESCE(e."Nom", u."NomUtilisateur", 'Inspecteur') as "Nom",
              COALESCE(e."Prenom", '') as "Prenom",
              COALESCE(e."Service", u."Service", 'مصلحة حماية المستهلك وقمع الغش') as "Service"
       FROM "TrackerVisits" tv
       LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
       LEFT JOIN "UtilisateursSysteme" u ON (tv."EmployeeId" = u."Id" OR tv."EmployeeId" = u."EmployeeId")`,
      `SELECT tv.*,
              COALESCE(e.NomAr, u.NomComplet, 'مفتش ميداني') as NomAr,
              COALESCE(e.PrenomAr, '') as PrenomAr,
              COALESCE(e.Nom, u.NomUtilisateur, 'Inspecteur') as Nom,
              COALESCE(e.Prenom, '') as Prenom,
              COALESCE(e.Service, u.Service, 'مصلحة حماية المستهلك وقمع الغش') as Service
       FROM TrackerVisits tv
       LEFT JOIN Employes e ON tv.EmployeeId = e.Id
       LEFT JOIN UtilisateursSysteme u ON (tv.EmployeeId = u.Id OR tv.EmployeeId = u.EmployeeId)`
    );
    const conditions = [];
    const params = [];

    if (date) {
      conditions.push(pg ? `tv."Date" = $${params.length + 1}` : 'tv.Date = ?');
      params.push(date);
    }
    if (employeeId) {
      const pIdx = params.length + 1;
      conditions.push(pg
        ? `(tv."EmployeeId" = $${pIdx} OR u."Id" = $${pIdx} OR u."EmployeeId" = $${pIdx})`
        : `(tv.EmployeeId = ? OR u.Id = ? OR u.EmployeeId = ?)`);
      params.push(parseInt(employeeId));
      if (!pg) {
        params.push(parseInt(employeeId));
        params.push(parseInt(employeeId));
      }
    }
    if (isApproved !== undefined) {
      const boolVal = isApproved === 'true' || isApproved === true;
      conditions.push(pg ? `tv."IsApproved" = $${params.length + 1}` : 'tv.IsApproved = ?');
      params.push(boolVal);
    }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += pg ? ' ORDER BY tv."CheckInTime" DESC' : ' ORDER BY tv.CheckInTime DESC';

    const result = await db.query(query, params);
    res.json(decryptVisitsList(result));
  } catch (err) {
    console.error('Get visits error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب الزيارات' });
  }
});

router.get('/today', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();
    const { employeeId } = req.query;

    let query = pg_q(pg,
      `SELECT tv.*,
              COALESCE(e."NomAr", u."NomComplet", 'مفتش ميداني') as "NomAr",
              COALESCE(e."PrenomAr", '') as "PrenomAr",
              COALESCE(e."Nom", u."NomUtilisateur", 'Inspecteur') as "Nom",
              COALESCE(e."Prenom", '') as "Prenom",
              COALESCE(e."Service", u."Service", 'مصلحة حماية المستهلك وقمع الغش') as "Service"
       FROM "TrackerVisits" tv
       LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
       LEFT JOIN "UtilisateursSysteme" u ON (tv."EmployeeId" = u."Id" OR tv."EmployeeId" = u."EmployeeId")
       WHERE tv."Date" = $1`,
      `SELECT tv.*,
              COALESCE(e.NomAr, u.NomComplet, 'مفتش ميداني') as NomAr,
              COALESCE(e.PrenomAr, '') as PrenomAr,
              COALESCE(e.Nom, u.NomUtilisateur, 'Inspecteur') as Nom,
              COALESCE(e.Prenom, '') as Prenom,
              COALESCE(e.Service, u.Service, 'مصلحة حماية المستهلك وقمع الغش') as Service
       FROM TrackerVisits tv
       LEFT JOIN Employes e ON tv.EmployeeId = e.Id
       LEFT JOIN UtilisateursSysteme u ON (tv.EmployeeId = u.Id OR tv.EmployeeId = u.EmployeeId)
       WHERE tv.Date = ?`
    );
    const params = [today];

    if (employeeId) {
      const pIdx = params.length + 1;
      query += pg
        ? ` AND (tv."EmployeeId" = $${pIdx} OR u."Id" = $${pIdx} OR u."EmployeeId" = $${pIdx})`
        : ' AND (tv.EmployeeId = ? OR u.Id = ? OR u.EmployeeId = ?)';
      params.push(parseInt(employeeId));
      if (!pg) {
        params.push(parseInt(employeeId));
        params.push(parseInt(employeeId));
      }
    }

    query += pg ? ' ORDER BY tv."CheckInTime" DESC' : ' ORDER BY tv.CheckInTime DESC';

    const result = await db.query(query, params);
    res.json(decryptVisitsList(result));
  } catch (err) {
    console.error('Get today visits error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب زيارات اليوم' });
  }
});

// GET /api/visits/:id (استعراض تفاصيل محضر معاينة فردي مع فك التشفير والختم الرقمي)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const query = pg
      ? `SELECT tv.*,
                COALESCE(e."NomAr", u."NomComplet", 'مفتش ميداني') as "NomAr",
                COALESCE(e."PrenomAr", '') as "PrenomAr",
                COALESCE(e."Nom", u."NomUtilisateur", 'Inspecteur') as "Nom",
                COALESCE(e."Prenom", '') as "Prenom",
                COALESCE(e."Service", u."Service", 'مصلحة حماية المستهلك وقمع الغش') as "Service"
         FROM "TrackerVisits" tv
         LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
         LEFT JOIN "UtilisateursSysteme" u ON (tv."EmployeeId" = u."Id" OR tv."EmployeeId" = u."EmployeeId")
         WHERE tv."Id" = $1`
      : `SELECT tv.*,
                COALESCE(e.NomAr, u.NomComplet, 'مفتش ميداني') as NomAr,
                COALESCE(e.PrenomAr, '') as PrenomAr,
                COALESCE(e.Nom, u.NomUtilisateur, 'Inspecteur') as Nom,
                COALESCE(e.Prenom, '') as Prenom,
                COALESCE(e.Service, u.Service, 'مصلحة حماية المستهلك وقمع الغش') as Service
         FROM TrackerVisits tv
         LEFT JOIN Employes e ON tv.EmployeeId = e.Id
         LEFT JOIN UtilisateursSysteme u ON (tv.EmployeeId = u.Id OR tv.EmployeeId = u.EmployeeId)
         WHERE tv.Id = ?`;
    const result = await db.query(query, [req.params.id]);
    if (!result || result.length === 0) {
      return res.status(404).json({ error: 'محضر المعاينة غير موجود' });
    }
    res.json(decryptVisitRecord(result[0]));
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب تفاصيل المعاينة' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const caller = req.user;
    const {
      employeeId, EmployeeId,
      latitude, Latitude,
      longitude, Longitude,
      accuracy, Accuracy,
      locationName, LocationName, Location,
      shopName, ShopName, TraderName,
      shopType, ShopType, ActivityType,
      photo, Photo,
      assignmentId, AssignmentId,
      notes, Notes,
      violationFound, HasViolation, ViolationFound,
      violationType, ViolationType,
      violationNotes, ViolationNotes,
      legalAction, LegalAction,
      seizureValue, SeizureValue
    } = req.body;

    // 🛡️ Anti-Impersonation: Inspectors can only create records under their own verified employee identity
    let finalEmpId = caller.employeeId || caller.id;
    if (caller.role === 'admin' || caller.role === 'director' || caller.role === 'head_of_department') {
      finalEmpId = employeeId || EmployeeId || caller.employeeId || caller.id;
    }
    const finalLat = latitude !== undefined ? latitude : Latitude;
    const finalLng = longitude !== undefined ? longitude : Longitude;

    if (!finalEmpId || finalLat === undefined || finalLng === undefined) {
      return res.status(400).json({ error: 'البيانات المطلوبة: employeeId, latitude, longitude' });
    }

    const finalShopName = shopName || ShopName || TraderName || null;
    const finalShopType = shopType || ShopType || ActivityType || null;
    const finalLoc = locationName || LocationName || Location || null;
    const finalPhoto = photo || Photo || null;
    const finalNotes = notes || Notes || null;
    const finalViolationFound = violationFound === true || violationFound === 'true' || HasViolation === true || ViolationFound === true;
    const finalViolationType = violationType || ViolationType || null;
    const finalViolationNotes = violationNotes || ViolationNotes || null;
    const finalLegalAction = legalAction || LegalAction || null;
    const sValue = parseFloat(seizureValue || SeizureValue) || 0;

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const rawVisitTime = req.body.visitTime || req.body.createdAt || null;
    let visitTimestamp = null;
    if (rawVisitTime) {
      const parsedTime = new Date(rawVisitTime);
      if (!isNaN(parsedTime.getTime())) {
        visitTimestamp = parsedTime.toISOString();
      }
    }

    // 🔐 Compute HMAC Tamper-Proof Seal on authentic unencrypted data
    const pvSeal = generatePvSeal({
      employeeId: finalEmpId,
      date: today,
      shopName: finalShopName,
      violationType: finalViolationType,
      violationNotes: finalViolationNotes,
      seizureValue: sValue,
      legalAction: finalLegalAction,
    });

    // 🛡️ Military-grade AES-256-GCM encryption of sensitive data
    const encShopName = encryptText(finalShopName);
    const encLoc = encryptText(finalLoc);
    const encNotes = encryptText(finalNotes);
    const encViolationNotes = encryptText(finalViolationNotes);

    await db.query(
      pg
        ? `INSERT INTO "TrackerVisits" (
            "EmployeeId","AssignmentId","Date","Latitude","Longitude","Accuracy",
            "LocationName","ShopName","ShopType","Photo","Notes","Status",
            "ViolationFound","ViolationType","ViolationNotes","LegalAction","SeizureValue","CheckInTime",
            "DigitalSignature","IsEncrypted"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed',$12,$13,$14,$15,$16,COALESCE($17::timestamp, NOW()),$18,true)`
        : `INSERT INTO TrackerVisits (
            EmployeeId,AssignmentId,Date,Latitude,Longitude,Accuracy,
            LocationName,ShopName,ShopType,Photo,Notes,Status,
            ViolationFound,ViolationType,ViolationNotes,LegalAction,SeizureValue,CheckInTime,
            DigitalSignature,IsEncrypted
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'completed',?,?,?,?,?,ISNULL(?, GETDATE()),?,1)`,
      [
        finalEmpId, assignmentId || AssignmentId || null, today, finalLat, finalLng, accuracy || Accuracy || null,
        encLoc, encShopName, finalShopType, finalPhoto, encNotes,
        finalViolationFound, finalViolationType, encViolationNotes, finalLegalAction, sValue,
        visitTimestamp, pvSeal
      ]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerVisits" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerVisits WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [finalEmpId, today]
    );

    res.status(201).json(decryptVisitRecord(result[0]));
  } catch (err) {
    console.error('Create visit error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الزيارة: ' + err.message });
  }
});

router.post('/:id/checkout', authMiddleware, async (req, res) => {
  try {
    const {
      violationFound, ViolationFound, HasViolation,
      violationType, ViolationType,
      violationNotes, ViolationNotes,
      notes, Notes,
      legalAction, LegalAction,
      seizureValue, SeizureValue
    } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    const sValue = parseFloat(seizureValue || SeizureValue) || 0;
    const isViol = violationFound === true || violationFound === 'true' || ViolationFound === true || HasViolation === true;

    const encViolationNotes = (violationNotes !== undefined || ViolationNotes !== undefined)
      ? encryptText(violationNotes || ViolationNotes || null) : null;
    const encNotes = (notes !== undefined || Notes !== undefined)
      ? encryptText(notes || Notes || null) : null;

    await db.query(
      pg
        ? `UPDATE "TrackerVisits" SET "CheckOutTime"=NOW(),"Status"='completed',
           "ViolationFound"=$1,"ViolationType"=$2,"ViolationNotes"=COALESCE($3,"ViolationNotes"),
           "LegalAction"=$4,"SeizureValue"=$5,
           "Notes"=COALESCE($6,"Notes") WHERE "Id"=$7`
        : `UPDATE TrackerVisits SET CheckOutTime=GETDATE(),Status='completed',
           ViolationFound=?,ViolationType=?,ViolationNotes=ISNULL(?,ViolationNotes),
           LegalAction=?,SeizureValue=?,
           Notes=ISNULL(?,Notes) WHERE Id=?`,
      [isViol, violationType || ViolationType || null, encViolationNotes, legalAction || LegalAction || null, sValue, encNotes, req.params.id]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerVisits" WHERE "Id" = $1`
        : 'SELECT * FROM TrackerVisits WHERE Id = ?',
      [req.params.id]
    );
    res.json(decryptVisitRecord(result[0]));
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنهاء الزيارة' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const caller = req.user;
    const db = await getConnection();
    const pg = isPostgres();

    // 🔒 Immutability check: If visit is already officially approved, inspectors cannot alter it
    if (caller.role === 'inspector') {
      const existing = await db.query(
        pg ? 'SELECT "IsApproved", "EmployeeId" FROM "TrackerVisits" WHERE "Id" = $1' : 'SELECT IsApproved, EmployeeId FROM TrackerVisits WHERE Id = ?',
        [req.params.id]
      );
      if (existing && existing.length > 0) {
        const vRow = existing[0];
        if (vRow.IsApproved || vRow.isapproved) {
          return res.status(403).json({ error: 'عذراً: محضر المعاينة مؤشر ومصادق عليه رسمياً من الإدارة، وتعديله ممنوع قانوناً.' });
        }
      }
    }

    const {
      shopName, shopType, locationName,
      violationFound, violationType, violationNotes,
      legalAction, seizureValue, isApproved
    } = req.body;
    const sValue = parseFloat(seizureValue) || 0;

    const encShopName = shopName !== undefined ? encryptText(shopName) : null;
    const encLocationName = locationName !== undefined ? encryptText(locationName) : null;
    const encViolationNotes = violationNotes !== undefined ? encryptText(violationNotes) : null;

    await db.query(
      pg
        ? `UPDATE "TrackerVisits" SET 
           "ShopName"=COALESCE($1,"ShopName"),
           "ShopType"=COALESCE($2,"ShopType"),
           "LocationName"=COALESCE($3,"LocationName"),
           "ViolationFound"=COALESCE($4,"ViolationFound"),
           "ViolationType"=COALESCE($5,"ViolationType"),
           "ViolationNotes"=COALESCE($6,"ViolationNotes"),
           "LegalAction"=COALESCE($7,"LegalAction"),
           "SeizureValue"=COALESCE($8,"SeizureValue"),
           "IsApproved"=COALESCE($9,"IsApproved")
           WHERE "Id"=$10`
        : `UPDATE TrackerVisits SET 
           ShopName=ISNULL(?,ShopName),
           ShopType=ISNULL(?,ShopType),
           LocationName=ISNULL(?,LocationName),
           ViolationFound=ISNULL(?,ViolationFound),
           ViolationType=ISNULL(?,ViolationType),
           ViolationNotes=ISNULL(?,ViolationNotes),
           LegalAction=ISNULL(?,LegalAction),
           SeizureValue=ISNULL(?,SeizureValue),
           IsApproved=ISNULL(?,IsApproved)
           WHERE Id=?`,
      [encShopName, shopType || null, encLocationName, violationFound, violationType || null, encViolationNotes, legalAction || null, sValue, isApproved, req.params.id]
    );

    const result = await db.query(
      pg ? `SELECT * FROM "TrackerVisits" WHERE "Id" = $1` : 'SELECT * FROM TrackerVisits WHERE Id = ?',
      [req.params.id]
    );
    res.json(decryptVisitRecord(result[0]));
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تحديث بيانات المعاينة' });
  }
});

// Approve / Stamp a visit (رئيس المصلحة أو رئيس المفتشية أو المدير)
const handleApprove = async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'director' && callerRole !== 'head_of_department' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: تأشير ومصادقة محاضر المعاينة محصورة برؤساء المصالح والمدير الولائي فقط' });
    }

    const { approvedBy } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    const approverName = approvedBy || (req.user?.fullName ? `${req.user.fullName} (${callerRole === 'director' ? 'المدير الولائي' : 'رئيس المصلحة'})` : 'رئيس المصلحة المختصة');

    await db.query(
      pg
        ? `UPDATE "TrackerVisits" SET "IsApproved"=true, "ApprovedBy"=$1, "ApprovedAt"=NOW() WHERE "Id"=$2`
        : `UPDATE TrackerVisits SET IsApproved=1, ApprovedBy=?, ApprovedAt=GETDATE() WHERE Id=?`,
      [approverName, req.params.id]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerVisits" WHERE "Id" = $1`
        : 'SELECT * FROM TrackerVisits WHERE Id = ?',
      [req.params.id]
    );
    res.json({
      success: true,
      message: 'تم تأشير واعتماد المعاينة رسمياً بنجاح ✅',
      visit: decryptVisitRecord(result[0]),
    });
  } catch (err) {
    console.error('Approve visit error:', err.message);
    res.status(500).json({ error: 'خطأ في تأشير المعاينة' });
  }
};

router.post('/:id/approve', authMiddleware, handleApprove);
router.put('/:id/approve', authMiddleware, handleApprove);

router.get('/employee/:employeeId/summary', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { date } = req.query;
    const today = date || getTodayAlgeria();

    const visits = await db.query(
      pg
        ? `SELECT COUNT(*) as count FROM "TrackerVisits" WHERE "EmployeeId" = $1 AND "Date" = $2`
        : 'SELECT COUNT(*) as count FROM TrackerVisits WHERE EmployeeId = ? AND Date = ?',
      [req.params.employeeId, today]
    );

    const violations = await db.query(
      pg
        ? `SELECT COUNT(*) as count FROM "TrackerVisits" WHERE "EmployeeId" = $1 AND "Date" = $2 AND "ViolationFound" = true`
        : 'SELECT COUNT(*) as count FROM TrackerVisits WHERE EmployeeId = ? AND Date = ? AND ViolationFound = 1',
      [req.params.employeeId, today]
    );

    res.json({
      visitsToday: pg ? parseInt(visits[0].count) : visits[0].count,
      violationsFound: pg ? parseInt(violations[0].count) : violations[0].count,
      totalMinutes: 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// DELETE visit (حذف / إلغاء محضر معاينة - مقيد بالمدير ومدير النظام)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: حذف أو إلغاء محاضر المعاينة الرسمية محصور سيادياً بالسيد المدير الولائي أو مدير النظام' });
    }

    const { id } = req.params;
    const db = await getConnection();
    const pg = isPostgres();
    const numericId = parseInt(id, 10);
    if (isNaN(numericId) || numericId <= 0) {
      return res.status(400).json({ error: 'معرف المعاينة غير صالح' });
    }

    await db.query(
      pg ? 'DELETE FROM "TrackerVisits" WHERE "Id" = $1' : 'DELETE FROM TrackerVisits WHERE Id = ?',
      [numericId]
    );

    res.json({ success: true, message: 'تم حذف محضر المعاينة بنجاح ✅' });
  } catch (err) {
    console.error('Delete visit error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء حذف محضر المعاينة: ' + err.message });
  }
});

module.exports = router;

