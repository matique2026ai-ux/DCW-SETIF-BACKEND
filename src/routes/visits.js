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
      SELECT tv.*, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service
      FROM TrackerVisits tv
      JOIN Employes e ON tv.EmployeeId = e.Id
    `;
    const conditions = [];
    const params = [];

    if (date) {
      conditions.push('tv.Date = ?');
      params.push(date);
    }
    if (employeeId) {
      conditions.push('tv.EmployeeId = ?');
      params.push(parseInt(employeeId));
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY tv.CheckInTime DESC';

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
    const today = new Date().toISOString().split('T')[0];

    const result = await db.query(`
      SELECT tv.*, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service
      FROM TrackerVisits tv
      JOIN Employes e ON tv.EmployeeId = e.Id
      WHERE tv.Date = ?
      ORDER BY tv.CheckInTime DESC
    `, [today]);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب زيارات اليوم' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { employeeId, latitude, longitude, accuracy, locationName, shopName, shopType, photo, assignmentId, notes } = req.body;
    if (!employeeId || !latitude || !longitude) {
      return res.status(400).json({ error: 'البيانات المطلوبة: employeeId, latitude, longitude' });
    }

    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    await db.query(`
      INSERT INTO TrackerVisits
        (EmployeeId, AssignmentId, Date, Latitude, Longitude, Accuracy, LocationName, ShopName, ShopType, Photo, Notes, Status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `, [employeeId, assignmentId || null, today, latitude, longitude, accuracy || null, locationName || null, shopName || null, shopType || null, photo || null, notes || null]);

    const result = await db.query(
      'SELECT TOP 1 * FROM TrackerVisits WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );

    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Create visit error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الزيارة' });
  }
});

router.post('/:id/checkout', async (req, res) => {
  try {
    const { latitude, longitude, violationFound, violationType, violationNotes, notes } = req.body;
    const db = await getConnection();

    await db.query(`
      UPDATE TrackerVisits
      SET CheckOutTime = GETDATE(),
          Status = 'completed',
          ViolationFound = ?,
          ViolationType = ?,
          ViolationNotes = ?,
          Notes = ISNULL(?, Notes)
      WHERE Id = ?
    `, [violationFound ? 1 : 0, violationType || null, violationNotes || null, notes || null, req.params.id]);

    const result = await db.query('SELECT * FROM TrackerVisits WHERE Id = ?', [req.params.id]);
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنهاء الزيارة' });
  }
});

router.get('/employee/:employeeId/summary', async (req, res) => {
  try {
    const db = await getConnection();
    const { date } = req.query;
    const today = date || new Date().toISOString().split('T')[0];

    const visits = await db.query(
      'SELECT COUNT(*) as count FROM TrackerVisits WHERE EmployeeId = ? AND Date = ?',
      [req.params.employeeId, today]
    );

    const violations = await db.query(
      'SELECT COUNT(*) as count FROM TrackerVisits WHERE EmployeeId = ? AND Date = ? AND ViolationFound = 1',
      [req.params.employeeId, today]
    );

    const totalTime = await db.query(`
      SELECT SUM(DATEDIFF(MINUTE, CheckInTime, ISNULL(CheckOutTime, GETDATE()))) as totalMinutes
      FROM TrackerVisits
      WHERE EmployeeId = ? AND Date = ?
    `, [req.params.employeeId, today]);

    res.json({
      visitsToday: visits[0].count,
      violationsFound: violations[0].count,
      totalMinutes: totalTime[0].totalMinutes || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

module.exports = router;
