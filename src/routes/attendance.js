const express = require('express');
const { getConnection } = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const { date, employeeId } = req.query;

    let query = `
      SELECT ta.*, e.Nom, e.Prenom, e.NomAr, e.PrenomAr, e.Grade, e.Service
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

router.post('/checkin', async (req, res) => {
  try {
    const { employeeId, location } = req.body;
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
      'INSERT INTO TrackerAttendance (EmployeeId, Date, CheckInTime, CheckInLocation, IsCheckedOut) VALUES (?, ?, GETDATE(), ?, 0)',
      [employeeId, today, location || null]
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
    const { employeeId, location } = req.body;
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
      'UPDATE TrackerAttendance SET CheckOutTime = GETDATE(), CheckOutLocation = ?, IsCheckedOut = 1 WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [location || null, employeeId, today]
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

module.exports = router;
