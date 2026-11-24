'use strict';
const { Pool } = require('pg');
const { createApp } = require('./app');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
const { asegurarAdmin } = require('./auth');
const port = Number(process.env.PORT) || 3000;

(async () => {
  // Primer arranque: crea el usuario «admin». La clave se toma de CPAD_ADMIN_CLAVE o se genera y se muestra una sola vez.
  const generada = await asegurarAdmin(pool, process.env.CPAD_ADMIN_CLAVE);
  if (generada) console.log(`Usuario inicial creado → usuario: admin · clave: ${generada} (cámbiela al ingresar)`);
  createApp(pool).listen(port, () => console.log(`cpad-api escuchando en el puerto ${port}`));
})().catch((e) => { console.error(e.message); process.exit(1); });
