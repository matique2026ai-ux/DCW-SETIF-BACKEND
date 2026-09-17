process.env.TZ = 'Africa/Algiers';

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection, isPostgres } = require('./src/config/database');
const { getTodayAlgeria, getNowAlgeriaIso } = require('./src/utils/dateUtils');

const authRoutes = require('./src/routes/auth');
const employeeRoutes = require('./src/routes/employees');
const programRoutes = require('./src/routes/programs');
const attendanceRoutes = require('./src/routes/attendance');
const dashboardRoutes = require('./src/routes/dashboard');
const visitRoutes = require('./src/routes/visits');
const deductionRoutes = require('./src/routes/deductions');
const justificationRoutes = require('./src/routes/justifications');
const inquiryRoutes = require('./src/routes/inquiries');
const settingRoutes = require('./src/routes/settings');

const app = express();
const PORT = process.env.PORT || 8080;

const path = require('path');
const fs = require('fs');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files (Flutter Web + downloads) with zero-cache headers
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
}));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Direct change-password endpoint fallback
app.post(['/api/auth/change-password', '/api/change-password'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let decoded = {};
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET || 'drh-setif-secret-2024');
      } catch (_) {}
    }

    const currentPassword = (req.body.currentPassword || '').trim();
    const newPassword = (req.body.newPassword || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية والجديدة' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'يجب ألا تقل كلمة المرور الجديدة عن 4 أحرف أو أرقام' });
    }

    const db = await getConnection();
    const pg = isPostgres();
    const users = await db.query(
      pg
        ? 'SELECT * FROM "UtilisateursSysteme" WHERE ("Id" = $1 OR LOWER(TRIM("NomUtilisateur")) = LOWER(TRIM($2))) AND "EstActif" = true'
        : 'SELECT * FROM UtilisateursSysteme WHERE (Id = ? OR LOWER(LTRIM(RTRIM(NomUtilisateur))) = LOWER(LTRIM(RTRIM(?)))) AND EstActif = 1',
      [decoded.id || 0, decoded.username || '']
    );

    if (!users || users.length === 0) {
      const emps = await db.query(
        pg
          ? 'SELECT * FROM "Employes" WHERE "Id" = $1 OR LOWER("Nom") = LOWER($2)'
          : 'SELECT * FROM Employes WHERE Id = ? OR LOWER(Nom) = LOWER(?)',
        [decoded.employeeId || decoded.id || 0, decoded.username || '']
      );
      if (emps && emps.length > 0) {
        const emp = emps[0];
        const newHash = await bcrypt.hash(newPassword, 10);
        await db.query(
          pg
            ? 'INSERT INTO "UtilisateursSysteme" ("NomUtilisateur", "MotDePasseHash", "NomComplet", "Role", "EstActif", "EmployeeId") VALUES ($1, $2, $3, 4, true, $4)'
            : 'INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, EmployeeId) VALUES (?, ?, ?, 4, 1, ?)',
          [decoded.username || `emp.${emp.Id || emp.id}`, newHash, `${emp.NomAr || emp.Nom} ${emp.PrenomAr || emp.Prenom}`.trim(), emp.Id || emp.id]
        );
        return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح ✅' });
      }
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = users[0];
    const existingHash = user.MotDePasseHash || user.motdepassehash || user.MotDePasse || user.motdepasse || '';
    const userId = user.Id !== undefined ? user.Id : (user.id !== undefined ? user.id : decoded.id);

    let valid = false;
    try {
      valid = await bcrypt.compare(currentPassword, existingHash);
    } catch {
      valid = false;
    }

    if (!valid && (existingHash === currentPassword || existingHash === '' || existingHash === 'chef123' || existingHash === 'admin123' || existingHash === 'directeur123' || existingHash === 'bureau123')) {
      valid = true;
    }

    if (!valid) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون مختلفة عن كلمة المرور الحالية' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      pg
        ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash" = $1 WHERE "Id" = $2'
        : 'UPDATE UtilisateursSysteme SET MotDePasseHash = ? WHERE Id = ?',
      [newHash, userId]
    );

    res.json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح ✅',
    });
  } catch (err) {
    console.error('Change password direct error:', err.message);
    res.status(500).json({ error: 'خطأ في الخادم أثناء تغيير كلمة المرور' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/attendance', attendanceRoutes);

// Direct endpoint fallback for cancel-checkout
app.post('/api/attendance/cancel-checkout', async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'رقم الموظف مطلوب' });
    const db = await getConnection();
    const pg = isPostgres();
    const today = getTodayAlgeria();
    await db.query(
      pg
        ? `UPDATE "TrackerAttendance" SET "IsCheckedOut"=false, "CheckOutTime"=NULL WHERE "EmployeeId"=$1 AND "Date"=$2`
        : `UPDATE TrackerAttendance SET IsCheckedOut=0, CheckOutTime=NULL WHERE EmployeeId=? AND Date=?`,
      [employeeId, today]
    );
    const result = await db.query(
      pg
        ? `SELECT * FROM "TrackerAttendance" WHERE "EmployeeId" = $1 AND "Date" = $2 ORDER BY "Id" DESC LIMIT 1`
        : 'SELECT TOP 1 * FROM TrackerAttendance WHERE EmployeeId = ? AND Date = ? ORDER BY Id DESC',
      [employeeId, today]
    );
    res.json(result[0] || { success: true });
  } catch (err) {
    console.error('Direct cancel checkout error:', err.message);
    res.status(500).json({ error: 'خطأ في استئناف الدوام' });
  }
});
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/deductions', deductionRoutes);
app.use('/api/justifications', justificationRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/settings', settingRoutes);

// Reset / Clean test attendance for fresh live demonstration
app.all('/api/clean-test-data', async (req, res) => {
  try {
    const db = await getConnection();
    const pg = isPostgres();
    if (pg) {
      await db.query('TRUNCATE TABLE "TrackerVisits" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerAttendance" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerDeductions" RESTART IDENTITY CASCADE');
      await db.query('TRUNCATE TABLE "TrackerAbsences" RESTART IDENTITY CASCADE');
    } else {
      await db.query('DELETE FROM TrackerVisits');
      await db.query('DELETE FROM TrackerAttendance');
      await db.query('DELETE FROM TrackerDeductions');
      await db.query('DELETE FROM TrackerAbsences');
    }
    res.json({
      success: true,
      message: '✅ تم تصفير جميع سجلات الحضور والمعاينات الوهمية السابقة بنجاح. يمكنك الآن بدء البث الحي الحقيقي بهاتفك!',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DCW-SETIF-TRACKER API v3.1.0-cancel-checkout',
    timezone: 'Africa/Algiers (UTC+1)',
    algeriaDate: getTodayAlgeria(),
    algeriaTime: getNowAlgeriaIso(),
    db: isPostgres() ? 'postgresql' : 'sqlserver'
  });
});

// Download endpoints for Android APK
const serveApk = (req, res) => {
  const fs = require('fs');
  const possiblePaths = [
    path.join(__dirname, 'public', 'app-release.apk'),
    path.join(__dirname, 'public', 'download', 'app-release.apk'),
    path.join(__dirname, 'public', 'DCW-SETIF-TRACKER.apk'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      return res.download(p, 'DCW-SETIF-TRACKER.apk');
    }
  }
  res.status(404).send('APK not found on server');
};

app.get('/app-release.apk', serveApk);
app.get('/DCW-SETIF-TRACKER.apk', serveApk);
app.get('/download/app-release.apk', serveApk);
app.get('/download/DCW-SETIF-TRACKER.apk', serveApk);
app.get('/download', serveApk);
app.get('/apk', serveApk);

// Fallback for Flutter Web SPA routes
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || req.path || '';
  if (url.startsWith('/api') || req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'مسار غير موجود في الواجهة البرمجية' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function ensureTables() {
  const db = await getConnection();
  const pg = isPostgres();

  const tables = [
    pg ? `CREATE TABLE IF NOT EXISTS "Employes" (
      "Id" SERIAL PRIMARY KEY, "NumeroMatricule" VARCHAR(50), "Nom" VARCHAR(100), "Prenom" VARCHAR(100),
      "NomAr" VARCHAR(200), "PrenomAr" VARCHAR(200), "Service" VARCHAR(300),
      "Grade" VARCHAR(100), "FonctionExercee" VARCHAR(200), "PosteFinancier" VARCHAR(100),
      "EstActif" BOOLEAN DEFAULT true
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "UtilisateursSysteme" (
      "Id" SERIAL PRIMARY KEY, "NomUtilisateur" VARCHAR(100) UNIQUE,
      "MotDePasseHash" TEXT, "NomComplet" VARCHAR(200), "Role" INT DEFAULT 4,
      "EstActif" BOOLEAN DEFAULT true, "DateCreation" TIMESTAMP DEFAULT NOW(),
      "DerniereConnexion" TIMESTAMP, "EmployeeId" INT, "Notes" TEXT
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerAttendance" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL, "Date" DATE NOT NULL,
      "CheckInTime" TIMESTAMP, "CheckOutTime" TIMESTAMP,
      "CheckInLocation" VARCHAR(200), "CheckOutLocation" VARCHAR(200),
      "CheckInLatitude" DOUBLE PRECISION, "CheckInLongitude" DOUBLE PRECISION,
      "CheckOutLatitude" DOUBLE PRECISION, "CheckOutLongitude" DOUBLE PRECISION,
      "CheckInPhoto" TEXT, "IsCheckedOut" BOOLEAN DEFAULT false,
      "Notes" TEXT, "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerPrograms" (
      "Id" SERIAL PRIMARY KEY, "Title" VARCHAR(200) NOT NULL,
      "Description" TEXT, "Type" VARCHAR(20) DEFAULT 'weekly',
      "WeekDate" VARCHAR(50), "MonthYear" VARCHAR(20),
      "TargetArea" VARCHAR(200), "TargetType" VARCHAR(100),
      "FocusPoints" TEXT, "CreatedBy" INT, "ServiceName" VARCHAR(200),
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerVisits" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "AssignmentId" INT, "Date" DATE NOT NULL,
      "CheckInTime" TIMESTAMP DEFAULT NOW(), "CheckOutTime" TIMESTAMP,
      "Latitude" DOUBLE PRECISION NOT NULL, "Longitude" DOUBLE PRECISION NOT NULL,
      "Accuracy" DOUBLE PRECISION, "LocationName" VARCHAR(300),
      "ShopName" VARCHAR(200), "ShopType" VARCHAR(100), "Photo" TEXT,
      "Status" VARCHAR(20) DEFAULT 'active', "Notes" TEXT,
      "ViolationFound" BOOLEAN DEFAULT false, "ViolationType" VARCHAR(200),
      "ViolationNotes" TEXT, "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerDeductions" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "RequestedBy" INT NOT NULL, "ApprovedBy" INT,
      "Date" DATE DEFAULT CURRENT_DATE, "Reason" TEXT NOT NULL,
      "Amount" DECIMAL(10,2), "DaysCount" INT,
      "Status" VARCHAR(20) DEFAULT 'pending', "Evidence" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerJustifications" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "Type" VARCHAR(50) DEFAULT 'general', "Title" VARCHAR(200),
      "StartDate" DATE NOT NULL, "EndDate" DATE NOT NULL,
      "DaysCount" INT DEFAULT 1, "DocumentPhoto" TEXT,
      "Notes" TEXT, "Status" VARCHAR(20) DEFAULT 'pending',
      "ReviewedBy" INT, "ReviewNotes" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerEmployeeAdmin" (
      "EmployeeId" INT PRIMARY KEY,
      "AdministrativeStatus" VARCHAR(50) DEFAULT 'active',
      "StatusStartDate" DATE,
      "StatusEndDate" DATE,
      "StatusNotes" TEXT,
      "IsBrigadeLeader" BOOLEAN DEFAULT false,
      "BrigadeName" VARCHAR(200),
      "AssignedDepartment" VARCHAR(300),
      "AssignedPosition" VARCHAR(200),
      "UpdatedBy" INT,
      "UpdatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerAbsences" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "Date" DATE NOT NULL, "Type" VARCHAR(20) DEFAULT 'absent',
      "Reason" TEXT, "VerifiedBy" INT
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerInquiries" (
      "Id" SERIAL PRIMARY KEY, "EmployeeId" INT NOT NULL,
      "Type" VARCHAR(50) DEFAULT 'unjustified_absence',
      "Subject" VARCHAR(300) NOT NULL,
      "IncidentDate" DATE NOT NULL,
      "LateMinutes" INT DEFAULT 0,
      "Details" TEXT,
      "Status" VARCHAR(30) DEFAULT 'sent',
      "SentBy" INT NOT NULL,
      "SentAt" TIMESTAMP DEFAULT NOW(),
      "EmployeeReply" TEXT,
      "ReplyDate" TIMESTAMP,
      "ReplyAttachment" TEXT,
      "DirectorDecision" VARCHAR(50),
      "DirectorNotes" TEXT,
      "DeductionDays" DECIMAL(4,1) DEFAULT 0.0,
      "DecisionDate" TIMESTAMP,
      "ExecutedBy" INT,
      "ExecutedAt" TIMESTAMP,
      "ExecutionNotes" TEXT,
      "CreatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,

    pg ? `CREATE TABLE IF NOT EXISTS "TrackerSettings" (
      "Key" VARCHAR(100) PRIMARY KEY,
      "Value" VARCHAR(500) NOT NULL,
      "Description" TEXT,
      "UpdatedAt" TIMESTAMP DEFAULT NOW()
    )` : null,
  ];

  for (const sql of tables) {
    if (sql) await db.query(sql);
  }

  // Ensure new columns on TrackerVisits
  if (pg) {
    try {
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "LegalAction" VARCHAR(200)`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "SeizureValue" DECIMAL(15,2) DEFAULT 0`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "IsApproved" BOOLEAN DEFAULT false`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "ApprovedBy" VARCHAR(200)`);
      await db.query(`ALTER TABLE "TrackerVisits" ADD COLUMN IF NOT EXISTS "ApprovedAt" TIMESTAMP`);
    } catch (e) {
      console.log('Postgres columns migration check:', e.message);
    }
  } else {
    try {
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'LegalAction') ALTER TABLE TrackerVisits ADD LegalAction NVARCHAR(200) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'SeizureValue') ALTER TABLE TrackerVisits ADD SeizureValue DECIMAL(15,2) DEFAULT 0`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'IsApproved') ALTER TABLE TrackerVisits ADD IsApproved BIT DEFAULT 0`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'ApprovedBy') ALTER TABLE TrackerVisits ADD ApprovedBy NVARCHAR(200) NULL`);
      await db.query(`IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('TrackerVisits') AND name = 'ApprovedAt') ALTER TABLE TrackerVisits ADD ApprovedAt DATETIME NULL`);
    } catch (e) {}
  }

  if (!pg) {
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerEmployeeAdmin')
    BEGIN CREATE TABLE TrackerEmployeeAdmin (
      EmployeeId INT PRIMARY KEY,
      AdministrativeStatus NVARCHAR(50) DEFAULT 'active',
      StatusStartDate DATE NULL,
      StatusEndDate DATE NULL,
      StatusNotes NVARCHAR(500) NULL,
      IsBrigadeLeader BIT DEFAULT 0,
      BrigadeName NVARCHAR(200) NULL,
      AssignedDepartment NVARCHAR(300) NULL,
      AssignedPosition NVARCHAR(200) NULL,
      UpdatedBy INT NULL,
      UpdatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerJustifications')
    BEGIN CREATE TABLE TrackerJustifications (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      Type NVARCHAR(50) DEFAULT 'general', Title NVARCHAR(200) NULL,
      StartDate DATE NOT NULL, EndDate DATE NOT NULL,
      DaysCount INT DEFAULT 1, DocumentPhoto NVARCHAR(MAX) NULL,
      Notes NVARCHAR(500) NULL, Status NVARCHAR(20) DEFAULT 'pending',
      ReviewedBy INT NULL, ReviewNotes NVARCHAR(500) NULL,
      CreatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerAttendance')
    BEGIN CREATE TABLE TrackerAttendance (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL, Date DATE NOT NULL,
      CheckInTime DATETIME NULL, CheckOutTime DATETIME NULL,
      CheckInLocation NVARCHAR(200) NULL, CheckOutLocation NVARCHAR(200) NULL,
      CheckInLatitude FLOAT NULL, CheckInLongitude FLOAT NULL,
      CheckOutLatitude FLOAT NULL, CheckOutLongitude FLOAT NULL,
      CheckInPhoto NVARCHAR(MAX) NULL, IsCheckedOut BIT DEFAULT 0,
      Notes NVARCHAR(500) NULL, CreatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerPrograms')
    BEGIN CREATE TABLE TrackerPrograms (
      Id INT IDENTITY(1,1) PRIMARY KEY, Title NVARCHAR(200) NOT NULL,
      Description NVARCHAR(500) NULL, Type NVARCHAR(20) DEFAULT 'weekly',
      WeekDate NVARCHAR(50) NULL, MonthYear NVARCHAR(20) NULL,
      TargetArea NVARCHAR(200) NULL, TargetType NVARCHAR(100) NULL,
      FocusPoints NVARCHAR(500) NULL, CreatedBy INT NULL,
      ServiceName NVARCHAR(200) NULL, CreatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerVisits')
    BEGIN CREATE TABLE TrackerVisits (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      AssignmentId INT NULL, Date DATE NOT NULL,
      CheckInTime DATETIME DEFAULT GETDATE(), CheckOutTime DATETIME NULL,
      Latitude FLOAT NOT NULL, Longitude FLOAT NOT NULL,
      Accuracy FLOAT NULL, LocationName NVARCHAR(300) NULL,
      ShopName NVARCHAR(200) NULL, ShopType NVARCHAR(100) NULL,
      Photo NVARCHAR(MAX) NULL, Status NVARCHAR(20) DEFAULT 'active',
      Notes NVARCHAR(500) NULL, ViolationFound BIT DEFAULT 0,
      ViolationType NVARCHAR(200) NULL, ViolationNotes NVARCHAR(500) NULL,
      CreatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerDeductions')
    BEGIN CREATE TABLE TrackerDeductions (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      RequestedBy INT NOT NULL, ApprovedBy INT NULL,
      Date DATE DEFAULT GETDATE(), Reason NVARCHAR(500) NOT NULL,
      Amount DECIMAL(10,2) NULL, DaysCount INT NULL,
      Status NVARCHAR(20) DEFAULT 'pending', Evidence NVARCHAR(MAX) NULL,
      CreatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerInquiries')
    BEGIN CREATE TABLE TrackerInquiries (
      Id INT IDENTITY(1,1) PRIMARY KEY, EmployeeId INT NOT NULL,
      Type NVARCHAR(50) DEFAULT 'unjustified_absence',
      Subject NVARCHAR(300) NOT NULL, IncidentDate DATE NOT NULL,
      LateMinutes INT DEFAULT 0, Details NVARCHAR(MAX) NULL,
      Status NVARCHAR(30) DEFAULT 'sent', SentBy INT NOT NULL,
      SentAt DATETIME DEFAULT GETDATE(), EmployeeReply NVARCHAR(MAX) NULL,
      ReplyDate DATETIME NULL, ReplyAttachment NVARCHAR(MAX) NULL,
      DirectorDecision NVARCHAR(50) NULL, DirectorNotes NVARCHAR(MAX) NULL,
      DeductionDays DECIMAL(4,1) DEFAULT 0.0, DecisionDate DATETIME NULL,
      ExecutedBy INT NULL, ExecutedAt DATETIME NULL, ExecutionNotes NVARCHAR(MAX) NULL,
      CreatedAt DATETIME DEFAULT GETDATE(),
      FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
    ) END`);
    await db.query(`IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerSettings')
    BEGIN CREATE TABLE TrackerSettings (
      [Key] NVARCHAR(100) PRIMARY KEY,
      [Value] NVARCHAR(500) NOT NULL,
      Description NVARCHAR(500) NULL,
      UpdatedAt DATETIME DEFAULT GETDATE()
    ) END`);
    console.log('✅ SQL Server tables ensured');
  } else {
    console.log('✅ PostgreSQL tables ensured');
  }
}

async function seedUsers() {
  const db = await getConnection();
  const pg = isPostgres();

  // Remove obsolete/dummy accounts
  try {
    await db.query(
      pg
        ? 'DELETE FROM "UtilisateursSysteme" WHERE "NomUtilisateur" IN (\'agent\', \'inspecteur\', \'kriba\')'
        : 'DELETE FROM UtilisateursSysteme WHERE NomUtilisateur IN (\'agent\', \'inspecteur\', \'kriba\')'
    );
  } catch (err) {
    console.log('Cleanup warning:', err.message);
  }

  const users = [
    { username: 'tracker_admin', password: 'admin123', name: 'مدير النظام', dbRole: 5 },
    { username: 'directeur', password: 'directeur123', name: 'المدير الولائي', dbRole: 1 },
    { username: 'chef_concurrence', password: 'chef123', name: 'رئيس مصلحة المنافسة والتحقيقات', dbRole: 2 },
    { username: 'chef_consommation', password: 'chef123', name: 'رئيس مصلحة حماية المستهلك وقمع الغش', dbRole: 2 },
    { username: 'chef_administration', password: 'chef123', name: 'رئيس مصلحة الإدارة والوسائل', dbRole: 2 },
    { username: 'bureau_user', password: 'bureau123', name: 'رئيس مكتب المستخدمين', dbRole: 3 },
    { username: 'chef_bureau', password: 'Bureau@2024', name: 'رئيس مكتب المستخدمين', dbRole: 3 },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 10);
    const existing = await db.query(
      pg
        ? 'SELECT "Id" FROM "UtilisateursSysteme" WHERE "NomUtilisateur" = $1'
        : 'SELECT Id FROM UtilisateursSysteme WHERE NomUtilisateur = ?',
      [u.username]
    );
    if (!existing || existing.length === 0) {
      await db.query(
        pg
          ? 'INSERT INTO "UtilisateursSysteme" ("NomUtilisateur","MotDePasseHash","NomComplet","Role","EstActif","DateCreation","EmployeeId") VALUES ($1,$2,$3,$4,true,NOW(),$5)'
          : 'INSERT INTO UtilisateursSysteme (NomUtilisateur,MotDePasseHash,NomComplet,Role,EstActif,DateCreation,EmployeeId) VALUES (?,?,?,?,1,GETDATE(),?)',
        [u.username, hash, u.name, u.dbRole, u.employeeId || null]
      );
      console.log(`✅ User: ${u.username} / ${u.password}`);
    } else {
      await db.query(
        pg
          ? 'UPDATE "UtilisateursSysteme" SET "MotDePasseHash"=$1, "NomComplet"=$2, "Role"=$3, "EmployeeId"=$4 WHERE "NomUtilisateur"=$5'
          : 'UPDATE UtilisateursSysteme SET MotDePasseHash=?, NomComplet=?, Role=?, EmployeeId=? WHERE NomUtilisateur=?',
        [hash, u.name, u.dbRole, u.employeeId || null, u.username]
      );
      console.log(`🔄 User: ${u.username} / ${u.password}`);
    }
  }
}

async function seedEmployees() {
  if (!isPostgres()) return;
  const db = await getConnection();
  const existing = await db.query('SELECT COUNT(*) as count FROM "Employes"');
  if (existing[0].count > 0) return;

  const employees = [
    { nom: 'كريبع', prenom: 'كمال', service: 'مصلحة حماية المستهلك وقمع الغش', grade: 'مفتش' },
    { nom: 'لونيس', prenom: 'جمال', service: 'مصلحة حماية المستهلك وقمع الغش', grade: 'مفتش' },
    { nom: 'غزالي', prenom: 'زينب', service: 'مصلحة المنافسة والتحقيقات الاقتصادية', grade: 'مفتش' },
    { nom: 'لدرع', prenom: 'نعيمة', service: 'مصلحة المنافسة والتحقيقات الاقتصادية', grade: 'مفتش' },
    { nom: 'دخيلي', prenom: 'خالد', service: 'مصلحة المنافسة والتحقيقات الاقتصادية', grade: 'مفتش' },
  ];

  for (const e of employees) {
    await db.query(
      'INSERT INTO "Employes" ("Nom","Prenom","NomAr","PrenomAr","Service","Grade","EstActif") VALUES ($1,$2,$1,$2,$3,$4,true)',
      [e.nom, e.prenom, e.service, e.grade]
    );
  }
  console.log('✅ 5 test employees seeded');
}

async function seedPrograms() {
  if (!isPostgres()) return;
  const db = await getConnection();
  
  // Update any existing programs with generic service to proper services so inspectors are linked
  try {
    await db.query(`
      UPDATE "TrackerPrograms" 
      SET "ServiceName" = 'مصلحة حماية المستهلك وقمع الغش' 
      WHERE "ServiceName" = 'مصلحة الرقابة' OR "ServiceName" IS NULL
    `);

    const existing = await db.query('SELECT COUNT(*) as count FROM "TrackerPrograms"');
    if (parseInt(existing[0]?.count || '0', 10) < 2) {
      const defaultPrograms = [
        {
          title: 'برنامج ولائي لقمع الغش ومراقبة الجودة والمواد الغذائية',
          description: 'التفتيش الميداني للمطاعم، المخابز، ملبنات الحليب، ومحلات القصابة',
          type: 'daily',
          targetArea: 'ولاية سطيف (المقرات والمفتشيات الإقليمية)',
          focusPoints: 'سلسلة التبريد، شروط النظافة، تواريخ الصلاحية',
          serviceName: 'مصلحة حماية المستهلك وقمع الغش'
        },
        {
          title: 'برنامج ولائي لمراقبة الممارسات التجارية والفوترة والأسعار المقننة',
          description: 'مراقبة أسواق الجملة والتجزئة وتطبيق هوامش الربح ومحاربة المضاربة',
          type: 'weekly',
          targetArea: 'ولاية سطيف (العلمة، عين ولمان، سطيف وسط)',
          focusPoints: 'الفواتير، هوامش الربح، التصريح بالمخازن',
          serviceName: 'مصلحة المنافسة والتحقيقات الاقتصادية'
        }
      ];

      for (const p of defaultPrograms) {
        await db.query(
          `INSERT INTO "TrackerPrograms" ("Title","Description","Type","WeekDate","TargetArea","FocusPoints","ServiceName","CreatedAt")
           VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,NOW())`,
          [p.title, p.description, p.type, p.targetArea, p.focusPoints, p.serviceName]
        );
      }
      console.log('✅ Default inspection programs seeded');
    }
  } catch (e) {
    console.log('seedPrograms notice:', e.message);
  }
}

async function start() {
  try {
    await ensureTables();
    await seedUsers();
    await seedEmployees();
    await seedPrograms();
    app.listen(PORT, () => {
      console.log(`🚀 DRH-SETIF-TRACKER API v3.0 running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
