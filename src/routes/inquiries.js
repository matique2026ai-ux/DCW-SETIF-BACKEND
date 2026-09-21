const express = require('express');
const router = express.Router();
const { getConnection, isPostgres } = require('../config/database');
const { getTodayAlgeria } = require('../utils/dateUtils');

const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

// GET all inquiries
router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { status, employeeId } = req.query;

    let query = pg_q(pg,
      `SELECT ti."Id" as "Id", ti."EmployeeId" as "EmployeeId", ti."Type" as "Type",
              ti."Subject" as "Subject", ti."IncidentDate" as "IncidentDate", ti."LateMinutes" as "LateMinutes",
              ti."Details" as "Details", ti."Status" as "Status", ti."EmployeeReply" as "EmployeeReply",
              ti."ReplyDate" as "ReplyDate", ti."ReplyDate" as "ReplyAt", ti."DirectorDecision" as "DirectorDecision",
              ti."DirectorNotes" as "DirectorNotes", ti."DeductionDays" as "DeductionDays",
              ti."DecisionDate" as "DecisionDate", ti."DecisionDate" as "DecisionAt", ti."ExecutedAt" as "ExecutedAt", ti."CreatedAt" as "CreatedAt",
              ti."SentAt" as "SentAt",
              e."NomAr" as "NomAr", e."PrenomAr" as "PrenomAr", e."Nom" as "Nom", e."Prenom" as "Prenom",
              e."Service" as "Service", e."Grade" as "Grade",
              sender."NomComplet" as "SentByName",
              execUser."NomComplet" as "ExecutedByName"
       FROM "TrackerInquiries" ti
       JOIN "Employes" e ON ti."EmployeeId" = e."Id"
       LEFT JOIN "UtilisateursSysteme" sender ON ti."SentBy" = sender."Id"
       LEFT JOIN "UtilisateursSysteme" execUser ON ti."ExecutedBy" = execUser."Id"`,
      `SELECT ti.Id, ti.EmployeeId, ti.Type, ti.Subject, ti.IncidentDate, ti.LateMinutes,
              ti.Details, ti.Status, ti.EmployeeReply, ti.ReplyDate, ti.ReplyDate as ReplyAt, ti.DirectorDecision,
              ti.DirectorNotes, ti.DeductionDays, ti.DecisionDate, ti.DecisionDate as DecisionAt, ti.ExecutedAt, ti.CreatedAt,
              ti.SentAt,
              e.NomAr, e.PrenomAr, e.Nom, e.Prenom, e.Service, e.Grade,
              sender.NomComplet as SentByName,
              execUser.NomComplet as ExecutedByName
       FROM TrackerInquiries ti
       JOIN Employes e ON ti.EmployeeId = e.Id
       LEFT JOIN UtilisateursSysteme sender ON ti.SentBy = sender.Id
       LEFT JOIN UtilisateursSysteme execUser ON ti.ExecutedBy = execUser.Id`
    );

    const conditions = [];
    const params = [];

    if (employeeId) {
      conditions.push(pg ? `ti."EmployeeId" = $${params.length + 1}` : 'ti.EmployeeId = ?');
      params.push(parseInt(employeeId));
    }

    if (status) {
      conditions.push(pg ? `ti."Status" = $${params.length + 1}` : 'ti.Status = ?');
      params.push(status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += pg ? ' ORDER BY ti."CreatedAt" DESC' : ' ORDER BY ti.CreatedAt DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get inquiries error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب الاستفسارات الإدارية: ' + err.message });
  }
});

