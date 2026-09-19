const jwt = require('jsonwebtoken');
require('dotenv').config();

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح — سجّل دخول أولاً' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'المرور منتهي الصلاحية' });
  }
}

function roleGuard(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    next();
  };
}

module.exports = { authMiddleware, verifyToken: authMiddleware, roleGuard };
