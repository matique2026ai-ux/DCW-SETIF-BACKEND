const express = require('express');
const { getConnection } = require('../config/database');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const { date, employeeId } = req.query;

    let query = `
      SELECT ta.Id, ta.EmployeeId, ta.Date, ta.CheckInTime, ta.CheckOutTime,
             ta.CheckInLocation, ta.CheckOutLocation,
             ta.CheckInLatitude, ta.CheckInLongitude,
             ta.CheckOutLatitude, ta.CheckOutLongitude,
             ta.IsCheckedOut, ta.Notes, ta.CreatedAt,
             e.Nom, e.Prenom, e.NomAr, e.PrenomAr, e.Grade, e.Service
      FROM TrackerAttendance ta
      JOIN Employes e ON ta.EmployeeId = e.Id
    `;
    const conditions = [];
    const params = [];

    if (date) {
      conditions.push('ta.Date = ?');
      params.push(date);
    }
    if (employeeId) {
      conditions.push('ta.EmployeeId = ?');
      params.push(parseInt(employeeId));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY ta.CheckInTime DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get attendance error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب البيانات' });
  }
});

router.get('/locations', async (req, res) => {
  try {
    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    const result = await db.query(`
      SELECT
        ta.EmployeeId,
        ta.Date,
        ta.CheckInTime,
        ta.CheckOutTime,
        ta.IsCheckedOut,
        ta.CheckInLatitude,
        ta.CheckInLongitude,
        ta.CheckOutLatitude,
        ta.CheckOutLongitude,
        e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service, e.Grade
      FROM TrackerAttendance ta
      JOIN Employes e ON ta.EmployeeId = e.Id
      WHERE ta.Date = ? AND e.Service IN (?, ?)
      ORDER BY ta.CheckInTime DESC
    `, [today, ...TARGET_DEPARTMENTS]);

    const seen = new Map();
    for (const row of result) {
      if (!seen.has(row.EmployeeId)) {
        seen.set(row.EmployeeId, {
          employeeId: row.EmployeeId,
          name: row.NomAr ? `${row.NomAr} ${row.PrenomAr}` : `${row.Nom} ${row.Prenom}`,
          service: row.Service,
          grade: row.Grade,
          checkInTime: row.CheckInTime,
          checkOutTime: row.CheckOutTime,
          isCheckedOut: row.IsCheckedOut,
          latitude: row.CheckInLatitude,
          longitude: row.CheckInLongitude,
          checkoutLatitude: row.CheckOutLatitude,
          checkoutLongitude: row.CheckOutLongitude,
        });
      }
    }

    res.json(Array.from(seen.values()));
  } catch (err) {
    console.error('Get locations error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب المواقع' });
  }
});

router.get('/map-data', async (req, res) => {
  try {
    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    const allEmployees = await db.query(
      "SELECT Id, NomAr, PrenomAr, Nom, Prenom, Service, Grade FROM Employes WHERE EstActif = 1"
    );
    const targetEmployees = allEmployees.filter(e =>
      e.Service && TARGET_DEPARTMENTS.some(d => e.Service.includes(d))
    );

    const attendance = await db.query(
      "SELECT EmployeeId, CheckInTime, CheckOutTime, IsCheckedOut, CheckInLatitude, CheckInLongitude FROM TrackerAttendance WHERE Date = ?",
      [today]
    );

    const attendanceMap = {};
    for (const a of attendance) {
      if (!attendanceMap[a.EmployeeId]) {
        attendanceMap[a.EmployeeId] = a;
      }
    }

    const result = targetEmployees.map(emp => {
      const att = attendanceMap[emp.Id];
      return {
        employeeId: emp.Id,
        name: emp.NomAr ? `${emp.NomAr} ${emp.PrenomAr}` : `${emp.Nom} ${emp.Prenom}`,
        service: emp.Service,
        grade: emp.Grade,
        hasCheckedIn: !!att,
        isCheckedOut: att ? att.IsCheckedOut : false,
        checkInTime: att ? att.CheckInTime : null,
        latitude: att ? att.CheckInLatitude : null,
        longitude: att ? att.CheckInLongitude : null,
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
    const { employeeId, latitude, longitude, location } = req.body;
    if (!employeeId) {
      return res.status(400).json({ error: 'رقم الموظف مطلوب' });
    }

    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    const existing = await db.query(
      'SELECT Id FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [employeeId, today]
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'الموظف مسجل حضوره بالفعل اليوم' });
    }

    await db.query(
      `INSERT INTO TrackerAttendance
        (EmployeeId, Date, CheckInTime, CheckInLocation, CheckInLatitude, CheckInLongitude, IsCheckedOut)
        VALUES (?, ?, GETDATE(), ?, ?, ?, 0)`,
      [employeeId, today, location || null, latitude || null, longitude || null]
    );

    const result = await db.query(
      'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
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
    const { employeeId, latitude, longitude, location } = req.body;
    if (!employeeId) {
      return res.status(400).json({ error: 'رقم الموظف مطلوب' });
    }

    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    const existing = await db.query(
      'SELECT Id FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [employeeId, today]
    );

    if (!existing || existing.length === 0) {
      return res.status(400).json({ error: 'لم يسجل الحضور بعد اليوم' });
    }

    await db.query(
      `UPDATE TrackerAttendance
        SET CheckOutTime = GETDATE(), CheckOutLocation = ?,
            CheckOutLatitude = ?, CheckOutLongitude = ?,
            IsCheckedOut = 1
        WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0`,
      [location || null, latitude || null, longitude || null, employeeId, today]
    );

    const result = await db.query(
      'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );

    res.json(result[0]);
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الانصراف' });
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    const user = await db.query(
      'SELECT Id FROM UtilisateursSysteme WHERE NomUtilisateur = ?',
      [decoded.username]
    );

    if (!user || user.length === 0) {
      return res.json(null);
    }

    const attendance = await db.query(
      'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ?',
      [user[0].Id, today]
    );

    res.json(attendance.length > 0 ? attendance[0] : null);
  } catch (err) {
    console.error('Get today-self error:', err.message);
    res.json(null);
  }
});

module.exports = router;
