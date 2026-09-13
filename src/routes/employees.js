const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

// GET all employees with administrative status & brigade assignment
router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { department, active, all, status, brigade } = req.query;

    const query = pg
      ? `SELECT e."Id", e."NumeroMatricule", e."Nom", e."Prenom", e."NomAr", e."PrenomAr", e."Grade",
                COALESCE(a."AssignedDepartment", e."Service") as "Service",
                COALESCE(a."AssignedPosition", e."FonctionExercee") as "FonctionExercee",
                e."PosteFinancier", e."EstActif",
                COALESCE(a."AdministrativeStatus", 'active') as "AdministrativeStatus",
                COALESCE(a."IsBrigadeLeader", false) as "IsBrigadeLeader",
                a."BrigadeName", a."StatusStartDate", a."StatusEndDate", a."StatusNotes",
                a."UpdatedAt"
         FROM "Employes" e
         LEFT JOIN "TrackerEmployeeAdmin" a ON e."Id" = a."EmployeeId"
         ORDER BY e."Service", e."Nom", e."Prenom"`
      : `SELECT e.Id, e.NumeroMatricule, e.Nom, e.Prenom, e.NomAr, e.PrenomAr, e.Grade,
                COALESCE(a.AssignedDepartment, e.Service) as Service,
                COALESCE(a.AssignedPosition, e.FonctionExercee) as FonctionExercee,
                e.PosteFinancier, e.EstActif,
                COALESCE(a.AdministrativeStatus, 'active') as AdministrativeStatus,
                COALESCE(a.IsBrigadeLeader, 0) as IsBrigadeLeader,
                a.BrigadeName, a.StatusStartDate, a.StatusEndDate, a.StatusNotes,
                a.UpdatedAt
         FROM Employes e
         LEFT JOIN TrackerEmployeeAdmin a ON e.Id = a.EmployeeId
         ORDER BY e.Service, e.Nom, e.Prenom`;

    const result = await db.query(query, []);

    let filtered = result;

    // If 'all' is not explicitly requested, default to target inspection departments unless filtered
    if (all !== 'true') {
      filtered = result.filter(r =>
        r.Service && TARGET_DEPARTMENTS.some(d => r.Service.includes(d))
      );
    }

    if (department) {
      filtered = filtered.filter(r =>
        r.Service && r.Service.toLowerCase().includes(department.toLowerCase())
      );
    }

    if (status) {
      filtered = filtered.filter(r =>
        r.AdministrativeStatus && r.AdministrativeStatus.toLowerCase() === status.toLowerCase()
      );
    }

    if (brigade === 'true') {
      filtered = filtered.filter(r =>
        r.IsBrigadeLeader === true || r.IsBrigadeLeader === 1
      );
    }

    res.json(filtered);
  } catch (err) {
    console.error('Get employees error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب البيانات' });
  }
});

