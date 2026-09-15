const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { getTodayAlgeria } = require('../utils/dateUtils');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { service, type } = req.query;

    let query = pg
      ? `SELECT * FROM "TrackerPrograms"`
      : 'SELECT * FROM TrackerPrograms';
    
    const conditions = [];
    const params = [];

    if (service) {
      conditions.push(pg ? `("ServiceName" ILIKE $${params.length + 1} OR "ServiceName" IS NULL)` : '(ServiceName LIKE ? OR ServiceName IS NULL)');
      params.push(`%${service}%`);
    }
    if (type) {
      conditions.push(pg ? `"Type" = $${params.length + 1}` : 'Type = ?');
      params.push(type);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += pg ? ' ORDER BY "CreatedAt" DESC' : ' ORDER BY CreatedAt DESC';

    const result = await db.query(query, params);
    res.json(result);
  } catch (err) {
    console.error('Get programs error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب البرامج الرقابية وأوامر المهمة' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      title, Titre,
      description, Description,
      type, Type,
      weekDate, WeekDate, DateDebut,
      monthYear, MonthYear,
      targetArea, TargetArea, Zone,
      targetType, TargetType,
      focusPoints, FocusPoints,
      createdBy, CreatedBy,
      serviceName, ServiceName
    } = req.body;

    const finalTitle = (title || Titre || '').trim();
    if (!finalTitle) return res.status(400).json({ error: 'عنوان أمر المهمة / البرنامج مطلوب' });

    const finalDesc = description || Description || null;
    const finalType = type || Type || 'daily';
    const finalWeekDate = weekDate || WeekDate || DateDebut || getTodayAlgeria();
    const finalMonth = monthYear || MonthYear || null;
    const finalArea = targetArea || TargetArea || Zone || null;
    const finalTargetType = targetType || TargetType || null;
    const finalFocus = focusPoints || FocusPoints || null;
    const finalCreatedBy = createdBy || CreatedBy || null;
    const finalService = serviceName || ServiceName || null;

    const db = await getConnection();
    const pg = isPostgres();
    await db.query(
      pg
        ? `INSERT INTO "TrackerPrograms" ("Title","Description","Type","WeekDate","MonthYear","TargetArea","TargetType","FocusPoints","CreatedBy","ServiceName","CreatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`
        : 'INSERT INTO TrackerPrograms (Title,Description,Type,WeekDate,MonthYear,TargetArea,TargetType,FocusPoints,CreatedBy,ServiceName,CreatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,GETDATE())',
      [
        finalTitle,
        finalDesc,
        finalType,
        finalWeekDate,
        finalMonth,
        finalArea,
        finalTargetType,
        finalFocus,
        finalCreatedBy,
        finalService,
      ]
    );
    res.status(201).json({ success: true, message: 'تم إنشاء وتعميم أمر المهمة بنجاح' });
  } catch (err) {
    console.error('Create program error:', err.message);
    res.status(500).json({ error: 'خطأ في إنشاء أمر المهمة: ' + err.message });
  }
});

module.exports = router;
