const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { getTodayAlgeria } = require('../utils/dateUtils');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { date, employeeId } = req.query;

    let query = pg_q(pg,
      `SELECT ta."Id", ta."EmployeeId", ta."Date", ta."CheckInTime", ta."CheckOutTime",
              ta."CheckInLocation", ta."CheckOutLocation",
              ta."CheckInLatitude", ta."CheckInLongitude",
              ta."CheckOutLatitude", ta."CheckOutLongitude",
              ta."IsCheckedOut", ta."Notes", ta."CreatedAt",
              e."Nom", e."Prenom", e."NomAr", e."PrenomAr", e."Grade", e."Service"
       FROM "TrackerAttendance" ta
       JOIN "Employes" e ON ta."EmployeeId" = e."Id"`,
      `SELECT ta.Id, ta.EmployeeId, ta.Date, ta.CheckInTime, ta.CheckOutTime,
              ta.CheckInLocation, ta.CheckOutLocation,
              ta.CheckInLatitude, ta.CheckInLongitude,
              ta.CheckOutLatitude, ta.CheckOutLongitude,
              ta.IsCheckedOut, ta.Notes, ta.CreatedAt,
              e.Nom, e.Prenom, e.NomAr, e.PrenomAr, e.Grade, e.Service
       FROM TrackerAttendance ta
       JOIN Employes e ON ta.EmployeeId = e.Id`
    );
    const conditions = [];
    const params = [];

    if (date) {
      conditions.push(pg ? `ta."Date" = $${params.length + 1}` : 'ta.Date = ?');
      params.push(date);
    }
    if (employeeId) {
      conditions.push(pg ? `ta."EmployeeId" = $${params.length + 1}` : 'ta.EmployeeId = ?');
      params.push(parseInt(employeeId));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += pg ? ' ORDER BY ta."CheckInTime" DESC' : ' ORDER BY ta.CheckInTime DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get attendance error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب البيانات' });
  }
});

