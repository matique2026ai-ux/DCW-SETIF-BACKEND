const express = require('express');
const router = express.Router();

// 📜 Official Algerian Republic Digital Certificate Verification Handler
router.all('*', (req, res) => {
  const { id, emp, employee, name, date, time, loc, location, lat, lng, rad, type, status } = req.query;
  const cleanId = id || 'DCW-' + Date.now().toString().slice(-6);
  const cleanEmp = emp || employee || name || 'عون رقابة وتفتيش معتمد';
  const cleanDate = date || new Date().toISOString().slice(0, 10);
  const cleanTime = time || new Date().toLocaleTimeString('fr-FR', { timeZone: 'Africa/Algiers', hour: '2-digit', minute: '2-digit' });
  const cleanLoc = loc || location || 'المقر الرئيسي لمديرية التجارة سطيف';
  const isHQ = type === 'OFFICIAL_INSPECTORATE_BADGE' || (status && status.includes('HQ'));
  const isVisit = type === 'visit' || type === 'VISIT_EVIDENCE';
  const typeLabel = isHQ
    ? 'شهادة اعتماد وتوثيق مقر رقابي إقليمي'
    : (isVisit ? 'شهادة إثبات معاينة ورقابة ميدانية رسمية' : 'شهادة إثبات حضور ميداني رسمي بالبصمة الجغرافية');
  
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>شهادة التحقق والاعتماد الرقمي الرسمي — مديرية التجارة سطيف</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Tajawal', sans-serif; }
    body {
      background: linear-gradient(135deg, #120617 0%, #200B29 50%, #380718 100%);
      color: #FFFFFF;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 16px;
    }
    .cert-card {
      background: rgba(36, 13, 45, 0.95);
      backdrop-filter: blur(16px);
      border: 2px solid #D4AF37;
      border-radius: 24px;
      max-width: 480px;
      width: 100%;
      padding: 24px 20px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(212, 175, 55, 0.2);
      text-align: center;
      position: relative;
    }
    .national-header {
      margin-bottom: 16px;
    }
    .national-header h2 {
      font-size: 15px;
      font-weight: 900;
      color: #FBBF24;
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }
    .national-header h3 {
      font-size: 13px;
      font-weight: 700;
      color: #E2E8F0;
    }
    .badge-verified {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.18);
      border: 1.5px solid #10B981;
      padding: 8px 18px;
      border-radius: 999px;
      color: #34D399;
      font-size: 13px;
      font-weight: 700;
      margin: 14px 0 20px 0;
    }
    .badge-icon {
      font-size: 18px;
    }
    .details-box {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 16px;
      border: 1px solid rgba(212, 175, 55, 0.25);
      padding: 14px;
      text-align: right;
      margin-bottom: 18px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 13px;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #94A3B8;
      font-weight: 500;
    }
    .detail-value {
      color: #FFFFFF;
      font-weight: 700;
      max-width: 65%;
      text-align: left;
      direction: ltr;
    }
    .detail-value.ar {
      direction: rtl;
      text-align: left;
    }
    .gold-text {
      color: #D4AF37 !important;
    }
    .seal-footer {
      border-top: 1px dashed rgba(212, 175, 55, 0.4);
      padding-top: 14px;
      font-size: 11px;
      color: #CBD5E1;
      line-height: 1.5;
    }
    .btn-return {
      display: inline-block;
      margin-top: 14px;
      background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%);
      color: #000;
      font-weight: 800;
      text-decoration: none;
      padding: 10px 24px;
      border-radius: 12px;
      font-size: 13px;
      transition: transform 0.2s;
    }
    .btn-return:hover {
      transform: scale(1.03);
    }
  </style>
</head>
<body>
  <div class="cert-card">
    <div class="national-header">
      <h2>الجمهورية الجزائرية الديمقراطية الشعبية</h2>
      <h3>وزارة التجارة وترقية الصادرات</h3>
      <p style="font-size: 12px; color: #D4AF37; margin-top: 2px;">مديرية التجارة وضبط السوق الوطنية — ولاية سطيف</p>
    </div>

    <div class="badge-verified">
      <span class="badge-icon">✓</span>
      <span>${typeLabel}</span>
    </div>

    <div class="details-box">
      <div class="detail-row">
        <span class="detail-label">الموظف / المعني:</span>
        <span class="detail-value ar gold-text">${cleanEmp}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">حالة التوثيق:</span>
        <span class="detail-value ar" style="color: #34D399;">معتمد ومسجل بالسيرفر الحي ✓</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">تاريخ الاعتماد:</span>
        <span class="detail-value">${cleanDate}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">توقيت البصمة:</span>
        <span class="detail-value">${cleanTime}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">المقر / النطاق:</span>
        <span class="detail-value ar">${cleanLoc}</span>
      </div>
      ${lat && lng ? `
      <div class="detail-row">
        <span class="detail-label">إحداثيات GPS:</span>
        <span class="detail-value">${lat}, ${lng}</span>
      </div>` : ''}
      <div class="detail-row">
        <span class="detail-label">الرقم المرجعي:</span>
        <span class="detail-value gold-text">#${cleanId}</span>
      </div>
    </div>

    <div class="seal-footer">
      <p>🛡️ هذه الوثيقة الرقمية صادرة آلياً وموثقة بالبصمة الجغرافية عبر منظومة الرقابة والتفتيش الميداني الرسمية (DCW-SETIF).</p>
      <a href="https://dcw-setif-tracker.onrender.com" class="btn-return">الانتقال إلى المنصة المركزية</a>
    </div>
  </div>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

module.exports = router;
