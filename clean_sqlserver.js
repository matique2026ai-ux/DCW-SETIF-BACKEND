const odbc = require('odbc');
const connStr = 'Driver={SQL Server Native Client 11.0};Server=(localdb)\\MSSQLLocalDB;Database=DRH_Setif_DB;Trusted_Connection=Yes;';

async function main() {
  try {
    const conn = await odbc.connect(connStr);
    console.log('Connected to Local SQL Server.');
    try {
      await conn.query('DELETE FROM TrackerVisits');
      await conn.query('DELETE FROM TrackerAttendance');
      await conn.query('DELETE FROM TrackerDeductions');
      await conn.query('DELETE FROM TrackerAbsences');
      console.log('✅ Local SQL Server tracker tables cleared.');
    } catch (e) {
      console.log('Table clear note:', e.message);
    }
    await conn.close();
  } catch (err) {
    console.log('Local SQL Server not running or not found, skipping:', err.message);
  }
}

main();
