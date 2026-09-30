const express = require('express');
const { getConnection, isPostgres } = require('../config/database');
const { authMiddleware, roleGuard } = require('../middleware/auth');
const {
  encryptText,
  decryptVisitsList,
  decryptClosureRecord,
  decryptClosuresList,
  decryptCourtRecord,
  decryptCourtsList,
} = require('../utils/cryptoUtils');

const router = express.Router();
const pg_q = (pg, sql_pg, sql_mssql) => pg ? sql_pg : sql_mssql;

// ==========================================
// 1. INSPECTION PVS INBOX (صندوق تدقيق المحاضر الميدانية)
// ==========================================

// GET /api/contentieux/pvs (استعراض المحاضر الميدانية للمخالفات)
router.get('/pvs', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT v.*,
              e."NomAr" AS "InspectorNomAr",
              e."PrenomAr" AS "InspectorPrenomAr",
              e."Nom" AS "InspectorNom",
              e."Prenom" AS "InspectorPrenom",
              e."NumeroMatricule" AS "InspectorMatricule",
              e."Service" AS "InspectorService",
              co."Id" AS "ClosureOrderId",
              co."Status" AS "ClosureStatus"
       FROM "TrackerVisits" v
       LEFT JOIN "Employes" e ON v."EmployeeId" = e."Id"
       LEFT JOIN "TrackerClosureOrders" co ON v."Id" = co."RelatedVisitId"
       WHERE v."ViolationFound" = true OR v."ViolationType" IS NOT NULL
       ORDER BY v."CreatedAt" DESC`,
      `SELECT v.*,
              e.NomAr AS InspectorNomAr,
              e.PrenomAr AS InspectorPrenomAr,
              e.Nom AS InspectorNom,
              e.Prenom AS InspectorPrenom,
              e.NumeroMatricule AS InspectorMatricule,
              e.Service AS InspectorService,
              co.Id AS ClosureOrderId,
              co.Status AS ClosureStatus
       FROM TrackerVisits v
       LEFT JOIN Employes e ON v.EmployeeId = e.Id
       LEFT JOIN TrackerClosureOrders co ON v.Id = co.RelatedVisitId
       WHERE v.ViolationFound = 1 OR v.ViolationType IS NOT NULL
       ORDER BY v.CreatedAt DESC`
    );

    const rows = await db.query(sql);
    res.json(decryptVisitsList(rows));
  } catch (err) {
    console.error('Get contentieux PVs error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب محاضر المخالفات: ' + err.message });
  }
});

// ==========================================
// 2. ADMINISTRATIVE CLOSURE ORDERS (قرارات الغلق الإداري)
// ==========================================

// GET /api/contentieux/closures
router.get('/closures', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT * FROM "TrackerClosureOrders" ORDER BY "CreatedAt" DESC`,
      `SELECT * FROM TrackerClosureOrders ORDER BY CreatedAt DESC`
    );

    let rows = await db.query(sql);

    // Initial seed closures if empty
    if (!rows || rows.length === 0) {
      const defaultClosures = [
        {
          num: '2026/غ.إ/038',
          est: 'ملحمة وقصابة البركة',
          reg: '19/00-1458921B26',
          owner: 'بن حمودة سفيان',
          addr: 'حي 1014 مسكن، سطيف',
          muni: 'سطيف',
          inf: 'عرض لحوم حمراء وبيضاء غير خاضعة للمراقبة البيطرية وانعدام النظافة الصحية الصارمة',
          legal: 'القانون 09-03 المتعلق بحماية المستهلك وقمع الغش والمرسوم التنفيذي المحدد لشروط النظافة',
          days: 30,
          status: 'executed',
          notes: 'تم تشميع المحل بالتنسيق مع الأمن الحضري الخامس بتاريخ 28 سبتمبر 2026'
        },
        {
          num: '2026/غ.إ/039',
          est: 'مستودع تجارة المواد الغذائية بالجملة (شركة الأوراس للتوزيع)',
          reg: '19/00-2983741A26',
          owner: 'رحماني عبد القادر',
          addr: 'المنطقة الصناعية العلمة',
          muni: 'العلمة',
          inf: 'ممارسة المضاربة غير المشروعة وحجب كميات معتبرة من مادة زيت المائدة والسميد مع انعدام الفوترة',
          legal: 'القانون رقم 21-15 المتعلق بمكافحة المضاربة غير المشروعة والقانون 04-02',
          days: 60,
          status: 'approved_by_director',
          notes: 'تم توقيع القرار من طرف السيد المدير الولائي وفي انتظار تبليغ مصالح الدرك للتنفيذ'
        },
        {
          num: '2026/غ.إ/040',
          est: 'مخبزة وحلويات التاج الذهبي',
          reg: '19/00-0876542B26',
          owner: 'سعيدي نور الدين',
          addr: 'شارع 08 ماي 1945، عين ولمان',
          muni: 'عين ولمان',
          inf: 'استعمال مواد أولية مجهولة المصدر ومنتهية الصلاحية في صناعة المرطبات',
          legal: 'القانون 09-03 المتعلق بحماية المستهلك وقمع الغش',
          days: 15,
          status: 'submitted_to_director',
          notes: 'مسودة قرار غلق قيد العرض على السيد المدير الولائي للاعتماد'
        }
      ];

      for (const c of defaultClosures) {
        const insertSql = pg_q(pg,
          `INSERT INTO "TrackerClosureOrders" ("OrderNumber", "EstablishmentName", "CommercialRegister", "OwnerName", "Address", "Municipality", "InfractionType", "LegalBasis", "DurationDays", "Status", "Notes", "DirectorSignatureDate", "ExecutionDate")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
          `INSERT INTO TrackerClosureOrders (OrderNumber, EstablishmentName, CommercialRegister, OwnerName, Address, Municipality, InfractionType, LegalBasis, DurationDays, Status, Notes, DirectorSignatureDate, ExecutionDate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())`
        );
        await db.query(insertSql, [c.num, c.est, c.reg, c.owner, c.addr, c.muni, c.inf, c.legal, c.days, c.status, c.notes]);
      }
      rows = await db.query(sql);
    }

    res.json(decryptClosuresList(rows));
  } catch (err) {
    console.error('Get closure orders error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب قرارات الغلق الإداري: ' + err.message });
  }
});

// POST /api/contentieux/closures (إعداد مسودة قرار غلق إداري جديد)
router.post('/closures', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: إعداد قرارات الغلق الإداري محصور برؤساء المصالح والمدير الولائي' });
    }

    const {
      orderNumber,
      establishmentName,
      commercialRegister,
      ownerName,
      address,
      municipality,
      infractionType,
      legalBasis,
      durationDays,
      relatedVisitId,
      draftedBy,
      notes
    } = req.body;

    if (!establishmentName || !infractionType) {
      return res.status(400).json({ error: 'اسم المؤسسة/المحل وطبيعة المخالفة مطلوبان لإصدار قرار الغلق' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const genOrderNum = orderNumber || `2026/غ.إ/${Math.floor(100 + Math.random() * 900)}`;

    const encEstablishment = establishmentName ? encryptText(establishmentName.trim()) : '';
    const encReg = commercialRegister ? encryptText(commercialRegister.trim()) : '';
    const encOwner = ownerName ? encryptText(ownerName.trim()) : '';
    const encAddr = address ? encryptText(address.trim()) : '';
    const encInf = infractionType ? encryptText(infractionType.trim()) : '';
    const encNotes = notes ? encryptText(notes.trim()) : '';

    const sql = pg_q(pg,
      `INSERT INTO "TrackerClosureOrders" ("OrderNumber", "EstablishmentName", "CommercialRegister", "OwnerName", "Address", "Municipality", "InfractionType", "LegalBasis", "DurationDays", "Status", "RelatedVisitId", "DraftedBy", "Notes")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted_to_director', $10, $11, $12)
       RETURNING *`,
      `INSERT INTO TrackerClosureOrders (OrderNumber, EstablishmentName, CommercialRegister, OwnerName, Address, Municipality, InfractionType, LegalBasis, DurationDays, Status, RelatedVisitId, DraftedBy, Notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted_to_director', ?, ?, ?);
       SELECT TOP 1 * FROM TrackerClosureOrders ORDER BY Id DESC;`
    );

    const params = [
      genOrderNum,
      encEstablishment,
      encReg,
      encOwner,
      encAddr,
      municipality || 'سطيف',
      encInf,
      legalBasis || 'القانون رقم 09-03 والقانون رقم 04-02',
      parseInt(durationDays) || 30,
      relatedVisitId ? parseInt(relatedVisitId) : null,
      draftedBy ? parseInt(draftedBy) : null,
      encNotes
    ];

    const result = await db.query(sql, params);
    res.json(decryptClosureRecord(result[0]) || { success: true });
  } catch (err) {
    console.error('Create closure order error:', err.message);
    res.status(500).json({ error: 'خطأ في إعداد قرار الغلق الإداري: ' + err.message });
  }
});

// POST /api/contentieux/closures/:id/sign (توقيع واعتماد قرار الغلق من المدير الولائي حصرياً)
router.post('/closures/:id/sign', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'صلاحية سيادية محظورة: توقيع واعتماد قرارات الغلق الإداري محصورة قانوناً بالسيد المدير الولائي للتجارة فقط (الآمر بالصرف)' });
    }

    const { id } = req.params;
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `UPDATE "TrackerClosureOrders"
       SET "Status" = 'approved_by_director',
           "DirectorSignatureDate" = NOW()
       WHERE "Id" = $1
       RETURNING *`,
      `UPDATE TrackerClosureOrders
       SET Status = 'approved_by_director',
           DirectorSignatureDate = GETDATE()
       WHERE Id = ?;
       SELECT * FROM TrackerClosureOrders WHERE Id = ?;`
    );

    const params = [id];
    if (!pg) params.push(id);

    const result = await db.query(sql, params);
    res.json(decryptClosureRecord(result[0]) || { success: true, message: 'تم توقيع واعتماد قرار الغلق الإداري بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في توقيع قرار الغلق: ' + err.message });
  }
});

// POST /api/contentieux/closures/:id/execute (تنفيذ وتشميع المحل مع الأمن/الدرك)
router.post('/closures/:id/execute', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: تسجيل تنفيذ الغلق محصور برؤساء المصالح والمدير الولائي' });
    }

    const { id } = req.params;
    const { executionNotes } = req.body;
    const db = await getConnection();
    const pg = isPostgres();

    const encNotes = executionNotes ? encryptText(executionNotes) : null;

    const sql = pg_q(pg,
      `UPDATE "TrackerClosureOrders"
       SET "Status" = 'executed',
           "ExecutionDate" = NOW(),
           "Notes" = COALESCE($1, "Notes")
       WHERE "Id" = $2
       RETURNING *`,
      `UPDATE TrackerClosureOrders
       SET Status = 'executed',
           ExecutionDate = GETDATE(),
           Notes = COALESCE(?, Notes)
       WHERE Id = ?;
       SELECT * FROM TrackerClosureOrders WHERE Id = ?;`
    );

    const params = [encNotes, id];
    if (!pg) params.push(id);

    const result = await db.query(sql, params);
    res.json(decryptClosureRecord(result[0]) || { success: true, message: 'تم تسجيل تنفيذ وتشميع المحل بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تسجيل تنفيذ الغلق: ' + err.message });
  }
});

// POST /api/contentieux/closures/:id/reopen (إعادة فتح المحل بعد انقضاء العقوبة وتسوية الوضعية)
router.post('/closures/:id/reopen', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'director' && callerRole !== 'admin' && callerRole !== 'head_of_department') {
      return res.status(403).json({ error: 'غير مصرح: رفع الغلق محصور بالمدير الولائي أو رئيس المصلحة المختصة' });
    }

    const { id } = req.params;
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `UPDATE "TrackerClosureOrders"
       SET "Status" = 'reopened',
           "ReopenDate" = NOW()
       WHERE "Id" = $1
       RETURNING *`,
      `UPDATE TrackerClosureOrders
       SET Status = 'reopened',
           ReopenDate = GETDATE()
       WHERE Id = ?;
       SELECT * FROM TrackerClosureOrders WHERE Id = ?;`
    );

    const params = [id];
    if (!pg) params.push(id);

    const result = await db.query(sql, params);
    res.json(decryptClosureRecord(result[0]) || { success: true, message: 'تم رفع الغلق وإعادة فتح المحل رسمياً' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إعادة فتح المحل: ' + err.message });
  }
});

// ==========================================
// 3. COURT CASES & SETTLEMENTS (المتابعة القضائية والمصالحة)
// ==========================================

// GET /api/contentieux/courts
router.get('/courts', authMiddleware, async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();

    const sql = pg_q(pg,
      `SELECT * FROM "TrackerCourtCases" ORDER BY "SubmissionDate" DESC, "Id" DESC`,
      `SELECT * FROM TrackerCourtCases ORDER BY SubmissionDate DESC, Id DESC`
    );

    let rows = await db.query(sql);

    // Initial seed court cases if empty
    if (!rows || rows.length === 0) {
      const defaultCases = [
        {
          num: '2026/م.ق/0114',
          court: 'محكمة سطيف (قسم الجنح)',
          def: 'شركة الهضاب للتوزيع بالجملة',
          reg: '19/00-3344551A26',
          det: 'جنحة تحرير فواتير وهمية وعدم الفوترة لمبالغ تتجاوز 12,000,000 دج (خرق المادة 26 من القانون 04-02)',
          pvDate: '2026-09-10',
          subDate: '2026-09-15',
          verdict: 'جلسة محاكمة معينة بتاريخ 15 أكتوبر 2026',
          fine: 2400000.00,
          settled: false
        },
        {
          num: '2026/م.ق/0115',
          court: 'محكمة العلمة (قسم الجنح)',
          def: 'مستودع الفجر للتبريد والتخزين',
          reg: '19/00-9988772B26',
          det: 'حيازة سلع فاسدة موجهة للاستهلاك البشري (أجبان ومشتقات حليب) مع تزوير تواريخ نهاية الصلاحية (القانون 09-03)',
          pvDate: '2026-09-18',
          subDate: '2026-09-22',
          verdict: 'إحالة الملف إلى قاضي التحقيق المختص',
          fine: 500000.00,
          settled: false
        },
        {
          num: '2026/م.ق/0116',
          court: 'محكمة عين ولمان',
          def: 'مؤسسة الوفاء لتعبئة المواد الاستهلاكية',
          reg: '19/00-4455663A26',
          det: 'عدم احترام إلزامية وسم المنتجات باللغة العربية والبيانات الإلزامية (تمت المصالحة القانونية واستيفاء الغرامة)',
          pvDate: '2026-09-05',
          subDate: '2026-09-12',
          verdict: 'حفظ الملف بعد إجراء المصالحة القانونية',
          fine: 100000.00,
          settled: true,
          receipt: 'وصل قباضة الضرائب رقم 2026/9082'
        }
      ];

      for (const cs of defaultCases) {
        const insertSql = pg_q(pg,
          `INSERT INTO "TrackerCourtCases" ("CaseNumber", "CourtName", "DefendantName", "CommercialRegister", "InfractionDetails", "PvDate", "SubmissionDate", "Verdict", "FineAmount", "IsSettled", "SettlementReceipt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          `INSERT INTO TrackerCourtCases (CaseNumber, CourtName, DefendantName, CommercialRegister, InfractionDetails, PvDate, SubmissionDate, Verdict, FineAmount, IsSettled, SettlementReceipt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        await db.query(insertSql, [cs.num, cs.court, cs.def, cs.reg, cs.det, cs.pvDate, cs.subDate, cs.verdict, cs.fine, cs.settled, cs.receipt || null]);
      }
      rows = await db.query(sql);
    }

    res.json(decryptCourtsList(rows));
  } catch (err) {
    console.error('Get court cases error:', err.message);
    res.status(500).json({ error: 'خطأ أثناء جلب ملفات القضايا والمحاكم: ' + err.message });
  }
});

