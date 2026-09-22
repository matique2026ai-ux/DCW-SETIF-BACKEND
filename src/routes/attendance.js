const express = require('express');
const jwt = require('jsonwebtoken');
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

// GET delays and attendance summary with morning grace tolerance threshold (08:45 AM)
router.get('/delays-summary', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { month, employeeId } = req.query; // month e.g. '2026-09'

    // Fetch all active inspection employees
    const employees = await db.query(
      pg
        ? `SELECT e."Id", e."NomAr", e."PrenomAr", e."Nom", e."Prenom", e."Service", e."Grade"
           FROM "Employes" e
           WHERE e."EstActif" = true`
        : `SELECT e.Id, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service, e.Grade
           FROM Employes e
           WHERE e.EstActif = 1`
    );

    // Fetch attendance records
    let attQuery = pg
      ? `SELECT "EmployeeId", "Date", "CheckInTime", "IsCheckedOut"
         FROM "TrackerAttendance"`
      : `SELECT EmployeeId, Date, CheckInTime, IsCheckedOut
         FROM TrackerAttendance`;

    const attParams = [];
    if (month) {
      attQuery += pg ? ` WHERE TO_CHAR("Date", 'YYYY-MM') = $1` : ` WHERE FORMAT(Date, 'yyyy-MM') = ?`;
      attParams.push(month);
    }
    attQuery += pg ? ` ORDER BY "CheckInTime" ASC` : ` ORDER BY CheckInTime ASC`;

    const attendanceRecords = await db.query(attQuery, attParams);

    // Group attendance by employee
    const attByEmp = {};
    for (const a of attendanceRecords) {
      const empId = a.EmployeeId || a.employeeid;
      if (!attByEmp[empId]) attByEmp[empId] = [];
      attByEmp[empId].push(a);
    }

    // Dynamic tolerance threshold: query param or database setting (default 08:45)
    let graceTimeStr = req.query.graceTime;
    if (!graceTimeStr) {
      try {
        const settingRows = await db.query(
          pg ? `SELECT "Value" FROM "TrackerSettings" WHERE "Key" = 'morning_grace_time'` : `SELECT [Value] FROM TrackerSettings WHERE [Key] = 'morning_grace_time'`
        );
        if (settingRows && settingRows.length > 0) {
          graceTimeStr = settingRows[0].Value || settingRows[0].value;
        }
      } catch (_) {}
    }
    if (!graceTimeStr) graceTimeStr = '08:45';

    const [gHour, gMin] = graceTimeStr.split(':').map(Number);
    const GRACE_MINUTES = (isNaN(gHour) ? 8 : gHour) * 60 + (isNaN(gMin) ? 45 : gMin);

    const summary = employees.map(emp => {
      const empId = emp.Id || emp.id;
      const records = attByEmp[empId] || [];
      let totalLateMinutes = 0;
      let lateDaysCount = 0;
      const lateDetails = [];

      for (const rec of records) {
        const rawTime = rec.CheckInTime || rec.checkintime;
        if (!rawTime) continue;
        const d = new Date(rawTime);
        // Algeria time offset
        const hours = d.getHours();
        const mins = d.getMinutes();
        const currentMins = hours * 60 + mins;

        if (currentMins > GRACE_MINUTES) {
          const delay = currentMins - GRACE_MINUTES;
          totalLateMinutes += delay;
          lateDaysCount++;
          lateDetails.push({
            date: rec.Date || rec.date,
            checkInTime: `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`,
            lateMinutes: delay,
          });
        }
      }

      const totalLateHours = (totalLateMinutes / 60).toFixed(1);
      // Algerian Civil Service deduction rule: 8h = 1 day, 4h = 0.5 day
      const suggestedDeductionDays = Math.floor(totalLateMinutes / 480) + ((totalLateMinutes % 480) >= 240 ? 0.5 : 0);

      const nomAr = emp.NomAr || emp.nomar;
      const prenomAr = emp.PrenomAr || emp.prenomar;
      const name = nomAr ? `${nomAr} ${prenomAr || ''}`.trim() : `${emp.Nom || ''} ${emp.Prenom || ''}`.trim();

      return {
        employeeId: empId,
        name: name,
        service: emp.Service || emp.service,
        grade: emp.Grade || emp.grade,
        attendedDaysCount: records.length,
        lateDaysCount: lateDaysCount,
        totalLateMinutes: totalLateMinutes,
        totalLateHours: parseFloat(totalLateHours),
        suggestedDeductionDays: suggestedDeductionDays,
        lateDetails: lateDetails,
      };
    });

    if (employeeId) {
      const single = summary.find(s => s.employeeId === parseInt(employeeId));
      return res.json(single || null);
    }

    res.json(summary);
  } catch (err) {
    console.error('Delays summary error:', err.message);
    res.status(500).json({ error: 'خطأ في حساب ملخص التأخرات: ' + err.message });
  }
});

