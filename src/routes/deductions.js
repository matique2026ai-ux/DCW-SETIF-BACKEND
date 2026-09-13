const express = require('express');
const { getConnection, isPostgres } = require('../config/database');

const router = express.Router();

const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { status, employeeId } = req.query;

    let query = pg_q(pg,
      `SELECT td."Id",td."EmployeeId",td."Date",td."Reason",td."Amount",td."DaysCount",
              td."Status",td."Evidence",td."RequestedBy",td."ApprovedBy",td."CreatedAt",
              e."NomAr",e."PrenomAr",e."Nom",e."Prenom",e."Service",
              reqUser."NomComplet" as "RequestedByName",
              appUser."NomComplet" as "ApprovedByName"
       FROM "TrackerDeductions" td
       JOIN "Employes" e ON td."EmployeeId" = e."Id"
       JOIN "UtilisateursSysteme" reqUser ON td."RequestedBy" = reqUser."Id"
       LEFT JOIN "UtilisateursSysteme" appUser ON td."ApprovedBy" = appUser."Id"`,
      `SELECT td.Id,td.EmployeeId,td.Date,td.Reason,td.Amount,td.DaysCount,
              td.Status,td.Evidence,td.RequestedBy,td.ApprovedBy,td.CreatedAt,
              e.NomAr,e.PrenomAr,e.Nom,e.Prenom,e.Service,
              reqUser.NomComplet as RequestedByName,
              appUser.NomComplet as ApprovedByName
       FROM TrackerDeductions td
       JOIN Employes e ON td.EmployeeId = e.Id
       JOIN UtilisateursSysteme reqUser ON td.RequestedBy = reqUser.Id
       LEFT JOIN UtilisateursSysteme appUser ON td.ApprovedBy = appUser.Id`
    );
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push(pg ? `td."Status" = $${params.length + 1}` : 'td.Status = ?');
      params.push(status);
    }
    if (employeeId) {
      conditions.push(pg ? `td."EmployeeId" = $${params.length + 1}` : 'td.EmployeeId = ?');
      params.push(parseInt(employeeId));
    }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += pg ? ' ORDER BY td."CreatedAt" DESC' : ' ORDER BY td.CreatedAt DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get deductions error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب طلبات الخصم' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { employeeId, requestedBy, reason, amount, daysCount, evidence } = req.body;
    if (!employeeId || !requestedBy || !reason) {
      return res.status(400).json({ error: 'البيانات المطلوبة: employeeId, requestedBy, reason' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg
        ? `INSERT INTO "TrackerDeductions" ("EmployeeId","RequestedBy","Reason","Amount","DaysCount","Evidence","Status") VALUES ($1,$2,$3,$4,$5,$6,'pending')`
        : `INSERT INTO TrackerDeductions (EmployeeId,RequestedBy,Reason,Amount,DaysCount,Evidence,Status) VALUES (?,?,?,?,?,?,?)`,
      [employeeId, requestedBy, reason, amount || null, daysCount || null, evidence || null]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerDeductions" ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerDeductions ORDER BY Id DESC'
    );
    res.status(201).json(result[0]);
  } catch (err) {
    console.error('Create deduction error:', err.message);
    res.status(500).json({ error: 'خطأ في إنشاء طلب الخصم' });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const { approvedBy } = req.body;
    if (!approvedBy) return res.status(400).json({ error: 'approvedBy مطلوب' });

    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg
        ? `UPDATE "TrackerDeductions" SET "Status"='approved',"ApprovedBy"=$1 WHERE "Id"=$2`
        : `UPDATE TrackerDeductions SET Status='approved',ApprovedBy=? WHERE Id=?`,
      [approvedBy, req.params.id]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerDeductions" WHERE "Id" = $1`
        : 'SELECT * FROM TrackerDeductions WHERE Id = ?',
      [req.params.id]
    );
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الموافقة' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const { approvedBy } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg
        ? `UPDATE "TrackerDeductions" SET "Status"='rejected',"ApprovedBy"=$1 WHERE "Id"=$2`
        : `UPDATE TrackerDeductions SET Status='rejected',ApprovedBy=? WHERE Id=?`,
      [approvedBy, req.params.id]
    );

    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerDeductions" WHERE "Id" = $1`
        : 'SELECT * FROM TrackerDeductions WHERE Id = ?',
      [req.params.id]
    );
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الرفض' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg
        ? `DELETE FROM "TrackerDeductions" WHERE "Id" = $1`
        : `DELETE FROM TrackerDeductions WHERE Id = ?`,
      [req.params.id]
    );
    res.json({ success: true, message: 'تم حذف الخصم بنجاح' });
  } catch (err) {
    console.error('Delete deduction error:', err.message);
    res.status(500).json({ error: 'خطأ في حذف قرار الخصم' });
  }
});

module.exports = router;
