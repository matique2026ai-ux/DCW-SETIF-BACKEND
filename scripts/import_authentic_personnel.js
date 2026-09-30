const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const gradeCodeToName = {
  100: 'مفتش قسم لقمع الغش',
  101: 'رئيس مفتشين لقمع الغش',
  102: 'مفتش رئيسي لقمع الغش',
  103: 'مفتش قمع الغش',
  104: 'رئيس محققين لقمع الغش',
  105: 'محقق رئيسي لقمع الغش',
  106: 'محقق قمع الغش',
  107: 'مراقب رئيسي لقمع الغش',
  108: 'مراقب قمع الغش',
  110: 'مفتش قسم للمنافسة والتحقيقات',
  111: 'رئيس مفتشين للمنافسة والتحقيقات',
  112: 'مفتش رئيسي للمنافسة والتحقيقات',
  113: 'مفتش للمنافسة والتحقيقات',
  114: 'رئيس محققين للمنافسة والتحقيقات',
  115: 'محقق رئيسي للمنافسة والتحقيقات',
  116: 'محقق للمنافسة والتحقيقات',
  121: 'رئيس مفتشين للتجارة',
  122: 'مفتش رئيسي للتجارة',
  123: 'مفتش للتجارة',
  124: 'رئيس محققين للتجارة',
  125: 'محقق رئيسي للتجارة',
  126: 'محقق للتجارة',
  201: 'متصرف مستشار',
  202: 'متصرف رئيسي',
  203: 'متصرف',
  204: 'ملحق رئيسي للإدارة',
  205: 'ملحق الإدارة',
  206: 'عون إداري رئيسي',
  207: 'عون إداري',
  208: 'عون مكتب',
  209: 'متصرف محلل',
  210: 'مساعد متصرف',
  211: 'مهندس دولة في الإعلام الآلي',
  212: 'مهندس رئيسي في الإعلام الآلي',
  213: 'تقني سامي في الإعلام الآلي',
  214: 'تقني في الإعلام الآلي',
  215: 'مساعد مهندس من المستوى الأول في الإعلام الآلي',
  221: 'محاسب إداري رئيسي',
  222: 'محاسب إداري',
  223: 'كاتب مديرية رئيسي',
  224: 'كاتب مديرية',
  225: 'كاتب',
  301: 'عامل مهني من المستوى الأول',
  302: 'عامل مهني من المستوى الثاني',
  303: 'عامل مهني من المستوى الثالث',
  304: 'سائق سيارة من المستوى الأول',
  305: 'سائق سيارة من المستوى الثاني',
  306: 'عون وقاية وأمن من المستوى الأول',
  307: 'عون وقاية وأمن من المستوى الثاني',
  308: 'حاجب رئيسي',
  309: 'عامل مهني خارج الصنف',
};

function parseSqlValues(valStr) {
  const tokens = [];
  let buffer = '';
  let inString = false;
  let i = 0;

  valStr = valStr.trim();
  if (valStr.startsWith('(')) valStr = valStr.substring(1);
  if (valStr.endsWith(');')) valStr = valStr.substring(0, valStr.length - 2);
  else if (valStr.endsWith(')')) valStr = valStr.substring(0, valStr.length - 1);

  while (i < valStr.length) {
    const char = valStr[i];
    if (!inString) {
      if (char === "'" || ((char === 'N' || char === 'n') && i + 1 < valStr.length && valStr[i + 1] === "'")) {
        inString = true;
        if (char === 'N' || char === 'n') i++;
        i++;
        continue;
      }
      if (char === ',') {
        tokens.push(buffer.trim());
        buffer = '';
        i++;
        continue;
      }
      buffer += char;
      i++;
    } else {
      if (char === "'") {
        if (i + 1 < valStr.length && valStr[i + 1] === "'") {
          buffer += "'";
          i += 2;
          continue;
        } else {
          inString = false;
          i++;
          continue;
        }
      }
      buffer += char;
      i++;
    }
  }
  if (buffer.length > 0 || valStr.endsWith(',')) {
    tokens.push(buffer.trim());
  }
  return tokens;
}