// Official DCW Setif Headquarters & Regional Inspectorates (8 Official Locations)
const OFFICIAL_HQS = [
  { id: 'hq_setif', name: 'المقر الرئيسي لمديرية سطيف (حي المعبودة)', lat: 36.1900575, lng: 5.3990134, radiusMeters: 600, isMain: true },
  { id: 'insp_airport_arnat', name: 'المفتشية الحدودية بمطار 8 ماي 1945 (عين أرنات)', lat: 36.1781, lng: 5.3247, radiusMeters: 1200 },
  { id: 'insp_eulma', name: 'المفتشية الإقليمية للتجارة بالعلمة', lat: 36.1554, lng: 5.6908, radiusMeters: 1000 },
  { id: 'insp_ain_oulmene', name: 'المفتشية الإقليمية للتجارة بعين ولمان', lat: 35.9189, lng: 5.2978, radiusMeters: 1000 },
  { id: 'insp_bougaa', name: 'المفتشية الإقليمية للتجارة ببوقاعة', lat: 36.3325, lng: 5.0886, radiusMeters: 1000 },
  { id: 'annex_ain_azel', name: 'الملحقة التجارية بعين آزال', lat: 35.8686, lng: 5.4667, radiusMeters: 800 },
  { id: 'annex_ain_kebira', name: 'الملحقة التجارية بعين الكبيرة', lat: 36.3639, lng: 5.5003, radiusMeters: 800 },
  { id: 'annex_ain_arnat', name: 'الملحقة التجارية بعين أرنات', lat: 36.1833, lng: 5.3167, radiusMeters: 800 },
];

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function findNearestHQ(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  let nearest = null;
  let minDistance = Infinity;

  for (const hq of OFFICIAL_HQS) {
    const dist = calculateDistanceMeters(lat, lng, hq.lat, hq.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = { ...hq, distanceMeters: Math.round(dist) };
    }
  }
  return nearest;
}

function isWithinOfficialGeofence(lat, lng) {
  const nearest = findNearestHQ(lat, lng);
  if (!nearest) return { isValid: false, nearest: null };
  return {
    isValid: nearest.distanceMeters <= nearest.radiusMeters,
    nearest,
  };
}

function getAlgeriaLocalTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 1)); // UTC+1
}

function isWithinMorningWindow(dateObj) {
  const hours = dateObj.getHours();
  const mins = dateObj.getMinutes();
  const totalMins = hours * 60 + mins;
  // Legal morning window: 07:30 (450 mins) to 10:30 (630 mins)
  return {
    isValid: totalMins >= (7 * 60 + 30) && totalMins <= (10 * 60 + 30),
    hours,
    mins,
    totalMins,
  };
}

