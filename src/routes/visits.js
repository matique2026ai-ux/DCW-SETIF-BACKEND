const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { getTodayAlgeria } = require('../utils/dateUtils');

const router = express.Router();

const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { date, employeeId, isApproved } = req.query;

    let query = pg_q(pg,
      `SELECT tv."Id",tv."EmployeeId",tv."AssignmentId",tv."Date",tv."CheckInTime",tv."CheckOutTime",
              tv."Latitude",tv."Longitude",tv."Accuracy",tv."LocationName",
              tv."ShopName",tv."ShopType",tv."Photo",tv."Status",tv."Notes",
              tv."ViolationFound",tv."ViolationType",tv."ViolationNotes",
              tv."LegalAction",tv."SeizureValue",tv."IsApproved",tv."ApprovedBy",tv."ApprovedAt",
              tv."CreatedAt",
              e."NomAr",e."PrenomAr",e."Nom",e."Prenom",e."Service"
       FROM "TrackerVisits" tv
       JOIN "Employes" e ON tv."EmployeeId" = e."Id"`,
      `SELECT tv.*,e.NomAr,e.PrenomAr,e.Nom,e.Prenom,e.Service
       FROM TrackerVisits tv
       JOIN Employes e ON tv.EmployeeId = e.Id`
    );
    const conditions = [];
    const params = [];

    if (date) {
      conditions.push(pg ? `tv."Date" = $${params.length + 1}` : 'tv.Date = ?');
      params.push(date);
    }
    if (employeeId) {
      conditions.push(pg ? `tv."EmployeeId" = $${params.length + 1}` : 'tv.EmployeeId = ?');
      params.push(parseInt(employeeId));
    }
    if (isApproved !== undefined) {
      const boolVal = isApproved === 'true' || isApproved === true;
      conditions.push(pg ? `tv."IsApproved" = $${params.length + 1}` : 'tv.IsApproved = ?');
      params.push(boolVal);
    }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += pg ? ' ORDER BY tv."CheckInTime" DESC' : ' ORDER BY tv.CheckInTime DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get visits error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب الزيارات' });
  }
});

router.get('/today', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();
    const { employeeId } = req.query;

    let query = pg_q(pg,
      `SELECT tv."Id",tv."EmployeeId",tv."Date",tv."CheckInTime",tv."CheckOutTime",
              tv."Latitude",tv."Longitude",tv."Accuracy",tv."LocationName",
              tv."ShopName",tv."ShopType",tv."Photo",tv."Status",tv."Notes",
              tv."ViolationFound",tv."ViolationType",tv."ViolationNotes",
              tv."LegalAction",tv."SeizureValue",tv."IsApproved",tv."ApprovedBy",tv."ApprovedAt",
              tv."CreatedAt",
              e."NomAr",e."PrenomAr",e."Nom",e."Prenom",e."Service"
       FROM "TrackerVisits" tv
       LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
       WHERE tv."Date" = $1`,
      `SELECT tv.*,e.NomAr,e.PrenomAr,e.Nom,e.Prenom,e.Service
       FROM TrackerVisits tv
       LEFT JOIN Employes e ON tv.EmployeeId = e.Id
       WHERE tv.Date = ?`
    );
    const params = [today];

    if (employeeId) {
      query += pg ? ` AND tv."EmployeeId" = $${params.length + 1}` : ' AND tv.EmployeeId = ?';
      params.push(parseInt(employeeId));
    }

    query += pg ? ' ORDER BY tv."CheckInTime" DESC' : ' ORDER BY tv.CheckInTime DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get today visits error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب زيارات اليوم' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      employeeId, latitude, longitude, accuracy, locationName,
      shopName, shopType, photo, assignmentId, notes,
      violationFound, violationType, violationNotes,
      legalAction, seizureValue
    } = req.body;
    if (!employeeId || !latitude || !longitude) {
      return res.status(400).json({ error: 'البيانات المطلوبة: employeeId, latitude, longitude' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();
    const hasViolation = violationFound === true || violationFound === 'true';
    const sValue = parseFloat(seizureValue) || 0;

    await db.query(
      pg
        ? `INSERT INTO "TrackerVisits" (
            "EmployeeId","AssignmentId","Date","Latitude","Longitude","Accuracy",
            "LocationName","ShopName","ShopType","Photo","Notes","Status",
            "ViolationFound","ViolationType","ViolationNotes","LegalAction","SeizureValue"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed',$12,$13,$14,$15,$16)`
        : `INSERT INTO TrackerVisits (
            EmployeeId,AssignmentId,Date,Latitude,Longitude,Accuracy,
            LocationName,ShopName,ShopType,Photo,Notes,Status,
            ViolationFound,ViolationType,ViolationNotes,LegalAction,SeizureValue
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'completed',?,?,?,?,?)`,
      [
        employeeId, assignmentId || null, today, latitude, longitude, accuracy || null,
        locationName || null, shopName || null, shopType || null, photo || null, notes || null,
        hasViolation, violationType || null, violationNotes || null, legalAction || null, sValue
      ]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerVisits" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerVisits WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );

    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Create visit error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الزيارة: ' + err.message });
  }
});

router.post('/:id/checkout', async (req, res) => {
  try {
    const { violationFound, violationType, violationNotes, notes, legalAction, seizureValue } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    const sValue = parseFloat(seizureValue) || 0;

    await db.query(
      pg
        ? `UPDATE "TrackerVisits" SET "CheckOutTime"=NOW(),"Status"='completed',
           "ViolationFound"=$1,"ViolationType"=$2,"ViolationNotes"=$3,
           "LegalAction"=$4,"SeizureValue"=$5,
           "Notes"=COALESCE($6,"Notes") WHERE "Id"=$7`
        : `UPDATE TrackerVisits SET CheckOutTime=GETDATE(),Status='completed',
           ViolationFound=?,ViolationType=?,ViolationNotes=?,
           LegalAction=?,SeizureValue=?,
           Notes=ISNULL(?,Notes) WHERE Id=?`,
      [violationFound ? true : false, violationType || null, violationNotes || null, legalAction || null, sValue, notes || null, req.params.id]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerVisits" WHERE "Id" = $1`
        : 'SELECT * FROM TrackerVisits WHERE Id = ?',
      [req.params.id]
    );
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنهاء الزيارة' });
  }
});

// Approve / Stamp a visit (رئيس المصلحة أو رئيس المفتشية أو المدير)
router.post('/:id/approve', async (req, res) => {
  try {
    const { approvedBy } = req.body;
    const db = await getConnection();
    const pg = isPostgres();

    await db.query(
      pg
        ? `UPDATE "TrackerVisits" SET "IsApproved"=true, "ApprovedBy"=$1, "ApprovedAt"=NOW() WHERE "Id"=$2`
        : `UPDATE TrackerVisits SET IsApproved=1, ApprovedBy=?, ApprovedAt=GETDATE() WHERE Id=?`,
      [approvedBy || 'رئيس المصلحة المختصة', req.params.id]
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
      visit: result[0],
    });
  } catch (err) {
    console.error('Approve visit error:', err.message);
    res.status(500).json({ error: 'خطأ في تأشير المعاينة' });
  }
});

router.get('/employee/:employeeId/summary', async (req, res) => {
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

module.exports = router;

