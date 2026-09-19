const express = require('express');
const router = express.Router();
const { getConnection, isPostgres } = require('../config/database');

const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

// GET settings (or single key)
router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT "Key", "Value", "Description", "UpdatedAt" FROM "TrackerSettings"`,
      `SELECT [Key], [Value], Description, UpdatedAt FROM TrackerSettings`
    );

    const rows = await db.query(sql);
    const settings = {};
    for (const r of rows) {
      const k = r.Key || r.key;
      const v = r.Value || r.value;
      if (k) settings[k] = v;
    }

    // Default morning grace time is 08:45 if not set
    if (!settings['morning_grace_time']) settings['morning_grace_time'] = '08:45';
    if (!settings['work_start_time']) settings['work_start_time'] = '08:00';

    res.json(settings);
  } catch (err) {
    console.error('Get settings error:', err.message);
    res.json({
      morning_grace_time: '08:45',
      work_start_time: '08:00',
    });
  }
});

// POST update a setting
router.post('/', async (req, res) => {
  try {
    const { key, value, description } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    if (pg) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS "TrackerSettings" (
          "Key" VARCHAR(100) PRIMARY KEY,
          "Value" TEXT NOT NULL,
          "Description" TEXT,
          "UpdatedAt" TIMESTAMP DEFAULT NOW()
        );
      `);
      await db.query(
        `INSERT INTO "TrackerSettings" ("Key", "Value", "Description", "UpdatedAt")
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT ("Key") DO UPDATE 
         SET "Value" = EXCLUDED."Value", "Description" = COALESCE(EXCLUDED."Description", "TrackerSettings"."Description"), "UpdatedAt" = NOW()`,
        [key, String(value), description || null]
      );
    } else {
      await db.query(
        `IF EXISTS (SELECT 1 FROM TrackerSettings WHERE [Key] = ?)
           UPDATE TrackerSettings SET [Value] = ?, Description = COALESCE(?, Description), UpdatedAt = GETDATE() WHERE [Key] = ?
         ELSE
           INSERT INTO TrackerSettings ([Key], [Value], Description, UpdatedAt) VALUES (?, ?, ?, GETDATE())`,
        [key, String(value), description || null, key, key, String(value), description || null]
      );
    }

    res.json({ success: true, key, value });
  } catch (err) {
    console.error('Update setting error:', err.message);
    res.status(500).json({ error: 'خطأ في حفظ الإعداد: ' + err.message });
  }
});

module.exports = router;
