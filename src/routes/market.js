const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { authMiddleware, roleGuard } = require('../middleware/auth');

const router = express.Router();
const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

// ==========================================
// 1. MARKET COMMODITY PRICES (أسعار المواد وضبط السوق)
// ==========================================

// GET /api/market/prices
router.get('/prices', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT * FROM "TrackerMarketPrices" ORDER BY "Category" ASC, "CommodityName" ASC`,
      `SELECT * FROM TrackerMarketPrices ORDER BY Category ASC, CommodityName ASC`
    );

    let rows = await db.query(sql);

    // If table is newly created and empty, seed authentic Algerian staple commodities
    if (!rows || rows.length === 0) {
      const defaultCommodities = [
        { name: 'حليب مبستر مدعم 25 دج', cat: 'مواد مقننة واسعة الاستهلاك', reg: 25.00, whole: 24.50, retail: 25.00, unit: 'كيس 1 لتر', loc: 'ولاية سطيف', status: 'sufficient', notes: 'سعر مقنن مدعم إلزامياً بالمرسوم التنفيذي' },
        { name: 'دقيق القمح الصلب الممتاز (سميد)', cat: 'مواد مقننة واسعة الاستهلاك', reg: 1000.00, whole: 950.00, retail: 1000.00, unit: 'كيس 10 كلغ', loc: 'مطاحن سطيف والعلمة', status: 'sufficient', notes: 'سعر مقنن مدعم' },
        { name: 'زيت المائدة الصافي (صويا)', cat: 'مواد مقننة واسعة الاستهلاك', reg: 600.00, whole: 580.00, retail: 600.00, unit: 'صفيحة 5 لتر', loc: 'ولاية سطيف', status: 'sufficient', notes: 'سعر مقنن ومسقف' },
        { name: 'السكر الأبيض المبلور', cat: 'مواد مقننة واسعة الاستهلاك', reg: 90.00, whole: 85.00, retail: 90.00, unit: '1 كلغ معبأ', loc: 'ولاية سطيف', status: 'sufficient', notes: 'سعر مقنن ومسقف' },
        { name: 'الخبز العادي المدعم', cat: 'مواد مقننة واسعة الاستهلاك', reg: 10.00, whole: 8.50, retail: 10.00, unit: 'خبزة 250 غرام', loc: 'مخابز الولاية', status: 'sufficient', notes: 'سعر مقنن ملزم لكافة المخابز' },
        { name: 'البطاطا الحقلية الاستهلاكية', cat: 'خضر وفواكه طازجة', reg: 65.00, whole: 55.00, retail: 65.00, unit: '1 كلغ', loc: 'سوق الجملة للخضر والفواكه سطيف', status: 'abundant', notes: 'وفرة عالية مع استقرار الأسعار' },
        { name: 'الطماطم الطازجة', cat: 'خضر وفواكه طازجة', reg: 90.00, whole: 70.00, retail: 90.00, unit: '1 كلغ', loc: 'أسواق التجزئة سطيف والعلمة', status: 'sufficient', notes: 'تموين منتظم' },
        { name: 'البصل الجاف', cat: 'خضر وفواكه طازجة', reg: 50.00, whole: 40.00, retail: 50.00, unit: '1 كلغ', loc: 'أسواق ولاية سطيف', status: 'sufficient', notes: 'مخزون استراتيجي كافٍ' },
        { name: 'لحوم الأبقار الطازجة المستوردة', cat: 'لحوم ودواجن', reg: 1350.00, whole: 1250.00, retail: 1350.00, unit: '1 كلغ', loc: 'القصابات المعتمدة بسطيف', status: 'sufficient', notes: 'سعر مرجعي مسقف للمستورد' },
        { name: 'لحم الدجاج المذبوح', cat: 'لحوم ودواجن', reg: 380.00, whole: 330.00, retail: 380.00, unit: '1 كلغ', loc: 'أسواق التجزئة والقصابات', status: 'fluctuating', notes: 'متابعة دورية للوفرة في المذابح' },
        { name: 'البيض الاستهلاكي', cat: 'مواد غذائية عامة', reg: 20.00, whole: 18.00, retail: 20.00, unit: 'حبة بيض', loc: 'أسواق الولاية', status: 'sufficient', notes: 'تموين طبيعي' },
      ];

      for (const item of defaultCommodities) {
        const insertSql = pg_q(pg,
          `INSERT INTO "TrackerMarketPrices" ("CommodityName", "Category", "RegulatedPrice", "WholesalePrice", "RetailPrice", "Unit", "MarketLocation", "SupplyStatus", "Notes")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          `INSERT INTO TrackerMarketPrices (CommodityName, Category, RegulatedPrice, WholesalePrice, RetailPrice, Unit, MarketLocation, SupplyStatus, Notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        await db.query(insertSql, [item.name, item.cat, item.reg, item.whole, item.retail, item.unit, item.loc, item.status, item.notes]);
      }
      rows = await db.query(sql);
    }

    res.json(rows);
  } catch (err) {
    console.error('Get market prices error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب أسعار المواد وضبط السوق: ' + err.message });
  }
});

// POST /api/market/prices (تسجيل مادة جديدة أو تحديث سعر)
router.post('/prices', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: تسجيل أسعار المواد محصور برؤساء المصالح والمدير الولائي' });
    }
    const { commodityName, category, regulatedPrice, wholesalePrice, retailPrice, unit, marketLocation, supplyStatus, notes, recordedBy } = req.body;
    if (!commodityName) {
      return res.status(400).json({ error: 'اسم المادة الاستهلاكية مطلوب' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `INSERT INTO "TrackerMarketPrices" ("CommodityName", "Category", "RegulatedPrice", "WholesalePrice", "RetailPrice", "Unit", "MarketLocation", "SupplyStatus", "Notes", "RecordedBy", "RecordedDate")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE)
       RETURNING *`,
      `INSERT INTO TrackerMarketPrices (CommodityName, Category, RegulatedPrice, WholesalePrice, RetailPrice, Unit, MarketLocation, SupplyStatus, Notes, RecordedBy, RecordedDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE());
       SELECT TOP 1 * FROM TrackerMarketPrices WHERE CommodityName = ? ORDER BY Id DESC;`
    );

    const params = [
      commodityName.trim(),
      category || 'مواد استهلاكية عامة',
      parseFloat(regulatedPrice) || 0,
      parseFloat(wholesalePrice) || 0,
      parseFloat(retailPrice) || 0,
      unit || 'كلغ',
      marketLocation || 'ولاية سطيف',
      supplyStatus || 'sufficient',
      notes || null,
      recordedBy || null,
    ];

    if (!pg) params.push(commodityName.trim());

    const result = await db.query(sql, params);
    res.json(result[0] || { success: true });
  } catch (err) {
    console.error('Create market price error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تسجيل سعر المادة: ' + err.message });
  }
});

// PUT /api/market/prices/:id (تحديث رصد مادة وسعرها)
router.put('/prices/:id', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: تحيين أسعار المواد محصور برؤساء المصالح والمدير الولائي' });
    }
    const { id } = req.params;
    const { regulatedPrice, wholesalePrice, retailPrice, supplyStatus, marketLocation, notes } = req.body;

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `UPDATE "TrackerMarketPrices"
       SET "RegulatedPrice" = COALESCE($1, "RegulatedPrice"),
           "WholesalePrice" = COALESCE($2, "WholesalePrice"),
           "RetailPrice" = COALESCE($3, "RetailPrice"),
           "SupplyStatus" = COALESCE($4, "SupplyStatus"),
           "MarketLocation" = COALESCE($5, "MarketLocation"),
           "Notes" = COALESCE($6, "Notes"),
           "RecordedDate" = CURRENT_DATE
       WHERE "Id" = $7
       RETURNING *`,
      `UPDATE TrackerMarketPrices
       SET RegulatedPrice = COALESCE(?, RegulatedPrice),
           WholesalePrice = COALESCE(?, WholesalePrice),
           RetailPrice = COALESCE(?, RetailPrice),
           SupplyStatus = COALESCE(?, SupplyStatus),
           MarketLocation = COALESCE(?, MarketLocation),
           Notes = COALESCE(?, Notes),
           RecordedDate = GETDATE()
       WHERE Id = ?;
       SELECT * FROM TrackerMarketPrices WHERE Id = ?;`
    );

    const params = [
      regulatedPrice !== undefined ? parseFloat(regulatedPrice) : null,
      wholesalePrice !== undefined ? parseFloat(wholesalePrice) : null,
      retailPrice !== undefined ? parseFloat(retailPrice) : null,
      supplyStatus || null,
      marketLocation || null,
      notes || null,
      id
    ];
    if (!pg) params.push(id);

    const result = await db.query(sql, params);
    res.json(result[0] || { success: true });
  } catch (err) {
    console.error('Update market price error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء تحديث سعر المادة: ' + err.message });
  }
});

// DELETE /api/market/prices/:id
router.delete('/prices/:id', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: حذف المواد محصور برؤساء المصالح والمدير الولائي' });
    }
    const { id } = req.params;
    const db = await getConnection();
    const pg = isPostgres();

    await db.query(
      pg ? 'DELETE FROM "TrackerMarketPrices" WHERE "Id" = $1' : 'DELETE FROM TrackerMarketPrices WHERE Id = ?',
      [id]
    );
    res.json({ success: true, message: 'تم حذف المادة بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في حذف المادة: ' + err.message });
  }
});

// ==========================================
// 2. SUPPLY ALERTS & DISPATCH (الإخطارات التموينية والإنذار المبكر)
// ==========================================

// GET /api/market/alerts
router.get('/alerts', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT * FROM "TrackerSupplyAlerts" ORDER BY "CreatedAt" DESC`,
      `SELECT * FROM TrackerSupplyAlerts ORDER BY CreatedAt DESC`
    );

    let rows = await db.query(sql);

    // Initial seed alerts if empty
    if (!rows || rows.length === 0) {
      const defaultAlerts = [
        {
          title: 'تذبذب طفيف في تموين حليب الأكياس 25 دج بوسط مدينة العلمة',
          desc: 'لوحظ نقص في نقاط التوزيع بحي صخري بسبب تأخر تفريغ شحنة الملبنة. تم إشعار المفتشية الإقليمية بالعلمة لمراقبة مسار الشاحنات.',
          item: 'حليب مبستر مدعم 25 دج',
          muni: 'العلمة',
          sev: 'medium',
          status: 'dispatched',
          service: 'مصلحة حماية المستهلك وقمع الغش'
        },
        {
          title: 'مراقبة فواتير توزيع الزيت الغذائي وسلسلة الإمداد بسوق الجملة',
          desc: 'تعليمات لمتابعة كبار تجار الجملة والتأكد من عدم حجب مادة زيت الصويا 5 لتر عن تجار التجزئة بالمنطقة الصناعية سطيف.',
          item: 'زيت المائدة 5 لتر',
          muni: 'سطيف',
          sev: 'high',
          status: 'open',
          service: 'مصلحة المنافسة والتحقيقات الاقتصادية'
        }
      ];

      for (const a of defaultAlerts) {
        const insertSql = pg_q(pg,
          `INSERT INTO "TrackerSupplyAlerts" ("Title", "Description", "CommodityName", "Municipality", "Severity", "Status", "DispatchedToService")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          `INSERT INTO TrackerSupplyAlerts (Title, Description, CommodityName, Municipality, Severity, Status, DispatchedToService)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        await db.query(insertSql, [a.title, a.desc, a.item, a.muni, a.sev, a.status, a.service]);
      }
      rows = await db.query(sql);
    }

    res.json(rows);
  } catch (err) {
    console.error('Get supply alerts error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب إخطارات التموين: ' + err.message });
  }
});

