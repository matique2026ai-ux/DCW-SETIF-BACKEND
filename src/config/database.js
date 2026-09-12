const odbc = require('odbc');
require('dotenv').config();

const CONN_STR = 'Driver={SQL Server Native Client 11.0};Server=(localdb)\\MSSQLLocalDB;Database=DRH_Setif_DB;Trusted_Connection=Yes;';

let connection = null;

async function getConnection() {
  if (!connection) {
    connection = await odbc.connect(CONN_STR);
    console.log('✅ Connected to SQL Server via ODBC');
  }
  return connection;
}

module.exports = { getConnection };