// POST create inquiry (from Bureau du Personnel or Director)
router.post('/', async (req, res) => {
  try {
    const {
      employeeId,
      type,
      subject,
      incidentDate,
      lateMinutes,
      details,
      sentBy,
    } = req.body;

    if (!employeeId || !subject || !sentBy) {
      return res.status(400).json({ error: 'البيانات المطلوبة: employeeId, subject, sentBy' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();

    const insertSql = pg_q(pg,
      `INSERT INTO "TrackerInquiries" 
       ("EmployeeId", "Type", "Subject", "IncidentDate", "LateMinutes", "Details", "Status", "SentBy", "SentAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW())
       RETURNING *`,
      `INSERT INTO TrackerInquiries 
       (EmployeeId, Type, Subject, IncidentDate, LateMinutes, Details, Status, SentBy, SentAt)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, GETDATE())`
    );

    const params = [
      employeeId,
      type || 'unjustified_absence',
      subject,
      incidentDate || today,
      lateMinutes || 0,
      details || null,
      sentBy,
    ];

    let created;
    if (pg) {
      const result = await db.query(insertSql, params);
      created = result[0];
    } else {
      await db.query(insertSql, params);
      const result = await db.query('SELECT TOP 1 * FROM TrackerInquiries ORDER BY Id DESC');
      created = result[0];
    }

    res.status(201).json(created);
  } catch (err) {
    console.error('Create inquiry error:', err.message);
    res.status(500).json({ error: 'خطأ في إنشاء الاستفسار الإداري: ' + err.message });
  }
});

// PUT reply to inquiry (from Inspector / Employee)
router.put('/:id/reply', async (req, res) => {
  try {
    const { reply, attachment } = req.body;
    if (!reply || !reply.trim()) {
      return res.status(400).json({ error: 'نص التبرير والرد مطلوب' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const id = req.params.id;

    const updateSql = pg_q(pg,
      `UPDATE "TrackerInquiries"
       SET "EmployeeReply" = $1,
           "ReplyAttachment" = $2,
           "ReplyDate" = NOW(),
           "Status" = 'answered'
       WHERE "Id" = $3
       RETURNING *`,
      `UPDATE TrackerInquiries
       SET EmployeeReply = ?,
           ReplyAttachment = ?,
           ReplyDate = GETDATE(),
           Status = 'answered'
       WHERE Id = ?`
    );

    const params = [reply.trim(), attachment || null, id];

    if (pg) {
      const result = await db.query(updateSql, params);
      res.json(result[0]);
    } else {
      await db.query(updateSql, params);
      const result = await db.query('SELECT * FROM TrackerInquiries WHERE Id = ?', [id]);
      res.json(result[0]);
    }
  } catch (err) {
    console.error('Reply inquiry error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الرد على الاستفسار: ' + err.message });
  }
});

// PUT Director Decision (justified, warning, deduction)
router.put('/:id/decision', async (req, res) => {
  try {
    const { decision, notes, deductionDays } = req.body;
    // decision: 'justified', 'warning', 'deduction'
    if (!['justified', 'warning', 'deduction'].includes(decision)) {
      return res.status(400).json({ error: 'القرار يجب أن يكون: justified أو warning أو deduction' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const id = req.params.id;

    let newStatus = 'justified';
    if (decision === 'warning') newStatus = 'warning';
    if (decision === 'deduction') newStatus = 'deduction_ordered';

    const updateSql = pg_q(pg,
      `UPDATE "TrackerInquiries"
       SET "DirectorDecision" = $1,
           "DirectorNotes" = $2,
           "DeductionDays" = $3,
           "DecisionDate" = NOW(),
           "Status" = $4
       WHERE "Id" = $5
       RETURNING *`,
      `UPDATE TrackerInquiries
       SET DirectorDecision = ?,
           DirectorNotes = ?,
           DeductionDays = ?,
           DecisionDate = GETDATE(),
           Status = ?
       WHERE Id = ?`
    );

    const params = [decision, notes || null, deductionDays || (decision === 'deduction' ? 1.0 : 0.0), newStatus, id];

    let inquiry;
    if (pg) {
      const result = await db.query(updateSql, params);
      inquiry = result[0];
    } else {
      await db.query(updateSql, params);
      const result = await db.query('SELECT * FROM TrackerInquiries WHERE Id = ?', [id]);
      inquiry = result[0];
    }

    // If deduction ordered, ensure recorded in TrackerDeductions as well
    if (decision === 'deduction') {
      try {
        const empId = inquiry.EmployeeId || inquiry.employeeid;
        const days = deductionDays || 1.0;
        const reason = `قرار خصم نهائي من المدير الولائي بناءً على الاستفسار رقم #${id}: ${inquiry.Subject || inquiry.subject || ''}`;
        
        await db.query(
          pg
            ? `INSERT INTO "TrackerDeductions" ("EmployeeId", "RequestedBy", "ApprovedBy", "Reason", "DaysCount", "Status", "Evidence")
               VALUES ($1, 1, 1, $2, $3, 'approved', $4)`
            : `INSERT INTO TrackerDeductions (EmployeeId, RequestedBy, ApprovedBy, Reason, DaysCount, Status, Evidence)
               VALUES (?, 1, 1, ?, ?, 'approved', ?)`,
          [empId, reason, days, `استفسار #${id}`]
        );
      } catch (dedErr) {
        console.error('Error auto-syncing deduction:', dedErr.message);
      }
    }

    res.json(inquiry);
  } catch (err) {
    console.error('Decision inquiry error:', err.message);
    res.status(500).json({ error: 'خطأ في حفظ قرار المدير: ' + err.message });
  }
});

// PUT Execute Deduction in Payroll (from Bureau du Personnel)
router.put('/:id/execute', async (req, res) => {
  try {
    const { executedBy, executionNotes } = req.body;
    if (!executedBy) {
      return res.status(400).json({ error: 'executedBy مطلوب' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const id = req.params.id;

    const updateSql = pg_q(pg,
      `UPDATE "TrackerInquiries"
       SET "ExecutedBy" = $1,
           "ExecutionNotes" = $2,
           "ExecutedAt" = NOW(),
           "Status" = 'executed'
       WHERE "Id" = $3
       RETURNING *`,
      `UPDATE TrackerInquiries
       SET ExecutedBy = ?,
           ExecutionNotes = ?,
           ExecutedAt = GETDATE(),
           Status = 'executed'
       WHERE Id = ?`
    );

    const params = [executedBy, executionNotes || 'تم إدراج الخصم في كشف الراتب الشهري', id];

    if (pg) {
      const result = await db.query(updateSql, params);
      res.json(result[0]);
    } else {
      await db.query(updateSql, params);
      const result = await db.query('SELECT * FROM TrackerInquiries WHERE Id = ?', [id]);
      res.json(result[0]);
    }
  } catch (err) {
    console.error('Execute inquiry error:', err.message);
    res.status(500).json({ error: 'خطأ في تنفيذ قرار الخصم: ' + err.message });
  }
});

// DELETE inquiry
router.delete('/:id', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const id = req.params.id;

    await db.query(
      pg ? `DELETE FROM "TrackerInquiries" WHERE "Id" = $1` : `DELETE FROM TrackerInquiries WHERE Id = ?`,
      [id]
    );

    res.json({ success: true, message: 'تم حذف الاستفسار بنجاح' });
  } catch (err) {
    console.error('Delete inquiry error:', err.message);
    res.status(500).json({ error: 'خطأ في حذف الاستفسار: ' + err.message });
  }
});

module.exports = router;