// POST /api/market/alerts (إصدار إخطار تمويني استباقي وتوجيهه لفرق الرقابة)
router.post('/alerts', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: إطلاق إخطارات التموين محصور برؤساء المصالح والمدير الولائي' });
    }
    const { title, description, commodityName, municipality, severity, dispatchedToService, createdBy } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'عنوان الإخطار التمويني مطلوب' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `INSERT INTO "TrackerSupplyAlerts" ("Title", "Description", "CommodityName", "Municipality", "Severity", "Status", "DispatchedToService", "CreatedBy")
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)
       RETURNING *`,
      `INSERT INTO TrackerSupplyAlerts (Title, Description, CommodityName, Municipality, Severity, Status, DispatchedToService, CreatedBy)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?);
       SELECT TOP 1 * FROM TrackerSupplyAlerts ORDER BY Id DESC;`
    );

    const params = [
      title.trim(),
      description || '',
      commodityName || 'مواد عامة',
      municipality || 'سطيف',
      severity || 'medium',
      dispatchedToService || 'مصلحة حماية المستهلك وقمع الغش',
      createdBy || null
    ];

    const result = await db.query(sql, params);
    res.json(result[0] || { success: true });
  } catch (err) {
    console.error('Create supply alert error:', err.message);
    res.status(500).json({ error: 'خطأ في إنشاء الإخطار التمويني: ' + err.message });
  }
});

