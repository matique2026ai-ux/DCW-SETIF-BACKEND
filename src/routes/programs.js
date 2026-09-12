const express = require('express');
const { getConnection, isPostgres } = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerPrograms" ORDER BY "CreatedAt" DESC`
        : 'SELECT * FROM TrackerPrograms ORDER BY CreatedAt DESC'
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب البرامج' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, type, weekDate, monthYear, createdBy } = req.body;
    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg
        ? `INSERT INTO "TrackerPrograms" ("Title","Type","WeekDate","MonthYear","CreatedBy") VALUES ($1,$2,$3,$4,$5)`
        : 'INSERT INTO TrackerPrograms (Title,Type,WeekDate,MonthYear,CreatedBy) VALUES (?,?,?,?,?)',
      [title, type || 'weekly', weekDate || null, monthYear || null, createdBy || null]
    );
    res.status(201).json({ message: 'تم إنشاء البرنامج' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنشاء البرنامج' });
  }
});

module.exports = router;
