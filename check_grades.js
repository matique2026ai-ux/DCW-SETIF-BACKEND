const odbc = require('odbc');
const connStr = 'Driver={SQL Server Native Client 11.0};Server=(localdb)\\MSSQLLocalDB;Database=DRH_Setif_DB;Trusted_Connection=Yes;';

async function main() {
  const conn = await odbc.connect(connStr);
  
  console.log('=== الرتب (Grade) في المصلحتين ===');
  const grades = await conn.query("SELECT Grade, COUNT(*) as cnt FROM Employes WHERE EstActif=1 AND (Service LIKE N'%منافسة%' OR Service LIKE N'%حماية المستهلك%') GROUP BY Grade ORDER BY cnt DESC");
  grades.forEach((g,i) => console.log(i + ': [' + g.cnt + '] Grade=' + g.Grade));
  
  console.log('');
  console.log('=== الوظيفة (FonctionExercee) ===');
  const fonctions = await conn.query("SELECT DISTINCT FonctionExercee, COUNT(*) as cnt FROM Employes WHERE EstActif=1 AND (Service LIKE N'%منافسة%' OR Service LIKE N'%حماية المستهلك%') GROUP BY FonctionExercee ORDER BY cnt DESC");
  fonctions.forEach((f,i) => console.log(i + ': [' + f.cnt + '] ' + f.FonctionExercee));
  
  console.log('');
  console.log('=== المنصب المالي (PosteFinancier) ===');
  const postes = await conn.query("SELECT DISTINCT PosteFinancier, COUNT(*) as cnt FROM Employes WHERE EstActif=1 AND (Service LIKE N'%منافسة%' OR Service LIKE N'%حماية المستهلك%') GROUP BY PosteFinancier ORDER BY cnt DESC");
  postes.forEach((p,i) => console.log(i + ': [' + p.cnt + '] ' + p.PosteFinancier));
  
  process.exit(0);
}

main().catch(e => { console.log('ERR:', e.message); process.exit(1); });
