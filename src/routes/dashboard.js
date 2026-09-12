const express = require('express');
const { getConnection, isPostgres } = require('../config/database');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

router.get('/stats', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = new Date().toISOString().split('T')[0];

    const allEmployees = await db.query(
      pg
        ? `SELECT "Id","Service" FROM "Employes" WHERE "EstActif" = true`
        : 'SELECT Id,Service FROM Employes WHERE EstActif = 1'
    );
    const targetEmployees = allEmployees.filter(e =>
      e.Service && TARGET_DEPARTMENTS.some(d => e.Service.includes(d))
    );

    if (targetEmployees.length === 0) {
      return res.json({ totalInspectors: 0, presentToday: 0, checkedOutToday: 0, absentToday: 0, activePrograms: 0 });
    }

    const targetIds = targetEmployees.map(e => e.Id);

    const present = await db.query(
      pg
        ? `SELECT COUNT(*) as count FROM "TrackerAttendance" WHERE "Date" = $1 AND "EmployeeId" = ANY($2)`
        : `SELECT COUNT(*) as count FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (${targetIds.join(',')})`,
      pg ? [today, targetIds] : [today]
    );
    const checkedOut = await db.query(
      pg
        ? `SELECT COUNT(*) as count FROM "TrackerAttendance" WHERE "Date" = $1 AND "EmployeeId" = ANY($2) AND "IsCheckedOut" = true`
        : `SELECT COUNT(*) as count FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (${targetIds.join(',')}) AND IsCheckedOut = 1`,
      pg ? [today, targetIds] : [today]
    );
    const programs = await db.query(
      pg
        ? `SELECT COUNT(*) as count FROM "TrackerPrograms"`
        : 'SELECT COUNT(*) as count FROM TrackerPrograms'
    );

    const total = targetIds.length;
    const p = pg ? parseInt(present[0].count) : present[0].count;
    const c = pg ? parseInt(checkedOut[0].count) : checkedOut[0].count;
    const prog = pg ? parseInt(programs[0].count) : programs[0].count;

    res.json({
      totalInspectors: total,
      presentToday: p,
      checkedOutToday: c,
      absentToday: total - p > 0 ? total - p : 0,
      activePrograms: prog,
    });
  } catch (err) {
    console.error('Dashboard stats error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب الإحصائيات' });
  }
});

router.get('/recent-activity', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const result = await db.query(
      pg
        ? `SELECT ta."CheckInTime",ta."CheckOutTime",ta."Date",
                  e."Nom",e."Prenom",e."NomAr",e."PrenomAr",e."Service"
           FROM "TrackerAttendance" ta
           JOIN "Employes" e ON ta."EmployeeId" = e."Id"
           ORDER BY ta."CreatedAt" DESC LIMIT 10`
        : `SELECT TOP 10 ta.CheckInTime,ta.CheckOutTime,ta.Date,
                  e.Nom,e.Prenom,e.NomAr,e.PrenomAr,e.Service
           FROM TrackerAttendance ta
           JOIN Employes e ON ta.EmployeeId = e.Id
           ORDER BY ta.CreatedAt DESC`
    );

    const activities = result
      .filter(r => r.Service && TARGET_DEPARTMENTS.some(d => r.Service.includes(d)))
      .map(r => ({
        employeeName: r.NomAr ? `${r.NomAr} ${r.PrenomAr}` : `${r.Nom} ${r.Prenom}`,
        date: r.Date, checkIn: r.CheckInTime, checkOut: r.CheckOutTime,
      }));

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب النشاطات' });
  }
});

module.exports = router;
