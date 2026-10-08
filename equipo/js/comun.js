export const TZ = 'Europe/Madrid';

const URL_API = 'api/api.php';

// ---------------------------------------------------------------------
// API y sesion
// ---------------------------------------------------------------------

export async function api(accion, datos = {}) {
  let r;
  try {
    r = await fetch(`${URL_API}?accion=${encodeURIComponent(accion)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Equipo': '1' },
      body: JSON.stringify(datos),
    });
  } catch {
    throw new Error('Sin conexión. Comprueba tu conexión a internet.');
  }
  let cuerpo = null;
  try {
    cuerpo = await r.json();
  } catch {
    cuerpo = null;
  }
  if (r.status === 401 && accion !== 'login' && accion !== 'sesion') {
    location.replace('./');
  }
  if (!r.ok) {
    const error = new Error(cuerpo?.error || `Error del servidor (${r.status}).`);
    error.estado = r.status;
    throw error;
  }
  return cuerpo;
}

// Devuelve { data, error } en lugar de lanzar la excepcion
export async function resultado(promesa) {
  try {
    return { data: await promesa, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

// Comprueba la sesion y devuelve el perfil. Redirige si no corresponde.
export async function requerirSesion({ soloAdmin = false } = {}) {
  let perfil;
  try {
    perfil = await api('sesion');
  } catch {
    location.replace('./');
    return new Promise(() => {});
  }
  if (soloAdmin && perfil.rol !== 'admin') {
    location.replace('panel.html');
    return new Promise(() => {});
  }
  return perfil;
}

export async function cerrarSesion() {
  try {
    await api('logout');
  } finally {
    location.replace('./');
  }
}

// ---------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------

const fmtMoneda = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmtHora = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtFecha = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtFechaCorta = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fmtFechaLarga = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const moneda = (n) => fmtMoneda.format(Number(n) || 0);
export const hora = (d) => (d ? fmtHora.format(new Date(d)) : '');
export const fecha = (d) => (d ? fmtFecha.format(new Date(d)) : '');
export const fechaCorta = (d) => (d ? fmtFechaCorta.format(new Date(d)) : '');
export const fechaLarga = (d) => (d ? fmtFechaLarga.format(new Date(d)) : '');

// Fecha tipo "2026-10-05" (sin hora) mostrada como texto
export const fechaCortaDia = (iso) => fechaCorta(diaADate(iso));
export const fechaLargaDia = (iso) => fechaLarga(diaADate(iso));

export function horasTexto(h) {
  const totalMin = Math.round((Number(h) || 0) * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${hh} h ${String(mm).padStart(2, '0')} min`;
}

export function horasDecimal(h) {
  return (Number(h) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function horaCorta(t) {
  return t ? String(t).slice(0, 5) : '';
}

export function metros(m) {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
}

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Fechas (en hora de Madrid)
// ---------------------------------------------------------------------

// Devuelve "YYYY-MM-DD" del dia en Madrid para un instante dado
export function diaDe(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(d));
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

// Desfase en minutos de Madrid respecto a UTC en un instante dado
function desfaseMadrid(instante) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante);
  const v = Object.fromEntries(p.map((x) => [x.type, Number(x.value)]));
  const comoUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return Math.round((comoUTC - instante.getTime()) / 60000);
}

// Convierte fecha "YYYY-MM-DD" y hora "HH:MM" de Madrid a Date
export function instanteMadrid(dia, hhmm = '00:00') {
  const [a, m, d] = dia.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const aprox = new Date(Date.UTC(a, m - 1, d, h, mi));
  let t = aprox.getTime() - desfaseMadrid(aprox) * 60000;
  t = aprox.getTime() - desfaseMadrid(new Date(t)) * 60000;
  return new Date(t);
}

export function diaADate(dia) {
  return instanteMadrid(dia, '12:00');
}

export function sumarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return f.toISOString().slice(0, 10);
}

export function lunesDe(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return sumarDias(dia, -((dow + 6) % 7));
}

// Valor para <input type="datetime-local"> en hora de Madrid
export function aInputFechaHora(d) {
  if (!d) return '';
  const inst = new Date(d);
  return `${diaDe(inst)}T${new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(inst)}`;
}

export function deInputFechaHora(v) {
  if (!v) return null;
  const [dia, hh] = v.split('T');
  return instanteMadrid(dia, hh).toISOString();
}

// Rangos de fechas predefinidos: devuelve { desde, hasta } como "YYYY-MM-DD" (ambos incluidos)
export function rangoPeriodo(periodo) {
  const hoy = diaDe();
  const [a, m] = hoy.split('-').map(Number);
  const primeroMes = (anio, mes) => new Date(Date.UTC(anio, mes - 1, 1)).toISOString().slice(0, 10);
  switch (periodo) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case 'semana': return { desde: lunesDe(hoy), hasta: sumarDias(lunesDe(hoy), 6) };
    case 'semana_anterior': return { desde: sumarDias(lunesDe(hoy), -7), hasta: sumarDias(lunesDe(hoy), -1) };
    case 'mes': return { desde: primeroMes(a, m), hasta: sumarDias(primeroMes(a, m + 1), -1) };
    case 'mes_anterior': return { desde: primeroMes(a, m - 1), hasta: sumarDias(primeroMes(a, m), -1) };
    case 'anio': return { desde: `${a}-01-01`, hasta: `${a}-12-31` };
    default: return { desde: null, hasta: null };
  }
}

