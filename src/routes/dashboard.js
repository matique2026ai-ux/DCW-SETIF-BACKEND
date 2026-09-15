const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { getTodayAlgeria } = require('../utils/dateUtils');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

router.get('/stats', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const allEmployees = await db.query(
      pg
        ? `SELECT "Id","Service" FROM "Employes" WHERE "EstActif" = true`
        : 'SELECT Id,Service FROM Employes WHERE EstActif = 1'
    );
    const targetEmployees = allEmployees.filter(e => {
      const s = (e.Service || e.service || '').toString();
      return s && TARGET_DEPARTMENTS.some(d => s.includes(d));
    });

    if (targetEmployees.length === 0) {
      return res.json({ totalInspectors: 0, presentToday: 0, checkedOutToday: 0, absentToday: 0, activePrograms: 0 });
    }

    const targetIds = targetEmployees.map(e => e.Id || e.id).filter(Boolean);

    if (targetIds.length === 0) {
      return res.json({ totalInspectors: 0, presentToday: 0, checkedOutToday: 0, absentToday: 0, activePrograms: 0 });
    }

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

    // Fetch visits stats for today
    const visitsStats = await db.query(
      pg
        ? `SELECT 
             COUNT(*) as total_visits,
             COUNT(CASE WHEN "ViolationFound" = true THEN 1 END) as violations_count,
             COALESCE(SUM("SeizureValue"), 0) as total_seizure_value,
             COUNT(CASE WHEN "IsApproved" = true THEN 1 END) as approved_count
           FROM "TrackerVisits" WHERE "Date" = $1`
        : `SELECT 
             COUNT(*) as total_visits,
             SUM(CASE WHEN ViolationFound = 1 THEN 1 ELSE 0 END) as violations_count,
             ISNULL(SUM(SeizureValue), 0) as total_seizure_value,
             SUM(CASE WHEN IsApproved = 1 THEN 1 ELSE 0 END) as approved_count
           FROM TrackerVisits WHERE Date = ?`,
      [today]
    );

    const total = targetIds.length;
    const p = present && present.length > 0 ? parseInt(present[0].count || present[0].COUNT || 0, 10) : 0;
    const c = checkedOut && checkedOut.length > 0 ? parseInt(checkedOut[0].count || checkedOut[0].COUNT || 0, 10) : 0;
    const prog = programs && programs.length > 0 ? parseInt(programs[0].count || programs[0].COUNT || 0, 10) : 0;

    const vRow = (visitsStats && visitsStats.length > 0) ? visitsStats[0] : {};
    const totalVisits = parseInt(vRow.total_visits || vRow.TOTAL_VISITS || 0, 10);
    const violationsCount = parseInt(vRow.violations_count || vRow.VIOLATIONS_COUNT || 0, 10);
    const totalSeizureValue = parseFloat(vRow.total_seizure_value || vRow.TOTAL_SEIZURE_VALUE || 0);
    const approvedCount = parseInt(vRow.approved_count || vRow.APPROVED_COUNT || 0, 10);

    res.json({
      totalInspectors: total,
      presentToday: p,
      checkedOutToday: c,
      absentToday: total - p > 0 ? total - p : 0,
      activePrograms: prog,
      totalVisitsToday: totalVisits,
      violationsToday: violationsCount,
      totalSeizureValueToday: totalSeizureValue,
      approvedVisitsToday: approvedCount,
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

    const activities = (result || [])
      .filter(r => {
        const s = (r.Service || r.service || '').toString();
        return s && TARGET_DEPARTMENTS.some(d => s.includes(d));
      })
      .map(r => {
        const nomAr = r.NomAr || r.nomar;
        const prenomAr = r.PrenomAr || r.prenomar;
        const nom = r.Nom || r.nom;
        const prenom = r.Prenom || r.prenom;
        const empName = nomAr ? `${nomAr} ${prenomAr || ''}`.trim() : `${nom || ''} ${prenom || ''}`.trim();
        return {
          employeeName: empName,
          date: r.Date || r.date,
          checkIn: r.CheckInTime || r.checkintime,
          checkOut: r.CheckOutTime || r.checkouttime,
        };
      });

    res.json(activities);
  } catch (err) {
    console.error('Recent activity error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب النشاطات' });
  }
});

module.exports = router;