// Update Employee Administrative Status / Brigade Leader / Department Transfer
router.put('/:id/admin-status', verifyToken, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const employeeId = parseInt(req.params.id);
    const {
      administrativeStatus,
      statusStartDate,
      statusEndDate,
      statusNotes,
      isBrigadeLeader,
      brigadeName,
      assignedDepartment,
      assignedPosition
    } = req.body;

    const updatedBy = req.user ? req.user.id : null;

    if (pg) {
      await db.query(
        `INSERT INTO "TrackerEmployeeAdmin" (
          "EmployeeId", "AdministrativeStatus", "StatusStartDate", "StatusEndDate",
          "StatusNotes", "IsBrigadeLeader", "BrigadeName", "AssignedDepartment",
          "AssignedPosition", "UpdatedBy", "UpdatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT ("EmployeeId") DO UPDATE SET
          "AdministrativeStatus" = EXCLUDED."AdministrativeStatus",
          "StatusStartDate" = EXCLUDED."StatusStartDate",
          "StatusEndDate" = EXCLUDED."StatusEndDate",
          "StatusNotes" = EXCLUDED."StatusNotes",
          "IsBrigadeLeader" = EXCLUDED."IsBrigadeLeader",
          "BrigadeName" = EXCLUDED."BrigadeName",
          "AssignedDepartment" = EXCLUDED."AssignedDepartment",
          "AssignedPosition" = EXCLUDED."AssignedPosition",
          "UpdatedBy" = EXCLUDED."UpdatedBy",
          "UpdatedAt" = NOW()`,
        [
          employeeId,
          administrativeStatus || 'active',
          statusStartDate || null,
          statusEndDate || null,
          statusNotes || null,
          isBrigadeLeader === true,
          brigadeName || null,
          assignedDepartment || null,
          assignedPosition || null,
          updatedBy
        ]
      );
    } else {
      await db.query(
        `IF EXISTS (SELECT 1 FROM TrackerEmployeeAdmin WHERE EmployeeId = ?)
         BEGIN
           UPDATE TrackerEmployeeAdmin SET
             AdministrativeStatus = ?, StatusStartDate = ?, StatusEndDate = ?,
             StatusNotes = ?, IsBrigadeLeader = ?, BrigadeName = ?,
             AssignedDepartment = ?, AssignedPosition = ?, UpdatedBy = ?, UpdatedAt = GETDATE()
           WHERE EmployeeId = ?
         END
         ELSE
         BEGIN
           INSERT INTO TrackerEmployeeAdmin (
             EmployeeId, AdministrativeStatus, StatusStartDate, StatusEndDate,
             StatusNotes, IsBrigadeLeader, BrigadeName, AssignedDepartment,
             AssignedPosition, UpdatedBy, UpdatedAt
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
         END`,
        [
          employeeId,
          administrativeStatus || 'active', statusStartDate || null, statusEndDate || null,
          statusNotes || null, isBrigadeLeader ? 1 : 0, brigadeName || null,
          assignedDepartment || null, assignedPosition || null, updatedBy,
          employeeId,
          employeeId,
          administrativeStatus || 'active', statusStartDate || null, statusEndDate || null,
          statusNotes || null, isBrigadeLeader ? 1 : 0, brigadeName || null,
          assignedDepartment || null, assignedPosition || null, updatedBy
        ]
      );
    }

    res.json({ success: true, message: 'تم تحديث الوضعية الإدارية والتكليف بنجاح' });
  } catch (err) {
    console.error('Update employee admin status error:', err.message);
    res.status(500).json({ error: 'خطأ في تحديث البيانات الإدارية' });
  }
});

router.get('/departments', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const result = await db.query(
      pg
        ? `SELECT DISTINCT "Service" FROM "Employes" WHERE "Service" IS NOT NULL AND "EstActif" = true ORDER BY "Service"`
        : 'SELECT DISTINCT Service FROM Employes WHERE Service IS NOT NULL AND EstActif = 1 ORDER BY Service'
    );
    res.json(result.map(r => r.Service).filter(d =>
      TARGET_DEPARTMENTS.some(t => d.includes(t))
    ));
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/all-departments', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const result = await db.query(
      pg
        ? `SELECT DISTINCT "Service" FROM "Employes" WHERE "Service" IS NOT NULL AND "EstActif" = true ORDER BY "Service"`
        : 'SELECT DISTINCT Service FROM Employes WHERE Service IS NOT NULL AND EstActif = 1 ORDER BY Service'
    );
    res.json(result.map(r => r.Service));
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const result = await db.query(
      pg
        ? `SELECT e.*, 
                  COALESCE(a."AdministrativeStatus", 'active') as "AdministrativeStatus",
                  COALESCE(a."IsBrigadeLeader", false) as "IsBrigadeLeader",
                  a."BrigadeName", a."StatusStartDate", a."StatusEndDate", a."StatusNotes",
                  a."AssignedDepartment", a."AssignedPosition"
           FROM "Employes" e
           LEFT JOIN "TrackerEmployeeAdmin" a ON e."Id" = a."EmployeeId"
           WHERE e."Id" = $1`
        : `SELECT e.*, 
                  COALESCE(a.AdministrativeStatus, 'active') as AdministrativeStatus,
                  COALESCE(a.IsBrigadeLeader, 0) as IsBrigadeLeader,
                  a.BrigadeName, a.StatusStartDate, a.StatusEndDate, a.StatusNotes,
                  a.AssignedDepartment, a.AssignedPosition
           FROM Employes e
           LEFT JOIN TrackerEmployeeAdmin a ON e.Id = a.EmployeeId
           WHERE e.Id = ?`,
      [req.params.id]
    );
    if (!result || result.length === 0) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
