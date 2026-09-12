const express = require('express');
const { getConnection } = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const result = await db.query('SELECT * FROM TrackerPrograms ORDER BY CreatedAt DESC');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب البرامج' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, type, weekDate, monthYear, createdBy } = req.body;
    const db = await getConnection();
    await db.query(
      'INSERT INTO TrackerPrograms (Title, Type, WeekDate, MonthYear, CreatedBy) VALUES (?, ?, ?, ?, ?)',
      [title, type || 'weekly', weekDate || null, monthYear || null, createdBy || null]
    );
    res.status(201).json({ message: 'تم إنشاء البرنامج' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنشاء البرنامج' });
  }
});

module.exports = router;
