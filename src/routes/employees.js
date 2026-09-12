const express = require('express');
const { getConnection, isPostgres } = require('../config/database');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    const { department, active } = req.query;

    const result = await db.query(
      pg
        ? `SELECT "Id","NumeroMatricule","Nom","Prenom","NomAr","PrenomAr","Grade","Service","FonctionExercee","PosteFinancier","EstActif" FROM "Employes" ORDER BY "Service","Nom","Prenom"`
        : 'SELECT Id,NumeroMatricule,Nom,Prenom,NomAr,PrenomAr,Grade,Service,FonctionExercee,PosteFinancier,EstActif FROM Employes ORDER BY Service,Nom,Prenom',
      []
    );

    let filtered = result.filter(r =>
      r.Service && TARGET_DEPARTMENTS.some(d => r.Service.includes(d))
    );

    if (department) {
      filtered = result.filter(r =>
        r.Service && r.Service.toLowerCase().includes(department.toLowerCase())
      );
    }

    res.json(filtered);
  } catch (err) {
    console.error('Get employees error:', err.message);
    res.status(500).json({ error: 'خطأ في جلب البيانات' });
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
        ? 'SELECT * FROM "Employes" WHERE "Id" = $1'
        : 'SELECT * FROM Employes WHERE Id = ?',
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
