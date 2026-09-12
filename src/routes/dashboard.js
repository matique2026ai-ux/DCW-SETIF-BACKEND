const express = require('express');
const { getConnection } = require('../config/database');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

router.get('/stats', async (req, res) => {
  try {
    const db = await getConnection();
    const today = new Date().toISOString().split('T')[0];

    const allEmployees = await db.query("SELECT Id, Service FROM Employes WHERE EstActif = 1");
    const targetEmployees = allEmployees.filter(e =>
      e.Service && TARGET_DEPARTMENTS.some(d => e.Service.includes(d))
    );
    const targetIds = targetEmployees.map(e => e.Id);

    const present = await db.query(
      "SELECT COUNT(*) as present FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (" + targetIds.join(',') + ")",
      [today]
    );
    const checkedOut = await db.query(
      "SELECT COUNT(*) as checkedOut FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (" + targetIds.join(',') + ") AND IsCheckedOut = 1",
      [today]
    );
    const programs = await db.query("SELECT COUNT(*) as programs FROM TrackerPrograms");

    const total = targetIds.length;
    const p = present[0].present;
    const c = checkedOut[0].checkedOut;

    res.json({
      totalInspectors: total,
      presentToday: p,
      checkedOutToday: c,
      absentToday: total - p - c > 0 ? total - p - c : 0,
      activePrograms: programs[0].programs,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب الإحصائيات' });
  }
});

router.get('/recent-activity', async (req, res) => {
  try {
    const db = await getConnection();
    const result = await db.query(`
      SELECT TOP 10
        ta.CheckInTime, ta.CheckOutTime, ta.Date,
        e.Nom, e.Prenom, e.NomAr, e.PrenomAr, e.Service
      FROM TrackerAttendance ta
      JOIN Employes e ON ta.EmployeeId = e.Id
      ORDER BY ta.CreatedAt DESC
    `);

    const activities = result
      .filter(r => r.Service && TARGET_DEPARTMENTS.some(d => r.Service.includes(d)))
      .map(r => ({
        employeeName: r.NomAr ? `${r.NomAr} ${r.PrenomAr}` : `${r.Nom} ${r.Prenom}`,
        date: r.Date,
        checkIn: r.CheckInTime,
        checkOut: r.CheckOutTime,
      }));

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب النشاطات' });
  }
});

module.exports = router;
