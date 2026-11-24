import { useState } from 'react';
import { api } from './api.js';
import { Aviso, Campo } from './ui.jsx';

/** HU14 · Pantalla de ingreso. */
export default function Ingreso({ alIngresar }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function ingresar(e) {
    e.preventDefault(); setError(''); setEnviando(true);
    try { alIngresar(await api.post('/auth/ingresar', { usuario, clave })); } catch (err) { setError(err.message); setClave(''); } finally { setEnviando(false); }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-tinta p-10 text-white md:flex md:flex-col">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-coez"><span className="marca text-[14px]">CP</span></div>
          <div className="leading-tight">
            <div className="marca text-[19px]">CPAD</div>
            <div className="text-[12px] text-white/55">Asistencia y planilla</div>
          </div>
        </div>
        <div className="mt-auto max-w-[34ch]">
          <p className="titulo text-[28px] leading-[1.15]">Del tareo en obra a la boleta, en un solo lugar.</p>
          <p className="mt-3 text-white/60">Cada usuario ingresa con su cuenta y ve lo que su rol le permite.</p>
        </div>
        {/* Retícula de plano como fondo */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full opacity-[0.07]">
          <defs><pattern id="ret" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="white" strokeWidth="1" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#ret)" />
        </svg>
        <div className="relative mt-8 border-t border-white/15 pt-4 text-[12px] text-white/50">COEZ PERÚ E.I.R.L.</div>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <form onSubmit={ingresar} className="w-full max-w-[360px]">
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <div className="grid size-9 place-items-center rounded-md bg-coez text-white"><span className="marca text-[13px]">CP</span></div>
            <div className="marca text-[17px]">CPAD</div>
          </div>
          <h1 className="titulo text-[26px]">Iniciar sesión</h1>
          <p className="mt-1 text-tinta-2">Ingresa con el usuario que te asignó el administrador.</p>
          <div className="mt-6 space-y-4">
            <Campo etiqueta="Usuario">
              <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoFocus required className="campo w-full" />
            </Campo>
            <Campo etiqueta="Clave">
              <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" required className="campo w-full" />
            </Campo>
          </div>
          {error && <Aviso tono="error" icono="alerta" className="mt-4">{error}</Aviso>}
          <button disabled={enviando} className="btn-primario mt-6 w-full justify-center">{enviando ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </main>
    </div>
  );
}