router.get('/map-data', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const allEmployees = await db.query(
      pg
        ? `SELECT DISTINCT ON (e."Id")
                  e."Id", e."NomAr", e."PrenomAr", e."Nom", e."Prenom", 
                  COALESCE(a."AssignedDepartment", e."Service") as "Service", 
                  e."Grade",
                  COALESCE(a."AdministrativeStatus", 'active') as "AdministrativeStatus",
                  COALESCE(a."IsBrigadeLeader", false) as "IsBrigadeLeader",
                  a."BrigadeName"
           FROM "Employes" e
           LEFT JOIN "TrackerEmployeeAdmin" a ON e."Id" = a."EmployeeId"
           WHERE e."EstActif" = true
             AND e."NumeroMatricule" != 'MAT-DIR-001'
             AND (e."Service" IS NULL OR e."Service" != 'المديرية الولائية')
             AND (e."FonctionExercee" IS NULL OR e."FonctionExercee" NOT LIKE '%المدير الولائي%')
           ORDER BY e."Id"`
        : `SELECT DISTINCT
                  e.Id, e.NomAr, e.PrenomAr, e.Nom, e.Prenom, 
                  COALESCE(a.AssignedDepartment, e.Service) as Service, 
                  e.Grade,
                  COALESCE(a.AdministrativeStatus, 'active') as AdministrativeStatus,
                  COALESCE(a.IsBrigadeLeader, 0) as IsBrigadeLeader,
                  a.BrigadeName
           FROM Employes e
           LEFT JOIN TrackerEmployeeAdmin a ON e.Id = a.EmployeeId
           WHERE e.EstActif = 1
             AND e.NumeroMatricule != 'MAT-DIR-001'
             AND (e.Service IS NULL OR e.Service != 'المديرية الولائية')
             AND (e.FonctionExercee IS NULL OR e.FonctionExercee NOT LIKE '%المدير الولائي%')`
    );
    const targetEmployees = allEmployees.filter(e => {
      const s = (e.Service || e.service || '').toString();
      return s && TARGET_DEPARTMENTS.some(d => s.includes(d));
    });

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

    // Fetch active programs with Description to link each inspector to their actual mission
    const programs = await db.query(
      pg
        ? `SELECT "Id", "Title", "Description", "ServiceName", "TargetArea", "TargetType", "FocusPoints", "CreatedAt" FROM "TrackerPrograms" ORDER BY "CreatedAt" DESC`
        : 'SELECT Id, Title, Description, ServiceName, TargetArea, TargetType, FocusPoints, CreatedAt FROM TrackerPrograms ORDER BY CreatedAt DESC'
    );

    // Dynamic morning grace threshold from settings (default 08:45)
    let graceTimeStr = '08:45';
    try {
      const settingRows = await db.query(
        pg ? `SELECT "Value" FROM "TrackerSettings" WHERE "Key" = 'morning_grace_time'` : `SELECT [Value] FROM TrackerSettings WHERE [Key] = 'morning_grace_time'`
      );
      if (settingRows && settingRows.length > 0) {
        graceTimeStr = settingRows[0].Value || settingRows[0].value || '08:45';
      }
    } catch (_) {}
    const [gHour, gMin] = graceTimeStr.split(':').map(Number);
    const GRACE_MINUTES = (isNaN(gHour) ? 8 : gHour) * 60 + (isNaN(gMin) ? 45 : gMin);

    const attendanceMap = {};
    for (const a of (attendance || [])) {
      const aEmpId = a.EmployeeId || a.employeeid;
      if (aEmpId && !attendanceMap[aEmpId]) {
        attendanceMap[aEmpId] = {
          CheckInTime: a.CheckInTime || a.checkintime,
          CheckOutTime: a.CheckOutTime || a.checkouttime,
          IsCheckedOut: a.IsCheckedOut !== undefined ? a.IsCheckedOut : a.ischeckedout,
          CheckInLatitude: a.CheckInLatitude !== undefined ? a.CheckInLatitude : a.checkinlatitude,
          CheckInLongitude: a.CheckInLongitude !== undefined ? a.CheckInLongitude : a.checkinlongitude,
          CheckInPhoto: a.CheckInPhoto || a.checkinphoto,
          Notes: a.Notes || a.notes,
        };
      }
    }

    const visitsMap = {};
    for (const v of (visits || [])) {
      const vEmpId = v.EmployeeId || v.employeeid;
      if (vEmpId) {
        if (!visitsMap[vEmpId]) visitsMap[vEmpId] = [];
        visitsMap[vEmpId].push({
          id: v.Id || v.id,
          time: v.CheckInTime || v.checkintime,
          latitude: v.Latitude !== undefined ? v.Latitude : v.latitude,
          longitude: v.Longitude !== undefined ? v.Longitude : v.longitude,
          shopName: v.ShopName || v.shopname || 'معاينة ميدانية',
          shopType: v.ShopType || v.shoptype,
          photo: v.Photo || v.photo,
          violationFound: v.ViolationFound !== undefined ? v.ViolationFound : v.violationfound,
          notes: v.Notes || v.notes,
        });
      }
    }

    const result = targetEmployees.map(emp => {
      const empId = emp.Id || emp.id;
      const att = attendanceMap[empId];
      const empVisits = visitsMap[empId] || [];
      const lastVisit = empVisits.length > 0 ? empVisits[empVisits.length - 1] : null;

      const isCheckedOut = att ? (att.IsCheckedOut === true || att.IsCheckedOut === 1) : false;
      const adminStatus = emp.AdministrativeStatus || emp.administrativestatus || 'active';
      const isNightDuty = adminStatus === 'special_mission';
      const isBrigadeLeader = (emp.IsBrigadeLeader || emp.isbrigadeleader) === true || (emp.IsBrigadeLeader || emp.isbrigadeleader) === 1;

      // Strict Privacy Rule: If the employee checked out and is NOT on night duty, do not stream live coordinates
      const allowLiveTracking = att && (!isCheckedOut || isNightDuty);

      const nomAr = (emp.NomAr || emp.nomar || '').toString();
      const prenomAr = (emp.PrenomAr || emp.prenomar || '').toString();
      const nom = (emp.Nom || emp.nom || '').toString();
      const prenom = (emp.Prenom || emp.prenom || '').toString();
      const empName = nomAr ? `${nomAr} ${prenomAr}`.trim() : `${nom} ${prenom}`.trim();

      // Find active program specifically for this inspector:
      // Search in Title AND Description (where leader and companion inspectors are registered)
      let activeProg = null;
      for (const p of (programs || [])) {
        const title = (p.Title || p.title || '').toString();
        const desc = (p.Description || p.description || '').toString();
        const fp = (p.FocusPoints || p.focuspoints || '').toString();
        const brigade = (emp.BrigadeName || emp.brigadename || '').toString();

        const isNameMatched =
          (nomAr && (title.includes(nomAr) || desc.includes(nomAr))) ||
          (prenomAr && (title.includes(prenomAr) || desc.includes(prenomAr))) ||
          (nom && (title.toLowerCase().includes(nom.toLowerCase()) || desc.toLowerCase().includes(nom.toLowerCase())));
        const isBrigadeMatched = brigade && (title.includes(brigade) || desc.includes(brigade) || fp.includes(brigade));

        if (isNameMatched || isBrigadeMatched) {
          activeProg = p;
          break;
        }
      }

      const activeProgramData = activeProg ? {
        id: activeProg.Id || activeProg.id,
        title: activeProg.Title || activeProg.title,
        description: activeProg.Description || activeProg.description,
        serviceName: activeProg.ServiceName || activeProg.servicename,
        targetArea: activeProg.TargetArea || activeProg.targetarea,
        targetType: activeProg.TargetType || activeProg.targettype,
      } : null;

      const currentLat = allowLiveTracking ? (lastVisit ? lastVisit.latitude : (att ? att.CheckInLatitude : null)) : null;
      const currentLng = allowLiveTracking ? (lastVisit ? lastVisit.longitude : (att ? att.CheckInLongitude : null)) : null;

      let locationType = 'unknown';
      let hqName = null;
      let distanceToHQ = null;

      if (currentLat != null && currentLng != null) {
        const nearest = findNearestHQ(currentLat, currentLng);
        if (nearest) {
          distanceToHQ = nearest.distanceMeters;
          if (nearest.distanceMeters <= (nearest.radiusMeters || 600) && empVisits.length === 0) {
            locationType = 'at_hq';
            hqName = nearest.name;
          } else {
            locationType = 'in_field';
            hqName = nearest.name;
          }
        } else {
          locationType = 'in_field';
        }
      }

      // Calculate real live late minutes for today
      let todayLateMinutes = 0;
      if (att && att.CheckInTime) {
        const d = new Date(att.CheckInTime);
        const hours = d.getHours();
        const mins = d.getMinutes();
        const currentMins = hours * 60 + mins;
        if (currentMins > GRACE_MINUTES) {
          todayLateMinutes = currentMins - GRACE_MINUTES;
        }
      }

      let trackingStatus = 'غير مسجل اليوم';
      if (isCheckedOut) {
        trackingStatus = isNightDuty ? 'مهمة تفتيش ليلية نشطة' : 'منصرف - أنهى الدوام';
      } else if (att) {
        if (locationType === 'at_hq') {
          trackingStatus = `حاضر بالمقر (${hqName || 'المقر الرئيسي'})`;
        } else {
          trackingStatus = activeProgramData 
              ? `في الميدان — ${activeProgramData.title}`
              : (empVisits.length > 0 ? `نشط في الميدان (${empVisits.length} معاينات)` : 'في مهمة رقابية ميدانية');
        }
      }

      return {
        employeeId: empId,
        name: empName,
        service: emp.Service || emp.service,
        grade: emp.Grade || emp.grade,
        administrativeStatus: adminStatus,
        isBrigadeLeader: isBrigadeLeader,
        brigadeName: emp.BrigadeName || emp.brigadename,
        isNightDuty: isNightDuty,
        hasCheckedIn: !!att,
        isCheckedOut: isCheckedOut,
        trackingStatus: trackingStatus,
        locationType: locationType,
        hqName: hqName,
        distanceToHQ: distanceToHQ,
        activeProgram: activeProgramData,
        checkInTime: att ? att.CheckInTime : null,
        checkOutTime: att ? att.CheckOutTime : null,
        lateMinutes: todayLateMinutes,
        latitude: currentLat,
        longitude: currentLng,
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
    const authHeader = req.headers.authorization;
    let jwtEmployeeId = null;
    let jwtDeviceId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'drh-setif-secret-2024');
        jwtEmployeeId = decoded.employeeId || decoded.id;
        jwtDeviceId = decoded.deviceId || null;
      } catch (_) {}
    }

    const {
      employeeId, EmployeeId,
      latitude, Latitude,
      longitude, Longitude,
      location, locationName, LocationName,
      photo, Photo,
      notes, Notes,
      deviceId, DeviceId
    } = req.body;

    const finalEmpId = employeeId || EmployeeId || jwtEmployeeId;
    if (!finalEmpId) return res.status(400).json({ error: 'رقم الموظف مطلوب' });

    const finalLat = latitude !== undefined ? latitude : Latitude;
    const finalLng = longitude !== undefined ? longitude : Longitude;
    const finalPhoto = photo || Photo || null;
    const finalNotes = notes || Notes || null;
    const finalDeviceId = deviceId || DeviceId || jwtDeviceId || null;

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    // 1️⃣ Device Security Verification (Anti-Spoofing):
    const userRows = await db.query(
      pg
        ? `SELECT "Id", "DeviceId" FROM "UtilisateursSysteme" WHERE "EmployeeId" = $1`
        : `SELECT Id, DeviceId FROM UtilisateursSysteme WHERE EmployeeId = ?`,
      [finalEmpId]
    );
    if (userRows && userRows.length > 0) {
      const boundDev = userRows[0].DeviceId || userRows[0].deviceid;
      if (boundDev) {
        if (!finalDeviceId || boundDev !== finalDeviceId) {
          return res.status(403).json({
            error: 'تنبيه أمني: البصمة الجغرافية مرفوضة قطعياً لأن الهاتف المستخدم غير مطابق للجهاز المعتمد المسجل رسمياً لهذا المفتش (Device Security Mismatch).',
            isDeviceMismatch: true,
          });
        }
      }
    }

    // Check existing attendance for today
    const existing = await db.query(
      pg
        ? `SELECT "Id" FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 AND "IsCheckedOut" = false`
        : 'SELECT Id FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [finalEmpId, today]
    );

    if (existing && existing.length > 0) {
      return res.status(200).json({ success: true, message: 'الموظف مسجل حضوره بالفعل اليوم', alreadyCheckedIn: true });
    }

    // Fetch employee administrative status to check for special missions / night duty
    const adminRows = await db.query(
      pg
        ? `SELECT "AdministrativeStatus", "BrigadeName" FROM "TrackerEmployeeAdmin" WHERE "EmployeeId" = $1`
        : 'SELECT AdministrativeStatus, BrigadeName FROM TrackerEmployeeAdmin WHERE EmployeeId = ?',
      [finalEmpId]
    );
    const empStatus = adminRows[0]?.AdministrativeStatus || adminRows[0]?.administrativestatus || 'active';
    const brigadeName = (adminRows[0]?.BrigadeName || adminRows[0]?.brigadename || '').toString();
    const isSpecialMission = empStatus === 'special_mission' || empStatus === 'mission' || empStatus === 'field_mission';
    const isNightDuty = empStatus === 'special_mission' || brigadeName.includes('المداومة') || brigadeName.includes('المناوبة');

    // 3️⃣ Time Window Check (Algerian Local Time):
    // Official morning window: 07:30 to 10:30 AM
    const algeriaDate = getAlgeriaLocalTime();
    const morningCheck = isWithinMorningWindow(algeriaDate);
    const timeFormatted = `${morningCheck.hours.toString().padStart(2, '0')}:${morningCheck.mins.toString().padStart(2, '0')}`;

    if (!morningCheck.isValid && !isNightDuty && !isSpecialMission) {
      return res.status(403).json({
        error: `عذراً، نافذة تسجيل الحضور الصباحي القانوني مفتوحة حصراً من 07:30 إلى 10:30 صباحاً (التوقيت الحالي: ${timeFormatted}). لا يُقبل التسجيل المسائي أو خارج الأوقات إلا بتكليف مداومة ليلية أو مهمة خاصة معتمدة مسبقاً.`,
        currentTime: timeFormatted,
        isTimeRestricted: true,
      });
    }

    // 2️⃣ Strict GPS Geofence Verification (8 Official Locations):
    if (finalLat === undefined || finalLat === null || finalLng === undefined || finalLng === null) {
      return res.status(400).json({ error: 'البصمة الجغرافية (GPS) إلزامية لتسجيل الحضور. يرجى تفعيل الـ GPS في الهاتف/المتصفح.' });
    }

    const geofenceResult = isWithinOfficialGeofence(finalLat, finalLng);
    let resolvedLocation = location || locationName || LocationName || 'مقر المديرية الولائية';
    let isGeofenceValid = geofenceResult.isValid;

    if (!isGeofenceValid) {
      // If outside all 8 official sites, require an active external field mission
      if (!isSpecialMission) {
        const nearestName = geofenceResult.nearest ? geofenceResult.nearest.name : 'أقرب مقر رسمي';
        const distMeters = geofenceResult.nearest ? geofenceResult.nearest.distanceMeters : 0;
        const allowedRadius = geofenceResult.nearest ? geofenceResult.nearest.radiusMeters : 600;

        return res.status(403).json({
          error: `عذراً، أنت خارج النطاق الجغرافي للمقرات والمفتشيات الرسمية الـ 8 (${nearestName} يبعد عنك ${distMeters}م، والنطاق المسموح به ${allowedRadius}م). يُرفض تسجيل الحضور الصباحي قطعياً من خارج المقر إلا بوجود أمر مهمة خارجية معتمد.`,
          nearestHQ: nearestName,
          distanceMeters: distMeters,
          allowedRadius: allowedRadius,
          isGeofenceDenied: true,
        });
      }
      resolvedLocation = `${geofenceResult.nearest?.name || 'مقر رسمي'} (نقطة انطلاق ميدانية بموجب أمر مهمة خارجية)`;
    } else {
      resolvedLocation = geofenceResult.nearest.name;
    }

    await db.query(
      pg
        ? `INSERT INTO "TrackerAttendance" ("EmployeeId","Date","CheckInTime","CheckInLocation","CheckInLatitude","CheckInLongitude","CheckInPhoto","Notes","DeviceId","IsWithinGeofence","IsCheckedOut")
           VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,false)`
        : `INSERT INTO TrackerAttendance (EmployeeId,Date,CheckInTime,CheckInLocation,CheckInLatitude,CheckInLongitude,CheckInPhoto,Notes,DeviceId,IsWithinGeofence,IsCheckedOut)
           VALUES (?,?,GETDATE(),?,?,?,?,?,?,?,0)`,
      [finalEmpId, today, resolvedLocation, finalLat, finalLng, finalPhoto, finalNotes, finalDeviceId, isGeofenceValid]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [finalEmpId, today]
    );

    res.status(201).json({
      ...(result[0] || {}),
      success: true,
      message: 'تم تسجيل الحضور والبصمة الجغرافية الرسمية بنجاح ✅',
      isGeofenceValid: isGeofenceValid,
      resolvedLocation: resolvedLocation,
      time: timeFormatted,
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الحضور: ' + err.message });
  }
});

