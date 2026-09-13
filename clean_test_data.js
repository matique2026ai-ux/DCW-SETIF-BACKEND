const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://drh_setif_user:88NRO2LmicznfvZyha2WiwpcbnbiAicA@dpg-daiq3hh5efls73eh4820-a.frankfurt-postgres.render.com/drh_setif';

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL database.');

  // Check before counts
  const beforeVisits = await client.query('SELECT COUNT(*) FROM "TrackerVisits"');
  const beforeAttendance = await client.query('SELECT COUNT(*) FROM "TrackerAttendance"');
  const beforeDeductions = await client.query('SELECT COUNT(*) FROM "TrackerDeductions"');
  const beforeAbsences = await client.query('SELECT COUNT(*) FROM "TrackerAbsences"');

  console.log('Before clean:', {
    visits: beforeVisits.rows[0].count,
    attendance: beforeAttendance.rows[0].count,
    deductions: beforeDeductions.rows[0].count,
    absences: beforeAbsences.rows[0].count,
  });

  // Truncate test tracker tables
  await client.query('TRUNCATE TABLE "TrackerVisits" RESTART IDENTITY CASCADE');
  await client.query('TRUNCATE TABLE "TrackerAttendance" RESTART IDENTITY CASCADE');
  await client.query('TRUNCATE TABLE "TrackerDeductions" RESTART IDENTITY CASCADE');
  await client.query('TRUNCATE TABLE "TrackerAbsences" RESTART IDENTITY CASCADE');

  console.log('✅ Successfully cleared TrackerVisits, TrackerAttendance, TrackerDeductions, and TrackerAbsences.');

  // Check after counts
  const afterVisits = await client.query('SELECT COUNT(*) FROM "TrackerVisits"');
  const afterAttendance = await client.query('SELECT COUNT(*) FROM "TrackerAttendance"');

  console.log('After clean:', {
    visits: afterVisits.rows[0].count,
    attendance: afterAttendance.rows[0].count,
  });

  await client.end();
}

main().catch(err => {
  console.error('Clean error:', err);
  process.exit(1);
});
