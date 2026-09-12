const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../config/database');

const router = express.Router();

const ROLE_MAP = {
  0: 'director',
  1: 'director',
  2: 'head_of_department',
  3: 'bureau_chief',
  4: 'inspector',
  5: 'admin',
};

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
    }

    const db = await getConnection();
    const users = await db.query(
      'SELECT * FROM UtilisateursSysteme WHERE NomUtilisateur = ? AND EstActif = 1',
      [username]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'مستخدم غير موجود' });
    }

    const user = users[0];
    let valid = false;

    try {
      valid = await bcrypt.compare(password, user.MotDePasseHash);
    } catch {
      valid = false;
    }

    if (!valid && user.MotDePasseHash === password) {
      valid = true;
      try {
        const newHash = await bcrypt.hash(password, 10);
        await db.query('UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?', [newHash, user.Id]);
      } catch {}
    }

    if (!valid) {
      return res.status(401).json({ error: 'كلمة المرور خاطئة' });
    }

    const role = ROLE_MAP[user.Role] || 'inspector';

    await db.query('UPDATE UtilisateursSysteme SET DerniereConnexion = GETDATE() WHERE Id = ?', [user.Id]);

    const token = jwt.sign(
      { id: user.Id, username: user.NomUtilisateur, role, fullName: user.NomComplet },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.Id,
        username: user.NomUtilisateur,
        fullName: user.NomComplet,
        role,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'غير مصرح' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = await getConnection();
    const users = await db.query(
      'SELECT Id, NomUtilisateur, NomComplet, Role, EstActif, DateCreation, DerniereConnexion FROM UtilisateursSysteme WHERE Id = ?',
      [decoded.id]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const u = users[0];
    res.json({
      id: u.Id,
      username: u.NomUtilisateur,
      fullName: u.NomComplet,
      role: ROLE_MAP[u.Role] || 'inspector',
      isActive: u.EstActif,
      createdAt: u.DateCreation,
      lastLogin: u.DerniereConnexion,
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