// 4️⃣ Checkout Validation & Field Proof:
router.post('/checkout', async (req, res) => {
  try {
    const { employeeId, latitude, longitude, location, notes, shortShiftReason, earlyReason, visitsCount } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'رقم الموظف مطلوب' });

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const existing = await db.query(
      pg
        ? `SELECT "Id", "CheckInTime" FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 AND "IsCheckedOut" = false`
        : 'SELECT Id, CheckInTime FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0',
      [employeeId, today]
    );

    if (!existing || existing.length === 0) {
      return res.status(400).json({ error: 'لم يتم العثور على تسجيل حضور نشط لليوم لتسجيل الانصراف' });
    }

    const checkInRecord = existing[0];
    const checkInTime = new Date(checkInRecord.CheckInTime || checkInRecord.checkintime);
    const now = new Date();
    const elapsedMinutes = Math.round((now - checkInTime) / (1000 * 60));

    const finalEarlyReason = (earlyReason || shortShiftReason || '').trim();

    // 4.1 Anti Instant-Checkout (منع الخروج الفوري بعد دقيقة واحدة - اشتراط 30 دقيقة على الأقل أو تبرير استعجالي)
    if (elapsedMinutes < 30 && !finalEarlyReason) {
      return res.status(400).json({
        error: `تنبيه أمني: مضت ${elapsedMinutes} دقيقة فقط على تسجيل الحضور. يُمنع الانصراف الفوري قبل إتمام 30 دقيقة على الأقل من الدوام أو تقديم تبرير رسمي للخروج الاستعجالي.`,
        isEarlyCheckout: true,
        elapsedMinutes: elapsedMinutes,
        requiresReason: true,
      });
    }

    // 4.2 Field Activity Check (اشتراط معاينات ميدانية أو تبرير في حال الانصراف قبل 4 ساعات)
    const todayVisits = await db.query(
      pg
        ? `SELECT COUNT(*) as count FROM "TrackerVisits" WHERE "EmployeeId" = $1 AND "Date" = $2`
        : `SELECT COUNT(*) as count FROM TrackerVisits WHERE EmployeeId = ? AND Date = ?`,
      [employeeId, today]
    );
    const actualVisitsCount = parseInt(todayVisits[0]?.count || todayVisits[0]?.Count || 0);

    if (elapsedMinutes < 240 && actualVisitsCount === 0 && !finalEarlyReason) {
      return res.status(400).json({
        error: `تنبيه إداري: لم يتم تسجيل أي زيارات أو معاينات ميدانية اليوم وانصرافك يسبق نصف الدوام القانوني (4 ساعات). يرجى تقديم تبرير رسمي للخروج المبكر للمصادقة عليه في سجل المستخدمين.`,
        isEarlyCheckout: true,
        elapsedMinutes: elapsedMinutes,
        visitsCount: actualVisitsCount,
        requiresReason: true,
      });
    }

    // 4.3 Field Proof Location (موقع انتهاء المهمة الميدانية)
    let resolvedCheckoutLocation = location || 'موقع الانصراف الميداني';
    if (latitude && longitude) {
      const nearestHQ = findNearestHQ(latitude, longitude);
      if (nearestHQ && nearestHQ.distanceMeters <= nearestHQ.radiusMeters) {
        resolvedCheckoutLocation = `نهاية المهام في: ${nearestHQ.name}`;
      } else {
        resolvedCheckoutLocation = `انصراف ميداني من موقع التفتيش (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})`;
      }
    }

    let finalNotes = notes || null;
    if (finalEarlyReason) {
      finalNotes = finalNotes ? `${finalNotes} | [تبرير انصراف استثنائي: ${finalEarlyReason}]` : `[تبرير انصراف استثنائي: ${finalEarlyReason}]`;
    }

    await db.query(
      pg
        ? `UPDATE "TrackerAttendance" 
           SET "CheckOutTime" = NOW(),
               "CheckOutLocation" = $1,
               "CheckOutLatitude" = $2,
               "CheckOutLongitude" = $3,
               "Notes" = COALESCE($4, "Notes"),
               "EarlyReason" = $5,
               "IsCheckedOut" = true 
           WHERE "EmployeeId" = $6 AND "Date" = $7 AND "IsCheckedOut" = false`
        : `UPDATE TrackerAttendance 
           SET CheckOutTime = GETDATE(),
               CheckOutLocation = ?,
               CheckOutLatitude = ?,
               CheckOutLongitude = ?,
               Notes = COALESCE(?, Notes),
               EarlyReason = ?,
               IsCheckedOut = 1 
           WHERE EmployeeId = ? AND Date = ? AND IsCheckedOut = 0`,
      [resolvedCheckoutLocation, latitude || null, longitude || null, finalNotes, finalEarlyReason || null, employeeId, today]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );

    res.json({
      ...(result[0] || {}),
      success: true,
      message: 'تم تسجيل الانصراف الميداني وتوثيق إثبات الموقع بنجاح ✅',
      elapsedMinutes: elapsedMinutes,
      visitsCount: actualVisitsCount,
      earlyReason: finalEarlyReason || null,
    });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الانصراف: ' + err.message });
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
