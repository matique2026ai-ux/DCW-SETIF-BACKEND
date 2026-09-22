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

router.get('/analytics', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { date, startDate, endDate } = req.query;
    const today = getTodayAlgeria();
    const queryDate = date || today;

    // 1. Employee Stats
    const allEmployees = await db.query(
      pg
        ? `SELECT "Id","Nom","Prenom","NomAr","PrenomAr","Service","Grade" FROM "Employes" WHERE "EstActif" = true`
        : 'SELECT Id,Nom,Prenom,NomAr,PrenomAr,Service,Grade FROM Employes WHERE EstActif = 1'
    );

    const targetEmployees = allEmployees.filter(e => {
      const s = (e.Service || e.service || '').toString();
      return s && TARGET_DEPARTMENTS.some(d => s.includes(d));
    });

    const targetIds = targetEmployees.map(e => e.Id || e.id).filter(Boolean);

    // Attendance
    let presentCount = 0;
    let checkedOutCount = 0;
    if (targetIds.length > 0) {
      const presentRes = await db.query(
        pg
          ? `SELECT COUNT(DISTINCT "EmployeeId") as count FROM "TrackerAttendance" WHERE "Date" = $1 AND "EmployeeId" = ANY($2)`
          : `SELECT COUNT(DISTINCT EmployeeId) as count FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (${targetIds.join(',')})`,
        pg ? [queryDate, targetIds] : [queryDate]
      );
      const checkedOutRes = await db.query(
        pg
          ? `SELECT COUNT(DISTINCT "EmployeeId") as count FROM "TrackerAttendance" WHERE "Date" = $1 AND "EmployeeId" = ANY($2) AND "IsCheckedOut" = true`
          : `SELECT COUNT(DISTINCT EmployeeId) as count FROM TrackerAttendance WHERE Date = ? AND EmployeeId IN (${targetIds.join(',')}) AND IsCheckedOut = 1`,
        pg ? [queryDate, targetIds] : [queryDate]
      );
      presentCount = parseInt(presentRes[0]?.count || presentRes[0]?.COUNT || 0, 10);
      checkedOutCount = parseInt(checkedOutRes[0]?.count || checkedOutRes[0]?.COUNT || 0, 10);
    }

    // 2. Visits & Inspections Aggregations
    const { period } = req.query;
    const effectivePeriod = period || (startDate && endDate ? 'range' : (date ? 'custom_date' : 'today'));
    let visitParams = [queryDate];
    let dateCondition = pg ? `tv."Date" = $1` : `tv.Date = ?`;

    if (effectivePeriod === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      const weekStart = d.toISOString().split('T')[0];
      visitParams = [weekStart, today];
      dateCondition = pg ? `tv."Date" >= $1 AND tv."Date" <= $2` : `tv.Date >= ? AND tv.Date <= ?`;
    } else if (effectivePeriod === 'month') {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      const monthStart = d.toISOString().split('T')[0];
      visitParams = [monthStart, today];
      dateCondition = pg ? `tv."Date" >= $1 AND tv."Date" <= $2` : `tv.Date >= ? AND tv.Date <= ?`;
    } else if (effectivePeriod === 'all' || effectivePeriod === 'cumulative') {
      dateCondition = '1=1';
      visitParams = [];
    } else if (startDate && endDate) {
      visitParams = [startDate, endDate];
      dateCondition = pg ? `tv."Date" >= $1 AND tv."Date" <= $2` : `tv.Date >= ? AND tv.Date <= ?`;
    }

    const visitsQuery = pg
      ? `SELECT tv.*, e."NomAr", e."PrenomAr", e."Nom", e."Prenom", e."Service", e."Grade"
         FROM "TrackerVisits" tv
         LEFT JOIN "Employes" e ON tv."EmployeeId" = e."Id"
         WHERE ${dateCondition}
         ORDER BY tv."CheckInTime" DESC`
      : `SELECT tv.*, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service, e.Grade
         FROM TrackerVisits tv
         LEFT JOIN Employes e ON tv.EmployeeId = e.Id
         WHERE ${dateCondition}
         ORDER BY tv.CheckInTime DESC`;

    const visitsResult = await db.query(visitsQuery, visitParams);
    const visits = visitsResult || [];

    // All-time / Cumulative visits aggregate for macro perspective
    const cumulativeQuery = pg
      ? `SELECT 
           COUNT(*) as total_cumulative_visits,
           COUNT(CASE WHEN "ViolationFound" = true THEN 1 END) as cumulative_violations,
           COALESCE(SUM("SeizureValue"), 0) as cumulative_seizures_value,
           COUNT(CASE WHEN "LegalAction" LIKE '%غلق%' OR "ViolationNotes" LIKE '%غلق%' THEN 1 END) as cumulative_closures,
           COUNT(CASE WHEN "LegalAction" LIKE '%عين%' OR "ViolationNotes" LIKE '%عين%' THEN 1 END) as cumulative_samples,
           COUNT(CASE WHEN "LegalAction" LIKE '%محضر%' OR "ViolationNotes" LIKE '%محضر%' THEN 1 END) as cumulative_court_referrals
         FROM "TrackerVisits"`
      : `SELECT 
           COUNT(*) as total_cumulative_visits,
           SUM(CASE WHEN ViolationFound = 1 THEN 1 ELSE 0 END) as cumulative_violations,
           ISNULL(SUM(SeizureValue), 0) as cumulative_seizures_value,
           SUM(CASE WHEN LegalAction LIKE '%غلق%' OR ViolationNotes LIKE '%غلق%' THEN 1 ELSE 0 END) as cumulative_closures,
           SUM(CASE WHEN LegalAction LIKE '%عين%' OR ViolationNotes LIKE '%عين%' THEN 1 ELSE 0 END) as cumulative_samples,
           SUM(CASE WHEN LegalAction LIKE '%محضر%' OR ViolationNotes LIKE '%محضر%' THEN 1 ELSE 0 END) as cumulative_court_referrals
         FROM TrackerVisits`;

    const cumResult = await db.query(cumulativeQuery);
    const cumRow = cumResult[0] || {};

    // Calculate metrics for selected timeframe
    let totalVisits = visits.length;
    let violationsCount = 0;
    let totalSeizureValue = 0;
    let seizuresCount = 0;
    let approvedCount = 0;
    let closureProposalsCount = 0;
    let samplesCount = 0;
    let courtReferralsCount = 0;

    const deptStats = {
      fraudRepression: {
        name: 'مصلحة حماية المستهلك وقمع الغش',
        visits: 0,
        violations: 0,
        seizuresValue: 0,
        samples: 0,
        closures: 0,
      },
      competition: {
        name: 'مصلحة المنافسة والتحقيقات الاقتصادية',
        visits: 0,
        violations: 0,
        seizuresValue: 0,
        courtReferrals: 0,
        closures: 0,
      },
    };

    const inspectorBreakdown = {};
    const sectorMap = {};
    const inspectoratesStats = {
      'سطيف (المقر الرئيسي)': { name: 'سطيف (المقر الرئيسي)', visits: 0, violations: 0, seizuresValue: 0 },
      'العلمة': { name: 'العلمة', visits: 0, violations: 0, seizuresValue: 0 },
      'عين ولمان': { name: 'عين ولمان', visits: 0, violations: 0, seizuresValue: 0 },
      'بوقاعة': { name: 'بوقاعة', visits: 0, violations: 0, seizuresValue: 0 },
      'عين آزال': { name: 'عين آزال', visits: 0, violations: 0, seizuresValue: 0 },
      'عين الكبيرة': { name: 'عين الكبيرة', visits: 0, violations: 0, seizuresValue: 0 },
      'عين أرنات': { name: 'عين أرنات', visits: 0, violations: 0, seizuresValue: 0 },
      'مطار 8 ماي 1945 الدولي': { name: 'مطار 8 ماي 1945 الدولي', visits: 0, violations: 0, seizuresValue: 0 },
    };

    visits.forEach(v => {
      const isViol = v.ViolationFound === true || v.violationfound === true || v.ViolationFound == 1;
      const sVal = parseFloat(v.SeizureValue || v.seizurevalue || 0) || 0;
      const isAppr = v.IsApproved === true || v.isapproved === true || v.IsApproved == 1;
      const lAction = (v.LegalAction || v.legalaction || '').toString();
      const vNotes = (v.ViolationNotes || v.violationnotes || '').toString();
      const fullNotes = `${lAction} ${vNotes}`;
      const locName = (v.LocationName || v.locationname || '').toString();

      if (isViol) violationsCount++;
      if (sVal > 0) {
        totalSeizureValue += sVal;
        seizuresCount++;
      }
      if (isAppr) approvedCount++;
      if (fullNotes.includes('غلق') || fullNotes.includes('إغلاق')) closureProposalsCount++;
      if (fullNotes.includes('عين') || fullNotes.includes('تحليل') || fullNotes.includes('مخبر')) samplesCount++;
      if (fullNotes.includes('محضر') || fullNotes.includes('متابعة') || fullNotes.includes('عدالة')) courtReferralsCount++;

      // By Department
      const srv = (v.Service || v.service || '').toString();
      if (srv.includes('قمع الغش') || srv.includes('المستهلك')) {
        deptStats.fraudRepression.visits++;
        if (isViol) deptStats.fraudRepression.violations++;
        deptStats.fraudRepression.seizuresValue += sVal;
        if (fullNotes.includes('عين') || fullNotes.includes('تحليل')) deptStats.fraudRepression.samples++;
        if (fullNotes.includes('غلق')) deptStats.fraudRepression.closures++;
      } else if (srv.includes('المنافسة') || srv.includes('التحقيقات')) {
        deptStats.competition.visits++;
        if (isViol) deptStats.competition.violations++;
        deptStats.competition.seizuresValue += sVal;
        if (fullNotes.includes('محضر')) deptStats.competition.courtReferrals++;
        if (fullNotes.includes('غلق')) deptStats.competition.closures++;
      }

      // By Inspector
      const empId = v.EmployeeId || v.employeeid;
      const empName = (v.NomAr || v.nomar) ? `${v.NomAr || v.nomar} ${v.PrenomAr || v.prenomar || ''}`.trim() : `مفتش #${empId}`;
      if (!inspectorBreakdown[empId]) {
        inspectorBreakdown[empId] = {
          employeeId: empId,
          name: empName,
          service: srv,
          visitsCount: 0,
          violationsCount: 0,
          seizuresValue: 0,
        };
      }
      inspectorBreakdown[empId].visitsCount++;
      if (isViol) inspectorBreakdown[empId].violationsCount++;
      inspectorBreakdown[empId].seizuresValue += sVal;

      // Sector breakdown
      const rawType = (v.ShopType || v.shoptype || 'مواد غذائية عامة وتجزئة').toString().trim();
      if (!sectorMap[rawType]) {
        sectorMap[rawType] = { sector: rawType, visits: 0, violations: 0, seizuresValue: 0 };
      }
      sectorMap[rawType].visits++;
      if (isViol) sectorMap[rawType].violations++;
      sectorMap[rawType].seizuresValue += sVal;

      // Inspectorate classification
      let matchedInsp = 'سطيف (المقر الرئيسي)';
      if (locName.includes('العلمة')) matchedInsp = 'العلمة';
      else if (locName.includes('عين ولمان')) matchedInsp = 'عين ولمان';
      else if (locName.includes('بوقاعة')) matchedInsp = 'بوقاعة';
      else if (locName.includes('عين آزال')) matchedInsp = 'عين آزال';
      else if (locName.includes('عين الكبيرة')) matchedInsp = 'عين الكبيرة';
      else if (locName.includes('مطار') || locName.includes('الحدودية')) matchedInsp = 'مطار 8 ماي 1945 الدولي';
      else if (locName.includes('عين أرنات')) matchedInsp = 'عين أرنات';
      
      if (inspectoratesStats[matchedInsp]) {
        inspectoratesStats[matchedInsp].visits++;
        if (isViol) inspectoratesStats[matchedInsp].violations++;
        inspectoratesStats[matchedInsp].seizuresValue += sVal;
      }
    });

    // Dynamic trend query for charts based on timeframe
    let trendCondition = pg ? `"Date" >= CURRENT_DATE - INTERVAL '6 days'` : 'Date >= DATEADD(day, -6, GETDATE())';
    let trendParams = [];

    if (effectivePeriod === 'week' || effectivePeriod === 'today' || effectivePeriod === 'custom_date') {
      const d = new Date(queryDate);
      d.setDate(d.getDate() - 6);
      const start = d.toISOString().split('T')[0];
      trendCondition = pg ? `"Date" >= $1 AND "Date" <= $2` : `Date >= ? AND Date <= ?`;
      trendParams = [start, queryDate];
    } else if (effectivePeriod === 'month') {
      const d = new Date(queryDate);
      d.setDate(d.getDate() - 29);
      const start = d.toISOString().split('T')[0];
      trendCondition = pg ? `"Date" >= $1 AND "Date" <= $2` : `Date >= ? AND Date <= ?`;
      trendParams = [start, queryDate];
    } else if (startDate && endDate) {
      trendCondition = pg ? `"Date" >= $1 AND "Date" <= $2` : `Date >= ? AND Date <= ?`;
      trendParams = [startDate, endDate];
    } else if (effectivePeriod === 'all' || effectivePeriod === 'cumulative') {
      trendCondition = pg ? `"Date" >= CURRENT_DATE - INTERVAL '13 days'` : 'Date >= DATEADD(day, -13, GETDATE())';
      trendParams = [];
    }

    const trendQuery = pg
      ? `SELECT TO_CHAR("Date", 'YYYY-MM-DD') as "date",
                COUNT(*) as "visits",
                COUNT(CASE WHEN "ViolationFound" = true THEN 1 END) as "violations",
                COALESCE(SUM("SeizureValue"), 0) as "seizures"
         FROM "TrackerVisits"
         WHERE ${trendCondition}
         GROUP BY "Date"
         ORDER BY "Date" ASC`
      : `SELECT Date as date,
                COUNT(*) as visits,
                SUM(CASE WHEN ViolationFound = 1 THEN 1 ELSE 0 END) as violations,
                ISNULL(SUM(SeizureValue), 0) as seizures
         FROM TrackerVisits
         WHERE ${trendCondition}
         GROUP BY Date
         ORDER BY Date ASC`;

    const trendRes = await db.query(trendQuery, trendParams);
    const dailyTrend = (trendRes || []).map(r => ({
      date: r.date || r.Date,
      visits: parseInt(r.visits || r.Visits || 0, 10),
      violations: parseInt(r.violations || r.Violations || 0, 10),
      seizures: parseFloat(r.seizures || r.Seizures || 0),
    }));

    const activeProgramsCount = await db.query(
      pg ? `SELECT COUNT(*) as count FROM "TrackerPrograms"` : `SELECT COUNT(*) as count FROM TrackerPrograms`
    );

    const sectorBreakdown = Object.values(sectorMap).map(s => ({
      ...s,
      rate: s.visits > 0 ? parseFloat(((s.violations / s.visits) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.visits - a.visits);

    res.json({
      selectedDate: queryDate,
      period: effectivePeriod,
      attendance: {
        totalInspectors: targetIds.length,
        presentToday: presentCount,
        checkedOutToday: checkedOutCount,
        absentToday: Math.max(0, targetIds.length - presentCount),
        readinessRate: targetIds.length > 0 ? ((presentCount / targetIds.length) * 100).toFixed(1) : '0',
      },
      todayInspections: {
        totalVisits,
        violationsCount,
        seizuresCount,
        totalSeizureValue,
        approvedCount,
        closureProposalsCount,
        samplesCount,
        courtReferralsCount,
        violationRate: totalVisits > 0 ? ((violationsCount / totalVisits) * 100).toFixed(1) : '0',
        complianceRate: totalVisits > 0 ? (((totalVisits - violationsCount) / totalVisits) * 100).toFixed(1) : '100',
        prosecutionRate: violationsCount > 0 ? ((courtReferralsCount / violationsCount) * 100).toFixed(1) : '0',
      },
      cumulativeTotals: {
        totalVisits: parseInt(cumRow.total_cumulative_visits || cumRow.TOTAL_CUMULATIVE_VISITS || 0, 10),
        violationsCount: parseInt(cumRow.cumulative_violations || cumRow.CUMULATIVE_VIOLATIONS || 0, 10),
        totalSeizureValue: parseFloat(cumRow.cumulative_seizures_value || cumRow.CUMULATIVE_SEIZURES_VALUE || 0),
        closureProposalsCount: parseInt(cumRow.cumulative_closures || cumRow.CUMULATIVE_CLOSURES || 0, 10),
        samplesCount: parseInt(cumRow.cumulative_samples || cumRow.CUMULATIVE_SAMPLES || 0, 10),
        courtReferralsCount: parseInt(cumRow.cumulative_court_referrals || cumRow.CUMULATIVE_COURT_REFERRALS || 0, 10),
      },
      departmentBreakdown: deptStats,
      topInspectors: Object.values(inspectorBreakdown).sort((a, b) => b.visitsCount - a.visitsCount).slice(0, 5),
      sectorBreakdown,
      inspectorateBreakdown: inspectoratesStats,
      dailyTrend,
      recentVisits: visits.slice(0, 20),
      activeProgramsCount: parseInt(activeProgramsCount[0]?.count || activeProgramsCount[0]?.COUNT || 0, 10),
    });
  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب التحليلات الرقابية: ' + err.message });
  }
});

module.exports = router;
