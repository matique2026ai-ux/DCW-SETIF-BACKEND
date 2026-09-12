const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { getConnection } = require('./src/config/database');

const authRoutes = require('./src/routes/auth');
const employeeRoutes = require('./src/routes/employees');
const programRoutes = require('./src/routes/programs');
const attendanceRoutes = require('./src/routes/attendance');
const dashboardRoutes = require('./src/routes/dashboard');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'DCW-SETIF-TRACKER API v1.0.0' });
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
        IsCheckedOut BIT DEFAULT 0,
        Photo NVARCHAR(500) NULL,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
      );
    END
  `);

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerPrograms')
    BEGIN
      CREATE TABLE TrackerPrograms (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Title NVARCHAR(200) NOT NULL,
        Type NVARCHAR(20) DEFAULT 'weekly',
        WeekDate NVARCHAR(50) NULL,
        MonthYear NVARCHAR(20) NULL,
        CreatedBy INT NULL,
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
        Location NVARCHAR(200) NULL,
        StartDate DATE NULL,
        EndDate DATE NULL,
        Status NVARCHAR(20) DEFAULT 'pending',
        FOREIGN KEY (ProgramId) REFERENCES TrackerPrograms(Id),
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
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

  await db.query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TrackerDeductions')
    BEGIN
      CREATE TABLE TrackerDeductions (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeId INT NOT NULL,
        Date DATE NULL,
        Amount DECIMAL(10,2) NULL,
        Reason NVARCHAR(500) NULL,
        ApprovedBy INT NULL,
        Status NVARCHAR(20) DEFAULT 'pending',
        ExecutedBy INT NULL,
        FOREIGN KEY (EmployeeId) REFERENCES Employes(Id)
      );
    END
  `);

  console.log('✅ Tracker tables ensured');
}

async function seedAdmin() {
  const db = await getConnection();
  const existing = await db.query("SELECT Id FROM UtilisateursSysteme WHERE NomUtilisateur = 'tracker_admin'");

  if (!existing || existing.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await db.query(
      "INSERT INTO UtilisateursSysteme (NomUtilisateur, MotDePasseHash, NomComplet, Role, EstActif, DateCreation) VALUES (?, ?, ?, 0, 1, GETDATE())",
      ['tracker_admin', hash, 'مدير النظام - تتبع المفتشين']
    );
    console.log('✅ Admin user created: tracker_admin / admin123');
  } else {
    console.log('ℹ️  Admin user already exists');
  }
}

async function start() {
  try {
    await ensureTables();
    await seedAdmin();
    app.listen(PORT, () => {
      console.log(`🚀 DRH-SETIF-TRACKER API running on http://localhost:${PORT}`);
      console.log(`📋 Health: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

start();
