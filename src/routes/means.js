const express = require('express');
const { getConnection, isPostgres } = require('../config/database');

const router = express.Router();
const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

// ==========================================
// 1. VEHICLES MANAGEMENT (حظيرة السيارات)
// ==========================================

// GET /api/means/vehicles
router.get('/vehicles', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT v.*,
              m."Id" AS "ActiveMissionId",
              m."Destination" AS "ActiveDestination",
              m."MissionPurpose" AS "ActiveMissionPurpose",
              m."DepartureTime" AS "ActiveDepartureTime"
       FROM "TrackerVehicles" v
       LEFT JOIN "TrackerVehicleMissions" m
         ON v."Id" = m."VehicleId" AND m."Status" = 'active'
       ORDER BY v."Id" ASC`,
      `SELECT v.*,
              m.Id AS ActiveMissionId,
              m.Destination AS ActiveDestination,
              m.MissionPurpose AS ActiveMissionPurpose,
              m.DepartureTime AS ActiveDepartureTime
       FROM TrackerVehicles v
       LEFT JOIN TrackerVehicleMissions m
         ON v.Id = m.VehicleId AND m.Status = 'active'
       ORDER BY v.Id ASC`
    );

    const rows = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Get vehicles error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب قائمة حظيرة السيارات: ' + err.message });
  }
});

// POST /api/means/vehicles (إدراج مركبة جديدة في الحظيرة)
router.post('/vehicles', async (req, res) => {
  try {
    const { matricule, model, type, fuelLevel, kilometrage, status, assignedService, assignedDriver } = req.body;
    if (!matricule || !model) {
      return res.status(400).json({ error: 'رقم التسجيل (الماتريكول) وطراز المركبة مطلوبان' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `INSERT INTO "TrackerVehicles" ("Matricule", "Model", "Type", "FuelLevel", "Kilometrage", "Status", "AssignedService", "AssignedDriver")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      `INSERT INTO TrackerVehicles (Matricule, Model, Type, FuelLevel, Kilometrage, Status, AssignedService, AssignedDriver)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const result = await db.query(sql, [
      matricule,
      model,
      type || 'سيارة رقابة وتدخل',
      parseInt(fuelLevel) || 85,
      parseInt(kilometrage) || 50000,
      status || 'disponible',
      assignedService || 'مصلحة الإدارة والوسائل',
      assignedDriver || null,
    ]);

    res.status(201).json(result[0] || { success: true });
  } catch (err) {
    console.error('Create vehicle error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تسجيل المركبة: ' + err.message });
  }
});

// PUT /api/means/vehicles/:id/fuel (تحديث مستوى الوقود والعداد)
router.put('/vehicles/:id/fuel', async (req, res) => {
  try {
    const { id } = req.params;
    const { fuelLevel, kilometrage, lastPosition } = req.body;

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `UPDATE "TrackerVehicles"
       SET "FuelLevel" = COALESCE($1, "FuelLevel"),
           "Kilometrage" = COALESCE($2, "Kilometrage"),
           "LastPosition" = COALESCE($3, "LastPosition")
       WHERE "Id" = $4
       RETURNING *`,
      `UPDATE TrackerVehicles
       SET FuelLevel = COALESCE(?, FuelLevel),
           Kilometrage = COALESCE(?, Kilometrage),
           LastPosition = COALESCE(?, LastPosition)
       WHERE Id = ?`
    );

    const result = await db.query(sql, [
      fuelLevel !== undefined ? parseInt(fuelLevel) : null,
      kilometrage !== undefined ? parseInt(kilometrage) : null,
      lastPosition || null,
      parseInt(id),
    ]);

    res.json(result[0] || { success: true });
  } catch (err) {
    console.error('Update vehicle fuel error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تحديث بيانات الوقود: ' + err.message });
  }
});

// ==========================================
// 2. VEHICLE MISSIONS (أوامر تنقل السيارات)
// ==========================================

// GET /api/means/missions (سجل أوامر التنقل بالسيارة)
router.get('/missions', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT m.*, v."Matricule", v."Model"
       FROM "TrackerVehicleMissions" m
       JOIN "TrackerVehicles" v ON m."VehicleId" = v."Id"
       ORDER BY m."Id" DESC
       LIMIT 50`,
      `SELECT TOP 50 m.*, v.Matricule, v.Model
       FROM TrackerVehicleMissions m
       JOIN TrackerVehicles v ON m.VehicleId = v.Id
       ORDER BY m.Id DESC`
    );

    const rows = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Get vehicle missions error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب أوامر التنقل: ' + err.message });
  }
});