// PUT /api/market/alerts/:id/status (تحديث حالة الإخطار)
router.put('/alerts/:id/status', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: معالجة الإخطارات محصورة برؤساء المصالح والمدير الولائي' });
    }
    const { id } = req.params;
    const { status } = req.body; // 'open', 'dispatched', 'resolved'

    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `UPDATE "TrackerSupplyAlerts" SET "Status" = $1 WHERE "Id" = $2 RETURNING *`,
      `UPDATE TrackerSupplyAlerts SET Status = ? WHERE Id = ?; SELECT * FROM TrackerSupplyAlerts WHERE Id = ?;`
    );

    const params = [status || 'dispatched', id];
    if (!pg) params.push(id);

    const result = await db.query(sql, params);
    res.json(result[0] || { success: true });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تحديث حالة الإخطار: ' + err.message });
  }
});

// ==========================================
// 3. DAILY MARKET BULLETIN (النشرة اليومية لضبط السوق)
// ==========================================

// GET /api/market/bulletin
router.get('/bulletin', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const prices = await db.query(pg ? 'SELECT * FROM "TrackerMarketPrices"' : 'SELECT * FROM TrackerMarketPrices');
    const alerts = await db.query(pg ? 'SELECT * FROM "TrackerSupplyAlerts" WHERE "Status" != \'resolved\' ORDER BY "CreatedAt" DESC' : 'SELECT * FROM TrackerSupplyAlerts WHERE Status != \'resolved\' ORDER BY CreatedAt DESC');

    const totalTracked = prices.length;
    const stableCount = prices.filter(p => (p.SupplyStatus || p.supplystatus) === 'abundant' || (p.SupplyStatus || p.supplystatus) === 'sufficient').length;
    const fluctuatingCount = prices.filter(p => (p.SupplyStatus || p.supplystatus) === 'fluctuating').length;
    const scarceCount = prices.filter(p => (p.SupplyStatus || p.supplystatus) === 'scarce').length;

    res.json({
      date: new Date().toISOString().split('T')[0],
      directorate: 'مديرية التجارة الداخلية وضبط السوق الوطنية لولاية سطيف',
      service: 'مصلحة ملاحظة السوق وضبط التموين والأسعار',
      statistics: {
        totalTracked,
        stableCount,
        fluctuatingCount,
        scarceCount,
        activeAlertsCount: alerts.length,
      },
      commodities: prices,
      activeAlerts: alerts,
    });
  } catch (err) {
    console.error('Get market bulletin error:', err.message);
    res.status(500).json({ error: 'خطأ في استخراج النشرة اليومية للسوق: ' + err.message });
  }
});

module.exports = router;