// ---------------------------------------------------------------------
// Calculos de horas y dinero
// ---------------------------------------------------------------------

export function horasFichaje(f, ahora = new Date()) {
  const fin = f.salida ? new Date(f.salida) : ahora;
  return Math.max(0, (fin - new Date(f.entrada)) / 3600000);
}

export function importeFichaje(f) {
  if (!f.salida) return 0;
  return Math.round(horasFichaje(f) * Number(f.tarifa) * 100) / 100;
}

export const TIPOS_MOVIMIENTO = {
  pago: { nombre: 'Pago', signo: -1 },
  anticipo: { nombre: 'Anticipo', signo: -1 },
  bonificacion: { nombre: 'Bonificación / extra', signo: 1 },
  descuento: { nombre: 'Descuento', signo: -1 },
};

// Resumen economico: solo cuentan los fichajes cerrados
export function calcularSaldo(fichajes, movimientos) {
  let horas = 0;
  let devengado = 0;
  for (const f of fichajes) {
    if (!f.salida) continue;
    horas += horasFichaje(f);
    devengado += importeFichaje(f);
  }
  let pagado = 0;
  let extras = 0;
  for (const m of movimientos) {
    const imp = Number(m.importe);
    if (m.tipo === 'pago' || m.tipo === 'anticipo') pagado += imp;
    else if (m.tipo === 'bonificacion') extras += imp;
    else if (m.tipo === 'descuento') extras -= imp;
  }
  const r = (n) => Math.round(n * 100) / 100;
  return { horas, devengado: r(devengado), extras: r(extras), pagado: r(pagado), saldo: r(devengado + extras - pagado) };
}

// Agrupa fichajes por dia (dia de la entrada, en Madrid)
export function agruparPorDia(fichajes) {
  const mapa = new Map();
  for (const f of fichajes) {
    const d = diaDe(f.entrada);
    if (!mapa.has(d)) mapa.set(d, []);
    mapa.get(d).push(f);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, lista]) => ({
      dia,
      fichajes: lista.sort((a, b) => new Date(a.entrada) - new Date(b.entrada)),
      horas: lista.reduce((s, f) => s + (f.salida ? horasFichaje(f) : 0), 0),
      importe: lista.reduce((s, f) => s + importeFichaje(f), 0),
      abierto: lista.some((f) => !f.salida),
    }));
}

export function duracionTurno(t) {
  const [h1, m1] = t.hora_inicio.split(':').map(Number);
  const [h2, m2] = t.hora_fin.split(':').map(Number);
  let min = h2 * 60 + m2 - (h1 * 60 + m1);
  if (min <= 0) min += 24 * 60;
  return min / 60;
}

// ---------------------------------------------------------------------
// Ubicacion de alta precision
// ---------------------------------------------------------------------

// Escucha el GPS hasta conseguir una precision objetivo o agotar el tiempo,
// y devuelve la mejor lectura obtenida.
export function obtenerUbicacion({ objetivo = 20, maxMs = 15000, alProgresar } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Este dispositivo no permite obtener la ubicación.'));
      return;
    }
    let mejor = null;
    let terminado = false;
    let idWatch = null;
    let temporizador = null;

    const terminar = (error) => {
      if (terminado) return;
      terminado = true;
      if (idWatch !== null) navigator.geolocation.clearWatch(idWatch);
      clearTimeout(temporizador);
      if (mejor) resolve(mejor);
      else reject(error || new Error('No se pudo obtener la ubicación. Comprueba que el GPS está activado.'));
    };

    idWatch = navigator.geolocation.watchPosition(
      (p) => {
        const lectura = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy };
        if (!mejor || lectura.precision < mejor.precision) mejor = lectura;
        if (alProgresar) alProgresar(mejor);
        if (lectura.precision <= objetivo) terminar();
      },
      (err) => {
        if (err.code === 1) {
          terminar(new Error('Permiso de ubicación denegado. Actívalo en los ajustes del navegador para poder fichar.'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs },
    );
    temporizador = setTimeout(() => terminar(), maxMs);
  });
}