// POST /api/means/missions (إصدار أمر تنقل رسمي بالسيارة)
router.post('/missions', async (req, res) => {
  try {
    const { vehicleId, driverName, employeeId, destination, missionPurpose, departureKm, fuelDeparture, notes } = req.body;
    if (!vehicleId || !driverName || !destination) {
      return res.status(400).json({ error: 'معرف المركبة، اسم السائق/الموظف والوجهة مطلوبة' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    // 1. Insert vehicle mission record
    const insertSql = pg_q(pg,
      `INSERT INTO "TrackerVehicleMissions"
        ("VehicleId", "DriverName", "EmployeeId", "Destination", "MissionPurpose", "Status", "DepartureKm", "FuelDeparture", "Notes")
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
       RETURNING *`,
      `INSERT INTO TrackerVehicleMissions
        (VehicleId, DriverName, EmployeeId, Destination, MissionPurpose, Status, DepartureKm, FuelDeparture, Notes)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    );

    const missionResult = await db.query(insertSql, [
      parseInt(vehicleId),
      driverName,
      employeeId ? parseInt(employeeId) : null,
      destination,
      missionPurpose || 'مهمة رقابية وتفتيشية ميدانية',
      parseInt(departureKm) || 0,
      parseInt(fuelDeparture) || 85,
      notes || null,
    ]);

    // 2. Update vehicle status to 'en_mission' and update assigned driver
    const updateVehSql = pg_q(pg,
      `UPDATE "TrackerVehicles"
       SET "Status" = 'en_mission',
           "AssignedDriver" = $1
       WHERE "Id" = $2`,
      `UPDATE TrackerVehicles
       SET Status = 'en_mission',
           AssignedDriver = ?
       WHERE Id = ?`
    );
    await db.query(updateVehSql, [driverName, parseInt(vehicleId)]);

    res.status(201).json({
      success: true,
      message: '✅ تم إصدار أمر التنقل بالمركبة وتوثيقه في قاعدة البيانات بنجاح',
      mission: missionResult[0],
    });
  } catch (err) {
    console.error('Create vehicle mission error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء إصدار أمر التنقل: ' + err.message });
  }
});

// PUT /api/means/missions/:id/close (إنهاء أمر التنقل واسترجاع المركبة)
router.put('/missions/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    const { returnKm, fuelReturn, notes } = req.body;

    const db = await getConnection();
    const pg = isPostgres();

    // 1. Find mission
    const findSql = pg_q(pg,
      `SELECT * FROM "TrackerVehicleMissions" WHERE "Id" = $1`,
      `SELECT * FROM TrackerVehicleMissions WHERE Id = ?`
    );
    const missions = await db.query(findSql, [parseInt(id)]);
    if (!missions || missions.length === 0) {
      return res.status(404).json({ error: 'أمر التنقل غير موجود' });
    }
    const mission = missions[0];

    // 2. Update mission status
    const closeSql = pg_q(pg,
      `UPDATE "TrackerVehicleMissions"
       SET "Status" = 'completed',
           "ReturnTime" = NOW(),
           "ReturnKm" = $1,
           "FuelReturn" = $2,
           "Notes" = COALESCE($3, "Notes")
       WHERE "Id" = $4
       RETURNING *`,
      `UPDATE TrackerVehicleMissions
       SET Status = 'completed',
           ReturnTime = GETDATE(),
           ReturnKm = ?,
           FuelReturn = ?,
           Notes = COALESCE(?, Notes)
       WHERE Id = ?`
    );
    await db.query(closeSql, [
      returnKm !== undefined ? parseInt(returnKm) : null,
      fuelReturn !== undefined ? parseInt(fuelReturn) : null,
      notes || null,
      parseInt(id),
    ]);

    // 3. Set vehicle back to disponible and update km/fuel
    const updateVehSql = pg_q(pg,
      `UPDATE "TrackerVehicles"
       SET "Status" = 'disponible',
           "Kilometrage" = COALESCE($1, "Kilometrage"),
           "FuelLevel" = COALESCE($2, "FuelLevel")
       WHERE "Id" = $3`,
      `UPDATE TrackerVehicles
       SET Status = 'disponible',
           Kilometrage = COALESCE(?, Kilometrage),
           FuelLevel = COALESCE(?, FuelLevel)
       WHERE Id = ?`
    );
    await db.query(updateVehSql, [
      returnKm !== undefined ? parseInt(returnKm) : null,
      fuelReturn !== undefined ? parseInt(fuelReturn) : null,
      mission.VehicleId,
    ]);

    res.json({
      success: true,
      message: '✅ تم إنهاء أمر التنقل واسترجاع المركبة للحظيرة بنجاح',
    });
  } catch (err) {
    console.error('Close vehicle mission error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء إنهاء أمر التنقل: ' + err.message });
  }
});

// ==========================================
// 3. INSPECTION EQUIPMENT (حقائب وتجهيزات التفتيش)
// ==========================================

// GET /api/means/equipment (قائمة العتاد وحقائب التفتيش)
router.get('/equipment', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT * FROM "TrackerEquipments" ORDER BY "Id" ASC`,
      `SELECT * FROM TrackerEquipments ORDER BY Id ASC`
    );

    const rows = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('Get equipment error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب جرد العتاد: ' + err.message });
  }
});

// POST /api/means/equipment (إضافة أو تحديث عتاد رقابي)
router.post('/equipment', async (req, res) => {
  try {
    const { designation, code, totalQuantity, inServiceQuantity, reserveQuantity, status, assignedTo } = req.body;
    if (!designation) {
      return res.status(400).json({ error: 'اسم أو تعيين العتاد مطلوب' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `INSERT INTO "TrackerEquipments"
        ("Designation", "Code", "TotalQuantity", "InServiceQuantity", "ReserveQuantity", "Status", "AssignedTo")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      `INSERT INTO TrackerEquipments
        (Designation, Code, TotalQuantity, InServiceQuantity, ReserveQuantity, Status, AssignedTo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const result = await db.query(sql, [
      designation,
      code || `EQ-${Date.now().toString().slice(-4)}`,
      parseInt(totalQuantity) || 1,
      parseInt(inServiceQuantity) || 1,
      parseInt(reserveQuantity) || 0,
      status || 'conforme',
      assignedTo || 'فرق قمع الغش والمفتشيات',
    ]);

    res.status(201).json(result[0] || { success: true });
  } catch (err) {
    console.error('Create equipment error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تسجيل العتاد: ' + err.message });
  }
});

module.exports = router;