// POST /api/contentieux/courts (تسجيل إحالة قضائية جديدة)
router.post('/courts', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: تسجيل الإحالات القضائية محصور برؤساء المصالح والمدير الولائي' });
    }

    const {
      caseNumber,
      courtName,
      defendantName,
      commercialRegister,
      infractionDetails,
      pvDate,
      submissionDate,
      verdict,
      fineAmount,
      notes
    } = req.body;

    if (!defendantName || !infractionDetails) {
      return res.status(400).json({ error: 'اسم التاجر/المؤسسة وتفاصيل المخالفة المحالة مطلوبان' });
    }

    const db = await getConnection();
    const pg = isPostgres();

    const genCaseNum = caseNumber || `2026/م.ق/${Math.floor(100 + Math.random() * 900)}`;

    const encDef = defendantName ? encryptText(defendantName.trim()) : '';
    const encReg = commercialRegister ? encryptText(commercialRegister.trim()) : '';
    const encDet = infractionDetails ? encryptText(infractionDetails.trim()) : '';
    const encNotes = notes ? encryptText(notes.trim()) : '';

    const sql = pg_q(pg,
      `INSERT INTO "TrackerCourtCases" ("CaseNumber", "CourtName", "DefendantName", "CommercialRegister", "InfractionDetails", "PvDate", "SubmissionDate", "Verdict", "FineAmount", "Notes")
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), COALESCE($7, CURRENT_DATE), $8, $9, $10)
       RETURNING *`,
      `INSERT INTO TrackerCourtCases (CaseNumber, CourtName, DefendantName, CommercialRegister, InfractionDetails, PvDate, SubmissionDate, Verdict, FineAmount, Notes)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, GETDATE()), COALESCE(?, GETDATE()), ?, ?, ?);
       SELECT TOP 1 * FROM TrackerCourtCases ORDER BY Id DESC;`
    );

    const params = [
      genCaseNum,
      courtName || 'محكمة سطيف',
      encDef,
      encReg,
      encDet,
      pvDate || null,
      submissionDate || null,
      verdict || 'قيد الدراسة لدى النيابة العامة',
      fineAmount ? parseFloat(fineAmount) : 0,
      encNotes
    ];

    const result = await db.query(sql, params);
    res.json(decryptCourtRecord(result[0]) || { success: true });
  } catch (err) {
    console.error('Create court case error:', err.message);
    res.status(500).json({ error: 'خطأ في تسجيل الإحالة القضائية: ' + err.message });
  }
});

