const { Pool } = require('pg');
require('dotenv').config();

let pgPool = null;
let odbcConn = null;

function isPostgres() {
  return !!process.env.DATABASE_URL;
}

async function getConnection() {
  if (isPostgres()) {
    if (!pgPool) {
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      console.log('✅ Connected to PostgreSQL');
    }
    return {
      query: async (sql, params = []) => {
        let idx = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
        const result = await pgPool.query(pgSql, params);
        return result.rows;
      },
    };
  }

  if (!odbcConn) {
    const odbc = require('odbc');
    const CONN_STR = 'Driver={SQL Server Native Client 11.0};Server=(localdb)\\MSSQLLocalDB;Database=DRH_Setif_DB;Trusted_Connection=Yes;';
    odbcConn = await odbc.connect(CONN_STR);
    console.log('✅ Connected to SQL Server via ODBC');
  }
  return odbcConn;
}

module.exports = { getConnection, isPostgres };