function cleanUsername(prenom, nom, existingSet) {
  function clean(s) {
    return s.toLowerCase()
      .replace(/[éèêë]/g, 'e')
      .replace(/[àâä]/g, 'a')
      .replace(/[ïî]/g, 'i')
      .replace(/[ôö]/g, 'o')
      .replace(/[ûüù]/g, 'u')
      .replace(/[^a-z0-9]/g, '');
  }

  const p = clean(prenom);
  const n = clean(nom);
  let base = `${p}.${n}`;
  if (base === '.') base = 'user';
  if (base.startsWith('.')) base = base.substring(1);
  if (base.endsWith('.')) base = base.substring(0, base.length - 1);

  let candidate = base;
  let counter = 2;
  while (existingSet.has(candidate)) {
    candidate = `${base}${counter}`;
    counter++;
  }
  existingSet.add(candidate);
  return candidate;
}

async function run() {
  console.log('🏛️ Connecting to PostgreSQL live database...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();
  console.log('✅ Connected successfully!');

  try {
    const sqlPath = 'C:\\Users\\ASUS 2\\Desktop\\DRH DCWS\\database\\SeedRealData2025.sql';
    console.log(`📖 Reading authentic dataset from: ${sqlPath}`);
    const content = fs.readFileSync(sqlPath, 'utf8');
    const blocks = content.split('INSERT INTO [Employes]');
    console.log(`Found ${blocks.length - 1} blocks in SQL file.`);

    // Fetch existing users and existing employees
    const existingUsersRes = await client.query('SELECT "Id", "NomUtilisateur", "EmployeeId" FROM "UtilisateursSysteme"');
    const existingUsernames = new Set(existingUsersRes.rows.map(r => (r.NomUtilisateur || '').toLowerCase()));
    const linkedEmployeeIds = new Set(existingUsersRes.rows.map(r => r.EmployeeId).filter(id => id != null));

    console.log(`Currently existing users in DB: ${existingUsernames.size}`);
    console.log(`Currently linked employee IDs: ${linkedEmployeeIds.size}`);

    // Pre-hash password and PIN
    const passwordHash = await bcrypt.hash('setif2026', 10);
    const pinHash = await bcrypt.hash('202600', 10);

    let insertedEmployees = 0;
    let updatedEmployees = 0;
    let provisionedInspectors = 0;
    let skippedAccounts = 0;
    let totalAdminStaff = 0;
    let totalInactive = 0;

    await client.query('BEGIN');

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const valuesIdx = block.indexOf('VALUES');
      if (valuesIdx === -1) continue;

      const tokens = parseSqlValues(block.substring(valuesIdx + 6).trim());
      if (tokens.length < 30) continue;

      const matricule = tokens[0];
      const nom = tokens[1];
      const prenom = tokens[2];
      const nomAr = tokens[3];
      const prenomAr = tokens[4];
      const gradeCode = parseInt(tokens[13], 10) || 0;
      const gradeName = gradeCodeToName[gradeCode] || 'رتبة معتمدة';
      const poste = tokens[16];
      const fonction = tokens[17];
      const service = tokens[18];
      const isActive = tokens[29] === '1';

      // 1. Insert or update into "Employes"
      let empId = null;
      const existingEmp = await client.query(
        'SELECT "Id" FROM "Employes" WHERE "NumeroMatricule" = $1',
        [matricule]
      );

      if (existingEmp.rows.length > 0) {
        empId = existingEmp.rows[0].Id;
        await client.query(
          `UPDATE "Employes"
           SET "Nom" = $1, "Prenom" = $2, "NomAr" = $3, "PrenomAr" = $4,
               "Grade" = $5, "PosteFinancier" = $6, "FonctionExercee" = $7,
               "Service" = $8, "EstActif" = $9
           WHERE "Id" = $10`,
          [nom, prenom, nomAr, prenomAr, gradeName, poste, fonction, service, isActive, empId]
        );
        updatedEmployees++;
      } else {
        const insertRes = await client.query(
          `INSERT INTO "Employes"
           ("NumeroMatricule", "Nom", "Prenom", "NomAr", "PrenomAr", "Grade", "PosteFinancier", "FonctionExercee", "Service", "EstActif")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING "Id"`,
          [matricule, nom, prenom, nomAr, prenomAr, gradeName, poste, fonction, service, isActive]
        );
        empId = insertRes.rows[0].Id;
        insertedEmployees++;
      }

      // 2. Upsert into "TrackerEmployeeAdmin"
      let adminStatus = 'active';
      if (!isActive) {
        totalInactive++;
        if (matricule.includes('MUT')) adminStatus = 'transferred';
        else if (matricule.includes('DEC')) adminStatus = 'retired';
        else adminStatus = 'retired';
      }

      const fLower = fonction.toLowerCase();
      const pLower = poste.toLowerCase();
      const gLower = gradeName.toLowerCase();

      // STRICT ROLE SEPARATION:
      // Bureau chiefs and department heads are NEVER field inspectors or brigade leaders!
      const isHead = fLower.includes('رئيس مصلحة') || pLower.includes('رئيس مصلحة');
      const isBureauChief = fLower.includes('رئيس مكتب') || pLower.includes('رئيس مكتب') || fLower.includes('مكتب إداري');
      const isPureAdminStaff = gradeCode >= 200 ||
        fLower.includes('سائق') || fLower.includes('حاجب') || fLower.includes('عامل مهني') ||
        fLower.includes('تسيير إداري') || fLower.includes('محاسب') || fLower.includes('أمين') ||
        fLower.includes('كاتب') || fLower.includes('عون إداري') || fLower.includes('عون مكتب');

      const isBrigadeLeader = !isHead && !isBureauChief && !isPureAdminStaff && (
        fLower.includes('رئيس فرقة') || fLower.includes('رئيس مهمة')
      );

      let brigadeName = null;
      if (!isHead && !isBureauChief && !isPureAdminStaff && isActive) {
        if (service.includes('المفتشية الإقليمية للتجارة بالعلمة')) brigadeName = 'فرقة الرقابة والتفتيش بالعلمة';
        else if (service.includes('المفتشية الإقليمية للتجارة بعين ولمان')) brigadeName = 'فرقة الرقابة بعين ولمان';
        else if (service.includes('المفتشية الإقليمية للتجارة ببوقاعة')) brigadeName = 'فرقة الرقابة ببوقاعة';
        else if (service.includes('المفتشية الحدودية لمراقبة الجودة')) brigadeName = 'فرقة المراقبة الحدودية بالمطار';
        else if (service.includes('ملحقة التجارة بعين الكبيرة')) brigadeName = 'فرقة ملحقة عين الكبيرة';
        else if (service.includes('ملحقة التجارة بعين أزال')) brigadeName = 'فرقة ملحقة عين آزال';
        else if (service.includes('ملحقة التجارة بعين أرنات')) brigadeName = 'فرقة ملحقة عين أرنات';
        else if (service.includes('مصلحة حماية المستهلك وقمع الغش')) brigadeName = 'فرقة حماية المستهلك وقمع الغش';
        else if (service.includes('مصلحة الممارسات التجارية والمضادة للمنافسة') || service.includes('مصلحة المنافسة')) brigadeName = 'فرقة التحقيقات الاقتصادية والمنافسة';
        else brigadeName = 'فرقة الرقابة الميدانية';
      }

      await client.query(
        `INSERT INTO "TrackerEmployeeAdmin"
         ("EmployeeId", "AdministrativeStatus", "IsBrigadeLeader", "BrigadeName", "AssignedDepartment", "AssignedPosition", "UpdatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT ("EmployeeId") DO UPDATE
         SET "AdministrativeStatus" = $2, "IsBrigadeLeader" = $3, "BrigadeName" = $4,
             "AssignedDepartment" = $5, "AssignedPosition" = $6, "UpdatedAt" = NOW()`,
        [empId, adminStatus, isBrigadeLeader, brigadeName, service, fonction]
      );

      // 3. User Account Provisioning in "UtilisateursSysteme":
      // ONLY active field inspection personnel (Role 4) get inspector mobile accounts!
      // Department heads, bureau chiefs, and administrative clerks do NOT get field inspector accounts.
      const isFieldInspector = !isHead && !isBureauChief && !isPureAdminStaff && isActive && (
        gradeCode < 200 && (
          fLower.includes('مفتش') || fLower.includes('محقق') || fLower.includes('مراقب') ||
          fLower.includes('رقابة') || fLower.includes('تفتيش') || fLower.includes('فرقة') ||
          gLower.includes('مفتش') || gLower.includes('محقق') || gLower.includes('مراقب')
        )
      );

      if (isFieldInspector) {
        if (!linkedEmployeeIds.has(empId)) {
          const uname = cleanUsername(prenom, nom, existingUsernames);
          const fullName = `${nomAr} ${prenomAr}`.trim();

          await client.query(
            `INSERT INTO "UtilisateursSysteme"
             ("NomUtilisateur", "MotDePasseHash", "NomComplet", "Role", "EstActif",
              "DateCreation", "EmployeeId", "Service", "MasterPin", "MustChangeCredentials")
             VALUES ($1, $2, $3, 4, true, NOW(), $4, $5, '202600', true)`,
            [uname, passwordHash, fullName, empId, service]
          );
          linkedEmployeeIds.add(empId);
          provisionedInspectors++;
        } else {
          skippedAccounts++;
        }
      } else {
        totalAdminStaff++;
      }
    }

    await client.query('COMMIT');

    console.log('\n======================================================');
    console.log('🏛️ AUTHENTIC CIVIL SERVICE IMPORT COMPLETED SUCCESSFULLY');
    console.log('======================================================');
    console.log(`Newly inserted employees in Employes: ${insertedEmployees}`);
    console.log(`Updated employees in Employes: ${updatedEmployees}`);
    console.log(`Total employees in registry: ${insertedEmployees + updatedEmployees}`);
    console.log(`Authentic Field Inspectors provisioned (Role 4): ${provisionedInspectors}`);
    console.log(`Admin/Office staff kept strictly non-inspection: ${totalAdminStaff}`);
    console.log(`Inactive/former records kept in civil registry: ${totalInactive}`);
    console.log(`Accounts skipped (already linked): ${skippedAccounts}`);

    // Verify DB totals
    const empTotal = await client.query('SELECT COUNT(*) FROM "Employes"');
    const userTotal = await client.query('SELECT COUNT(*) FROM "UtilisateursSysteme"');
    const roleStats = await client.query('SELECT "Role", COUNT(*) FROM "UtilisateursSysteme" GROUP BY "Role" ORDER BY "Role"');

    console.log('\n--- LIVE DATABASE VERIFICATION ---');
    console.log(`Total Employes in DB: ${empTotal.rows[0].count}`);
    console.log(`Total UtilisateursSysteme in DB: ${userTotal.rows[0].count}`);
    console.log('User counts by role:');
    for (const r of roleStats.rows) {
      const roleName = r.Role === 1 ? 'Director (1)' :
                       r.Role === 2 ? 'Head of Dept (2)' :
                       r.Role === 3 ? 'Bureau Chief (3)' :
                       r.Role === 4 ? 'Inspector (4)' :
                       r.Role === 5 ? 'Admin (5)' : `Unknown (${r.Role})`;
      console.log(`  Role ${r.Role} [${roleName}]: ${r.count}`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Import failed with error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
