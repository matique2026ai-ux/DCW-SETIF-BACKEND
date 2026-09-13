const express = require('express');
const router = express.Router();
const { getConnection, isPostgres } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { getTodayAlgeria } = require('../utils/dateUtils');

// GET all justifications (filtered by status or employeeId if provided)
router.get('/', verifyToken, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { status, employeeId } = req.query;

    let query = pg
      ? `SELECT j.*, e."Nom" as "Nom", e."Prenom" as "Prenom", e."NomAr" as "NomAr", e."PrenomAr" as "PrenomAr", e."Service" as "Service"
         FROM "TrackerJustifications" j
         JOIN "Employes" e ON j."EmployeeId" = e."Id"
         WHERE 1=1`
      : `SELECT j.*, e.Nom, e.Prenom, e.NomAr, e.PrenomAr, e.Service
         FROM TrackerJustifications j
         JOIN Employes e ON j.EmployeeId = e.Id
         WHERE 1=1`;

    const params = [];
    let idx = 1;

    if (employeeId) {
      query += pg ? ` AND j."EmployeeId" = $${idx++}` : ` AND j.EmployeeId = ?`;
      params.push(parseInt(employeeId));
    }

    if (status) {
      query += pg ? ` AND j."Status" = $${idx++}` : ` AND j.Status = ?`;
      params.push(status);
    }

    query += pg ? ` ORDER BY j."CreatedAt" DESC` : ` ORDER BY j.CreatedAt DESC`;

    const result = await db.query(query, params);
    res.json(result.rows || result.recordset || []);
  } catch (err) {
    console.error('Get justifications error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve justifications' });
  }
});

// POST submit a new justification (for absent employee)
router.post('/', verifyToken, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const {
      employeeId,
      type,
      title,
      startDate,
      endDate,
      daysCount,
      documentPhoto,
      notes
    } = req.body;

    const empId = employeeId || req.user.EmployeeId;
    if (!empId) {
      return res.status(400).json({ error: 'EmployeeId is required' });
    }

    const query = pg
      ? `INSERT INTO "TrackerJustifications" 
         ("EmployeeId", "Type", "Title", "StartDate", "EndDate", "DaysCount", "DocumentPhoto", "Notes", "Status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         RETURNING *`
      : `INSERT INTO TrackerJustifications 
         (EmployeeId, Type, Title, StartDate, EndDate, DaysCount, DocumentPhoto, Notes, Status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`;

    const params = [
      empId,
      type || 'general',
      title || 'تبرير غياب',
      startDate || getTodayAlgeria(),
      endDate || getTodayAlgeria(),
      daysCount || 1,
      documentPhoto || null,
      notes || null
    ];

    const result = await db.query(query, params);
    const created = (result.rows && result.rows[0]) || (result.recordset && result.recordset[0]) || { success: true };

    res.status(201).json({
      message: 'تم إرسال تبرير الغياب بنجاح وهو قيد المراجعة الإدارية',
      justification: created
    });
  } catch (err) {
    console.error('Create justification error:', err.message);
    res.status(500).json({ error: 'Failed to submit justification' });
  }
});

// PUT review justification (approve / reject)
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { id } = req.params;
    const { status, reviewNotes } = req.body; // 'approved' or 'rejected'
    const reviewerId = req.user.Id;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const query = pg
      ? `UPDATE "TrackerJustifications" 
         SET "Status" = $1, "ReviewedBy" = $2, "ReviewNotes" = $3
         WHERE "Id" = $4
         RETURNING *`
      : `UPDATE TrackerJustifications 
         SET Status = ?, ReviewedBy = ?, ReviewNotes = ?
         WHERE Id = ?`;

    const params = [status, reviewerId, reviewNotes || null, parseInt(id)];
    const result = await db.query(query, params);

    res.json({
      message: status === 'approved' ? 'تمت المصادقة على التبرير بنجاح' : 'تم رفض التبرير',
      justification: (result.rows && result.rows[0]) || { id, status }
    });
  } catch (err) {
    console.error('Update justification error:', err.message);
    res.status(500).json({ error: 'Failed to update justification status' });
  }
});

module.exports = router;