export function distanciaMetros(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

export function enlaceMapa(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function descripcionDispositivo() {
  const ua = navigator.userAgent;
  let so = 'Otro';
  if (/iPhone|iPad|iPod/.test(ua)) so = 'iOS';
  else if (/Android/.test(ua)) so = 'Android';
  else if (/Windows/.test(ua)) so = 'Windows';
  else if (/Mac OS X/.test(ua)) so = 'macOS';
  else if (/Linux/.test(ua)) so = 'Linux';
  let nav = 'Navegador';
  if (/EdgA?\//.test(ua)) nav = 'Edge';
  else if (/SamsungBrowser/.test(ua)) nav = 'Samsung Internet';
  else if (/CriOS|Chrome\//.test(ua)) nav = 'Chrome';
  else if (/FxiOS|Firefox\//.test(ua)) nav = 'Firefox';
  else if (/Safari\//.test(ua)) nav = 'Safari';
  return `${so} · ${nav}`;
}

// ---------------------------------------------------------------------
// Interfaz: avisos y ventanas
// ---------------------------------------------------------------------

let contenedorAvisos = null;

export function avisar(texto, tipo = 'ok') {
  if (!contenedorAvisos) {
    contenedorAvisos = document.createElement('div');
    contenedorAvisos.className = 'notificaciones';
    contenedorAvisos.setAttribute('role', 'status');
    document.body.appendChild(contenedorAvisos);
  }
  const el = document.createElement('div');
  el.className = `notificacion ${tipo === 'error' ? 'error' : ''}`;
  el.textContent = texto;
  contenedorAvisos.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3500);
}

export function mensajeError(error) {
  const m = error?.message || String(error || 'Error desconocido');
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión. Comprueba tu conexión a internet.';
  return m;
}

// Abre una ventana modal. "cuerpo" y "pie" son HTML. Devuelve { el, cerrar }.
export function abrirModal({ titulo, cuerpo, pie = '', ancho = false, alCerrar }) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal ${ancho ? 'modal-ancho' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-cabecera">
        <h2>${esc(titulo)}</h2>
        <button type="button" class="modal-cerrar" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-cuerpo">${cuerpo}</div>
      ${pie ? `<div class="modal-pie">${pie}</div>` : ''}
    </div>`;
  const cerrar = () => {
    fondo.remove();
    document.removeEventListener('keydown', alTeclear);
    if (alCerrar) alCerrar();
  };
  const alTeclear = (e) => { if (e.key === 'Escape') cerrar(); };
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
  fondo.querySelector('.modal-cerrar').addEventListener('click', cerrar);
  fondo.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', cerrar));
  document.addEventListener('keydown', alTeclear);
  document.body.appendChild(fondo);
  const primero = fondo.querySelector('input:not([type=hidden]), select, textarea');
  if (primero) primero.focus();
  return { el: fondo, cerrar };
}

export function confirmar(texto, { titulo = 'Confirmar', boton = 'Aceptar', peligro = false } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const { el, cerrar } = abrirModal({
      titulo,
      cuerpo: `<p>${esc(texto)}</p>`,
      pie: `<button type="button" class="boton" data-cerrar>Cancelar</button>
            <button type="button" class="boton ${peligro ? 'boton-peligro' : 'boton-primario'}" data-ok>${esc(boton)}</button>`,
      alCerrar: () => { if (!respondido) resolve(false); },
    });
    el.querySelector('[data-ok]').addEventListener('click', () => {
      respondido = true;
      cerrar();
      resolve(true);
    });
  });
}

// Descarga un CSV compatible con Excel en espanol (separador ";")
export function descargarCSV(nombre, filas) {
  const texto = filas
    .map((fila) => fila.map((v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';'))
    .join('\r\n');
  const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function numeroCSV(n, decimales = 2) {
  return (Number(n) || 0).toFixed(decimales).replace('.', ',');
}

// Boton "Actualizar" de la barra superior. En la app instalada en el iPhone
// no existe el gesto de deslizar hacia abajo para recargar.
export function botonActualizar(boton, recargar) {
  if (!boton) return;
  boton.addEventListener('click', async () => {
    if (boton.disabled) return;
    boton.disabled = true;
    boton.classList.add('girando');
    try {
      await recargar();
      avisar('Datos actualizados.');
    } catch (e) {
      avisar(mensajeError(e), 'error');
    } finally {
      boton.disabled = false;
      boton.classList.remove('girando');
    }
  });
}
