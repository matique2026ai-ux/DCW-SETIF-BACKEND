const express = require('express');
const { getConnection } = require('../config/database');

const router = express.Router();

const TARGET_DEPARTMENTS = [
  'مصلحة المنافسة والتحقيقات الاقتصادية',
  'مصلحة حماية المستهلك وقمع الغش',
];

router.get('/', async (req, res) => {
  try {
    const db = await getConnection();
    const { department, active } = req.query;

    let query = 'SELECT Id, NumeroMatricule, Nom, Prenom, NomAr, PrenomAr, Grade, Service, FonctionExercee, PosteFinancier, EstActif FROM Employes';
    const params = [];
    const conditions = [];

    if (active === '1' || active === 'true') {
      conditions.push('EstActif = 1');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY Service, Nom, Prenom';

    const result = await db.query(query, params);

    let filtered = result;

    if (department) {
      const deptLower = department.toLowerCase();
      filtered = result.filter(r =>
        r.Service && r.Service.toLowerCase().includes(deptLower)
      );
    } else {
      filtered = result.filter(r =>
        r.Service && TARGET_DEPARTMENTS.some(d => r.Service.includes(d))
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
    const result = await db.query("SELECT DISTINCT Service FROM Employes WHERE Service IS NOT NULL AND EstActif = 1 ORDER BY Service");
    const allDepts = result.map(r => r.Service);
    const targetDepts = allDepts.filter(d =>
      TARGET_DEPARTMENTS.some(t => d.includes(t))
    );
    res.json(targetDepts);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/all-departments', async (req, res) => {
  try {
    const db = await getConnection();
    const result = await db.query("SELECT DISTINCT Service FROM Employes WHERE Service IS NOT NULL AND EstActif = 1 ORDER BY Service");
    res.json(result.map(r => r.Service));
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = await getConnection();
    const result = await db.query('SELECT * FROM Employes WHERE Id = ?', [req.params.id]);
    if (!result || result.length === 0) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
