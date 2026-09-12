const odbc = require('odbc');
const connStr = 'Driver={SQL Server Native Client 11.0};Server=(localdb)\\MSSQLLocalDB;Database=DRH_Setif_DB;Trusted_Connection=Yes;';

async function main() {
  const conn = await odbc.connect(connStr);
  
  const depts = await conn.query('SELECT DISTINCT Service, COUNT(*) as cnt FROM Employes WHERE EstActif=1 GROUP BY Service ORDER BY cnt DESC');
  console.log('=== ALL DEPARTMENTS ===');
  depts.forEach((d,i) => console.log(i + ': [' + d.cnt + '] ' + d.Service));
  
  console.log('');
  const filtered = await conn.query("SELECT Service, COUNT(*) as cnt FROM Employes WHERE EstActif=1 AND (Service LIKE '%Ghsh%' OR Service LIKE '%ghsh%' OR Service LIKE N'%غش%' OR Service LIKE N'%منافسة%' OR Service LIKE N'%الاسعار%' OR Service LIKE N'%الممارسات%') GROUP BY Service");
  console.log('=== FILTERED ===');
  filtered.forEach((d,i) => console.log(i + ': [' + d.cnt + '] ' + d.Service));
  
  const total = await conn.query("SELECT COUNT(*) as total FROM Employes WHERE EstActif=1 AND (Service LIKE N'%غش%' OR Service LIKE N'%منافسة%' OR Service LIKE N'%الاسعار%' OR Service LIKE N'%الممارسات%')");
  console.log('Total filtered: ' + total[0].total);
  
  process.exit(0);
}

main().catch(e => { console.log('ERR:', e.message); process.exit(1); });
