async function pedir(metodo, ruta, cuerpo) {
  const r = await fetch('/api' + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  // HU14: si la sesión venció, la aplicación vuelve a la pantalla de ingreso
  if (r.status === 401 && ruta !== '/auth/ingresar') window.dispatchEvent(new Event('cpad:sin-sesion'));
  if (!r.ok) { const e = new Error(datos.error || `Error ${r.status}`); e.datos = datos; throw e; }
  return datos;
}
export const api = {
  get: (ruta) => pedir('GET', ruta),
  put: (ruta, cuerpo) => pedir('PUT', ruta, cuerpo),
  post: (ruta, cuerpo) => pedir('POST', ruta, cuerpo),
  del: (ruta) => pedir('DELETE', ruta),
};