// PUT /api/contentieux/courts/:id (تحديث الحكم أو تسجيل المصالحة ودفع الغرامة)
router.put('/courts/:id', authMiddleware, async (req, res) => {
  try {
    const callerRole = req.user?.role;
    if (callerRole !== 'head_of_department' && callerRole !== 'director' && callerRole !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح: تحديث مآل القضايا والمصالحات محصور برؤساء المصالح والمدير الولائي' });
    }

    const { id } = req.params;
    const { verdict, fineAmount, isSettled, settlementReceipt, notes } = req.body;

    const db = await getConnection();
    const pg = isPostgres();

    const encReceipt = settlementReceipt !== undefined ? encryptText(settlementReceipt) : null;
    const encNotes = notes !== undefined ? encryptText(notes) : null;

    const sql = pg_q(pg,
      `UPDATE "TrackerCourtCases"
       SET "Verdict" = COALESCE($1, "Verdict"),
           "FineAmount" = COALESCE($2, "FineAmount"),
           "IsSettled" = COALESCE($3, "IsSettled"),
           "SettlementReceipt" = COALESCE($4, "SettlementReceipt"),
           "Notes" = COALESCE($5, "Notes")
       WHERE "Id" = $6
       RETURNING *`,
      `UPDATE TrackerCourtCases
       SET Verdict = COALESCE(?, Verdict),
           FineAmount = COALESCE(?, FineAmount),
           IsSettled = COALESCE(?, IsSettled),
           SettlementReceipt = COALESCE(?, SettlementReceipt),
           Notes = COALESCE(?, Notes)
       WHERE Id = ?;
       SELECT * FROM TrackerCourtCases WHERE Id = ?;`
    );

    const params = [
      verdict || null,
      fineAmount !== undefined ? parseFloat(fineAmount) : null,
      isSettled !== undefined ? isSettled : null,
      encReceipt,
      encNotes,
      id
    ];
    if (!pg) params.push(id);

    const result = await db.query(sql, params);
    res.json(decryptCourtRecord(result[0]) || { success: true });
  } catch (err) {
    console.error('Update court case error:', err.message);
    res.status(500).json({ error: 'خطأ في تحديث مآل القضية: ' + err.message });
  }
});

module.exports = router;
