'use strict';
// Crea las tablas y carga los datos maestros iniciales. Uso: DATABASE_URL=... npm run db:setup
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

(async () => {
  if (!process.env.DATABASE_URL) { console.error('Falta la variable DATABASE_URL'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  try {
    for (const f of ['schema.sql', 'seed.sql']) {
      await pool.query(fs.readFileSync(path.join(__dirname, '../db', f), 'utf8'));
      console.log('Aplicado:', f);
    }
    const { rows } = await pool.query("SELECT (SELECT count(*) FROM categoria) AS categorias, (SELECT count(*) FROM especialidad) AS especialidades, (SELECT count(*) FROM obra) AS obras");
    console.log('Base lista:', rows[0]);
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