router.get('/map-data', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const allEmployees = await db.query(
      pg
        ? `SELECT e."Id", e."NomAr", e."PrenomAr", e."Nom", e."Prenom", 
                  COALESCE(a."AssignedDepartment", e."Service") as "Service", 
                  e."Grade",
                  COALESCE(a."AdministrativeStatus", 'active') as "AdministrativeStatus",
                  COALESCE(a."IsBrigadeLeader", false) as "IsBrigadeLeader",
                  a."BrigadeName"
           FROM "Employes" e
           LEFT JOIN "TrackerEmployeeAdmin" a ON e."Id" = a."EmployeeId"
           WHERE e."EstActif" = true`
        : `SELECT e.Id, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, 
                  COALESCE(a.AssignedDepartment, e.Service) as Service, 
                  e.Grade,
                  COALESCE(a.AdministrativeStatus, 'active') as AdministrativeStatus,
                  COALESCE(a.IsBrigadeLeader, 0) as IsBrigadeLeader,
                  a.BrigadeName
           FROM Employes e
           LEFT JOIN TrackerEmployeeAdmin a ON e.Id = a.EmployeeId
           WHERE e.EstActif = 1`
    );
    const targetEmployees = allEmployees.filter(e =>
      e.Service && TARGET_DEPARTMENTS.some(d => e.Service.includes(d))
    );

    const attendance = await db.query(
      pg
        ? `SELECT "EmployeeId","CheckInTime","CheckOutTime","IsCheckedOut","CheckInLatitude","CheckInLongitude","CheckInPhoto","Notes" FROM "TrackerAttendance" WHERE "Date" = $1`
        : 'SELECT EmployeeId,CheckInTime,CheckOutTime,IsCheckedOut,CheckInLatitude,CheckInLongitude,CheckInPhoto,Notes FROM TrackerAttendance WHERE Date = ?',
      [today]
    );

    const visits = await db.query(
      pg
        ? `SELECT "Id","EmployeeId","CheckInTime","Latitude","Longitude","ShopName","ShopType","Photo","ViolationFound","Notes" FROM "TrackerVisits" WHERE "Date" = $1 ORDER BY "CheckInTime" ASC`
        : 'SELECT Id,EmployeeId,CheckInTime,Latitude,Longitude,ShopName,ShopType,Photo,ViolationFound,Notes FROM TrackerVisits WHERE Date = ? ORDER BY CheckInTime ASC',
      [today]
    );

    const attendanceMap = {};
    for (const a of attendance) {
      if (!attendanceMap[a.EmployeeId]) attendanceMap[a.EmployeeId] = a;
    }

    const visitsMap = {};
    for (const v of visits) {
      if (!visitsMap[v.EmployeeId]) visitsMap[v.EmployeeId] = [];
      visitsMap[v.EmployeeId].push({
        id: v.Id,
        time: v.CheckInTime,
        latitude: v.Latitude,
        longitude: v.Longitude,
        shopName: v.ShopName || 'معاينة ميدانية',
        shopType: v.ShopType,
        photo: v.Photo,
        violationFound: v.ViolationFound,
        notes: v.Notes,
      });
    }

    const result = targetEmployees.map(emp => {
      const att = attendanceMap[emp.Id];
      const empVisits = visitsMap[emp.Id] || [];
      const lastVisit = empVisits.length > 0 ? empVisits[empVisits.length - 1] : null;

      const isCheckedOut = att ? (att.IsCheckedOut === true || att.IsCheckedOut === 1) : false;
      const isNightDuty = emp.AdministrativeStatus === 'special_mission';

      // Strict Privacy Rule: If the employee checked out and is NOT on night duty, do not stream live coordinates
      const allowLiveTracking = att && (!isCheckedOut || isNightDuty);

      return {
        employeeId: emp.Id,
        name: emp.NomAr ? `${emp.NomAr} ${emp.PrenomAr}` : `${emp.Nom} ${emp.Prenom}`,
        service: emp.Service,
        grade: emp.Grade,
        administrativeStatus: emp.AdministrativeStatus || 'active',
        isBrigadeLeader: emp.IsBrigadeLeader === true || emp.IsBrigadeLeader === 1,
        brigadeName: emp.BrigadeName,
        isNightDuty: isNightDuty,
        hasCheckedIn: !!att,
        isCheckedOut: isCheckedOut,
        trackingStatus: isCheckedOut
            ? (isNightDuty ? 'مهمة تفتيش ليلية نشطة' : 'منصرف - التتبع معطل للخصوصية')
            : (att ? 'نشط في الخدمة الميدانية' : 'غير مسجل حضور'),
        checkInTime: att ? att.CheckInTime : null,
        checkOutTime: att ? att.CheckOutTime : null,
        latitude: allowLiveTracking ? (lastVisit ? lastVisit.latitude : (att ? att.CheckInLatitude : null)) : null,
        longitude: allowLiveTracking ? (lastVisit ? lastVisit.longitude : (att ? att.CheckInLongitude : null)) : null,
        checkInLatitude: allowLiveTracking && att ? att.CheckInLatitude : null,
        checkInLongitude: allowLiveTracking && att ? att.CheckInLongitude : null,
        checkInPhoto: att ? att.CheckInPhoto : null,
        notes: att ? att.Notes : null,
        visitsCount: empVisits.length,
        visits: empVisits,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Map data error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب بيانات الخريطة' });
  }
});

router.post('/checkin', async (req, res) => {
  try {
    const { employeeId, latitude, longitude, location, photo, notes } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'رقم الموظف مطلوب' });

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const existing = await db.query(
      pg
        ? `SELECT "Id" FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 AND "IsCheckedOut" = false`
        : 'SELECT Id FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [employeeId, today]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'الموظف مسجل حضوره بالفعل اليوم' });
    }

    await db.query(
      pg
        ? `INSERT INTO "TrackerAttendance" ("EmployeeId","Date","CheckInTime","CheckInLocation","CheckInLatitude","CheckInLongitude","CheckInPhoto","Notes","IsCheckedOut") VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,false)`
        : `INSERT INTO TrackerAttendance (EmployeeId,Date,CheckInTime,CheckInLocation,CheckInLatitude,CheckInLongitude,CheckInPhoto,Notes,IsCheckedOut) VALUES (?,?,GETDATE(),?,?,?,?,?,0)`,
      [employeeId, today, location || null, latitude || null, longitude || null, photo || null, notes || null]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );

    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Checkin error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الحضور' });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const { employeeId, latitude, longitude, location, notes } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'رقم الموظف مطلوب' });

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const existing = await db.query(
      pg
        ? `SELECT "Id" FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 AND "IsCheckedOut" = false`
        : 'SELECT Id FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [employeeId, today]
    );

    if (!existing || existing.length === 0) {
      return res.status(400).json({ error: 'لم يسجل الحضور بعد اليوم' });
    }

    await db.query(
      pg
        ? `UPDATE "TrackerAttendance" SET "CheckOutTime"=NOW(),"CheckOutLocation"=$1,"CheckOutLatitude"=$2,"CheckOutLongitude"=$3,"Notes"=COALESCE($4,"Notes"),"IsCheckedOut"=true WHERE "EmployeeId"=$5 AND "Date"=$6 AND "IsCheckedOut"=false`
        : `UPDATE TrackerAttendance SET CheckOutTime=GETDATE(),CheckOutLocation=?,CheckOutLatitude=?,CheckOutLongitude=?,Notes=COALESCE(?,Notes),IsCheckedOut=1 WHERE EmployeeId=? AND Date=? AND IsCheckedOut=0`,
      [location || null, latitude || null, longitude || null, notes || null, employeeId, today]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );

    res.json(result[0]);
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الانصراف' });
  }
});

router.post('/cancel-checkout', async (req, res) => {
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
    console.error('Cancel checkout error:', err.message);
    res.status(500).json({ error: 'خطأ في استئناف الدوام' });
  }
});

router.get('/today-self', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'غير مصرح' });
    }
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const user = await db.query(
      pg
        ? `SELECT "Id" FROM "UtilisateursSysteme" WHERE "NomUtilisateur" = $1`
        : 'SELECT Id FROM UtilisateursSysteme WHERE NomUtilisateur = ?',
      [decoded.username]
    );

    if (!user || user.length === 0) return res.json(null);

    const empId = decoded.employeeId || user[0].Id;

    const attendance = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ?',
      [empId, today]
    );

    res.json(attendance.length > 0 ? attendance[0] : null);
  } catch (err) {
    console.error('Get today-self error:', err.message);
    res.json(null);
  }
});

module.exports = router;
