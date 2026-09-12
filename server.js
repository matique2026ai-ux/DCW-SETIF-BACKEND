const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { getConnection } = require('./src/config/database');

const authRoutes = require('./src/routes/auth');
const employeeRoutes = require('./src/routes/employees');
const programRoutes = require('./src/routes/programs');
const attendanceRoutes = require('./src/routes/attendance');
const dashboardRoutes = require('./src/routes/dashboard');
const visitRoutes = require('./src/routes/visits');
const deductionRoutes = require('./src/routes/deductions');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/deductions', deductionRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'DCW-SETIF-TRACKER API v2.0.0' });
});

async function ensureTables() {
  const db = await getConnection();

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerAttendance')
    BEGIN
      CREATE TABLE TrackerAttendance (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeId INT NOT NULL,
        Date DATE NOT NULL,
        CheckInTime DATETIME NULL,
        CheckOutTime DATETIME NULL,
        CheckInLocation NVARCHAR(200) NULL,
        CheckOutLocation NVARCHAR(200) NULL,
        CheckInLatitude FLOAT NULL,
        CheckInLongitude FLOAT NULL,
        CheckOutLatitude FLOAT NULL,
        CheckOutLongitude FLOAT NULL,
        CheckInPhoto NVARCHAR(MAX) NULL,
        IsCheckedOut BIT DEFAULT 0,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
      );
    END
  `);

  try {
    await db.query("ALTER TABLE TrackerAttendance ADD CheckInLatitude FLOAT NULL");
    await db.query("ALTER TABLE TrackerAttendance ADD CheckInLongitude FLOAT NULL");
    await db.query("ALTER TABLE TrackerAttendance ADD CheckOutLatitude FLOAT NULL");
    await db.query("ALTER TABLE TrackerAttendance ADD CheckOutLongitude FLOAT NULL");
    await db.query("ALTER TABLE TrackerAttendance ADD CheckInPhoto NVARCHAR(MAX) NULL");
  } catch (e) {}

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerPrograms')
    BEGIN
      CREATE TABLE TrackerPrograms (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Title NVARCHAR(200) NOT NULL,
        Description NVARCHAR(500) NULL,
        Type NVARCHAR(20) DEFAULT 'weekly',
        WeekDate NVARCHAR(50) NULL,
        MonthYear NVARCHAR(20) NULL,
        TargetArea NVARCHAR(200) NULL,
        TargetType NVARCHAR(100) NULL,
        FocusPoints NVARCHAR(500) NULL,
        CreatedBy INT NULL,
        ServiceName NVARCHAR(200) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (CreatedBy) REFERENCES UtilisateursSysteme(Id)
      );
    END
  `);

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerAssignments')
    BEGIN
      CREATE TABLE TrackerAssignments (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ProgramId INT NOT NULL,
        EmployeeId INT NOT NULL,
        DayOfWeek NVARCHAR(20) NULL,
        TargetLocation NVARCHAR(200) NULL,
        TargetAddress NVARCHAR(500) NULL,
        Latitude FLOAT NULL,
        Longitude FLOAT NULL,
        Status NVARCHAR(20) DEFAULT 'pending',
        Notes NVARCHAR(500) NULL,
        FOREIGN KEY (ProgramId) REFERENCES TrackerPrograms(Id),
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
      );
    END
  `);

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerVisits')
    BEGIN
      CREATE TABLE TrackerVisits (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeId INT NOT NULL,
        AssignmentId INT NULL,
        Date DATE NOT NULL,
        CheckInTime DATETIME DEFAULT GETDATE(),
        CheckOutTime DATETIME NULL,
        Latitude FLOAT NOT NULL,
        Longitude FLOAT NOT NULL,
        Accuracy FLOAT NULL,
        LocationName NVARCHAR(300) NULL,
        ShopName NVARCHAR(200) NULL,
        ShopType NVARCHAR(100) NULL,
        Photo NVARCHAR(MAX) NULL,
        Status NVARCHAR(20) DEFAULT 'active',
        Notes NVARCHAR(500) NULL,
        ViolationFound BIT DEFAULT 0,
        ViolationType NVARCHAR(200) NULL,
        ViolationNotes NVARCHAR(500) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
      );
    END
  `);

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerDeductions')
    BEGIN
      CREATE TABLE TrackerDeductions (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeId INT NOT NULL,
        RequestedBy INT NOT NULL,
        ApprovedBy INT NULL,
        Date DATE DEFAULT GETDATE(),
        Reason NVARCHAR(500) NOT NULL,
        Amount DECIMAL(10,2) NULL,
        DaysCount INT NULL,
        Status NVARCHAR(20) DEFAULT 'pending',
        Evidence NVARCHAR(MAX) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id),
        FOREIGN KEY (RequestedBy) REFERENCES UtilisateursSysteme(Id)
      );
    END
  `);

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerAbsences')
    BEGIN
      CREATE TABLE TrackerAbsences (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeId INT NOT NULL,
        Date DATE NOT NULL,
        Type NVARCHAR(20) DEFAULT 'absent',
        Reason NVARCHAR(500) NULL,
        VerifiedBy INT NULL,
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
      );
    END
  `);

  console.log('✅ All tables ensured');
}

async function seedUsers() {
  const db = await getConnection();

  const users = [
    { username: 'tracker_admin', password: 'admin123', name: 'مدير النظام', role: 'admin', dbRole: 5 },
    { username: 'directeur', password: 'directeur123', name: 'المدير الولائي', role: 'director', dbRole: 1 },
    { username: 'chef_concurrence', password: 'chef123', name: 'رئيس مصلحة المنافسة', role: 'head_of_department', dbRole: 2, service: 'مصلحة المنافسة والتحقيقات الاقتصادية' },
    { username: 'chef_consommation', password: 'chef123', name: 'رئيس مصلحة حماية المستهلك', role: 'head_of_department', dbRole: 2, service: 'مصلحة حماية المستهلك وقمع الغش' },
    { username: 'bureau_user', password: 'bureau123', name: 'رئيس مكتب المستخدمين', role: 'bureau_chief', dbRole: 3 },
  ];

  for (const u of users) {
    const existing = await db.query("SELECT Id FROM UtilisateursSysteme WHERE NomUtilisateur = ?", [u.username]);
    if (!existing || existing.length === 0) {
      const hash = await bcrypt.hash(u.password, 10);
      await db.query(
        "INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, DateCreation) VALUES (?, ?, ?, ?, 1, GETDATE())",
        [u.username, hash, u.name, u.dbRole]
      );
      console.log(`✅ User created: ${u.username} / ${u.password} [${u.role}]`);
    } else {
      const hash = await bcrypt.hash(u.password, 10);
      await db.query(
        "UPDATE UtilisateursSysteme SET MotDePasseHash = ?, NomComplet = ?, Role = ? WHERE NomUtilisateur = ?",
        [hash, u.name, u.dbRole, u.username]
      );
      console.log(`🔄 User updated: ${u.username} / ${u.password} [${u.role}]`);
    }
  }
}

async function start() {
  try {
    await ensureTables();
    await seedUsers();
    app.listen(PORT, () => {
      console.log(`🚀 DRH-SETIF-TRACKER API v2.0 running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
