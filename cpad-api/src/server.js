'use strict';
const { Pool } = require('pg');
const { createApp } = require('./app');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
const port = Number(process.env.PORT) || 3000;
createApp(pool).listen(port, () => console.log(`cpad-api escuchando en el puerto ${port}`));
