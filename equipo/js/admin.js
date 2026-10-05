import {
  sb, requerirSesion, cerrarSesion, moneda, hora, fecha, horasTexto, horasDecimal, horaCorta, metros, esc,
  diaDe, sumarDias, lunesDe, instanteMadrid, rangoPeriodo, fechaCortaDia,
  aInputFechaHora, deInputFechaHora, horasFichaje, importeFichaje, duracionTurno,
  obtenerUbicacion, enlaceMapa, avisar, mensajeError, abrirModal, confirmar, descargarCSV, numeroCSV,
  TIPOS_MOVIMIENTO,
} from './comun.js';

const yo = await requerirSesion({ soloAdmin: true });
const $ = (id) => document.getElementById(id);
const L = window.L;

const HORAS_OLVIDO = 14; // un fichaje abierto mas de estas horas se considera olvidado
const PRECISION_BAJA = 100; // metros

let ajustes = null;
let trabajadores = [];          // todos los perfiles
const porId = new Map();

$('salir').addEventListener('click', cerrarSesion);

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

async function todas(crearConsulta) {
  const salida = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await crearConsulta().range(desde, desde + 999);
    if (error) throw error;
    salida.push(...data);
    if (data.length < 1000) break;
  }
  return salida;
}

function nombre(id) {
  return porId.get(id)?.nombre ?? 'Desconocido';
}

function tarifaEfectiva(p) {
  return p.tarifa_hora ?? ajustes.tarifa_general;
}

function opcionesTrabajadores({ todos = true, soloActivos = false, seleccionado = '' } = {}) {
  const lista = trabajadores.filter((t) => !soloActivos || t.activo);
  return (todos ? '<option value="">Todo el equipo</option>' : '')
    + lista.map((t) => `<option value="${t.id}" ${t.id === seleccionado ? 'selected' : ''}>${esc(t.nombre)}${t.activo ? '' : ' (inactivo)'}</option>`).join('');
}

function fueraDeZona(dist, precision) {
  return dist != null && dist > ajustes.radio_metros + (precision || 0);
}

function chipUbicacion(dist, precision) {
  if (dist == null) return '<span class="estado">Sin ubicación</span>';
  if (fueraDeZona(dist, precision)) return `<span class="estado estado-error">Fuera, a ${esc(metros(dist))}</span>`;
  if (precision > PRECISION_BAJA) return `<span class="estado estado-aviso">Imprecisa (±${esc(metros(precision))})</span>`;
  return `<span class="estado estado-ok">En el local</span>`;
}

function incidenciasFichaje(f) {
  const lista = [];
  if (fueraDeZona(f.entrada_distancia, f.entrada_precision)) lista.push('Entrada fuera de zona');
  if (f.salida && fueraDeZona(f.salida_distancia, f.salida_precision)) lista.push('Salida fuera de zona');
  if (f.entrada_lat == null && !f.manual) lista.push('Entrada sin ubicación');
  if (f.salida && f.salida_lat == null && !f.manual && !f.editado_en) lista.push('Salida sin ubicación');
  if (!f.salida && horasFichaje(f) > HORAS_OLVIDO) lista.push(`Abierto más de ${HORAS_OLVIDO} h (posible olvido)`);
  if (f.salida && horasFichaje(f) > HORAS_OLVIDO) lista.push(`Jornada de más de ${HORAS_OLVIDO} h`);
  return lista;
}

async function errorFuncion(error) {
  try {
    const cuerpo = await error.context.json();
    return cuerpo.error || error.message;
  } catch {
    return error.message;
  }
}

async function llamarAdminUsuarios(cuerpo) {
  const { data, error } = await sb.functions.invoke('admin-usuarios', { body: cuerpo });
  if (error) throw new Error(await errorFuncion(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

function generarPassword() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const valores = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(valores, (v) => letras[v % letras.length]).join('');
}

// ---------------------------------------------------------------------
// Mapas (Leaflet + OpenStreetMap)
// ---------------------------------------------------------------------

function crearMapa(elemento) {
  const mapa = L.map(elemento, { scrollWheelZoom: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(mapa);
  return mapa;
}

function dibujarLocal(mapa) {
  if (ajustes.lat_local == null) return null;
  const centro = [ajustes.lat_local, ajustes.lng_local];
  L.circle(centro, { radius: ajustes.radio_metros, color: '#111', weight: 1, fillColor: '#f2c200', fillOpacity: 0.12 }).addTo(mapa);
  L.circleMarker(centro, { radius: 6, color: '#111', weight: 2, fillColor: '#f2c200', fillOpacity: 1 })
    .bindTooltip('MYA Pedregalejo').addTo(mapa);
  return centro;
}

// puntos: [{ lat, lng, precision, titulo, detalle, tipo: 'entrada'|'salida' }]
function abrirMapa(titulo, puntos) {
  const { el } = abrirModal({
    titulo,
    ancho: true,
    cuerpo: `<div class="mapa" id="mapa-modal"></div>
      <p class="campo-ayuda" style="margin-top:8px">Círculo amarillo: zona del local. Verde: entradas. Negro: salidas. El círculo fino alrededor de cada punto indica la precisión del GPS.</p>`,
  });
  const mapa = crearMapa(el.querySelector('#mapa-modal'));
  const limites = [];
  const centro = dibujarLocal(mapa);
  if (centro) limites.push(centro);
  for (const p of puntos) {
    if (p.lat == null) continue;
    const color = p.tipo === 'salida' ? '#111111' : '#1f7a4d';
    if (p.precision) {
      L.circle([p.lat, p.lng], { radius: p.precision, color, weight: 1, fillOpacity: 0.05 }).addTo(mapa);
    }
    L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
      .bindPopup(`<strong>${esc(p.titulo)}</strong><br>${p.detalle}`)
      .addTo(mapa);
    limites.push([p.lat, p.lng]);
  }
  setTimeout(() => {
    mapa.invalidateSize();
    if (limites.length > 1) mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 18 });
    else if (limites.length === 1) mapa.setView(limites[0], 16);
    else mapa.setView([36.7207, -4.3752], 15);
  }, 50);
}

function puntosDeFichajes(fichajes) {
  const puntos = [];
  for (const f of fichajes) {
    if (f.entrada_lat != null) {
      puntos.push({
        lat: f.entrada_lat, lng: f.entrada_lng, precision: f.entrada_precision, tipo: 'entrada',
        titulo: `${nombre(f.usuario_id)} - entrada`,
        detalle: `${esc(fecha(f.entrada))} ${esc(hora(f.entrada))}<br>Precisión: ${esc(metros(f.entrada_precision))}<br>Distancia al local: ${esc(metros(f.entrada_distancia))}${f.entrada_dispositivo ? `<br>${esc(f.entrada_dispositivo)}` : ''}`,
      });
    }
    if (f.salida && f.salida_lat != null) {
      puntos.push({
        lat: f.salida_lat, lng: f.salida_lng, precision: f.salida_precision, tipo: 'salida',
        titulo: `${nombre(f.usuario_id)} - salida`,
        detalle: `${esc(fecha(f.salida))} ${esc(hora(f.salida))}<br>Precisión: ${esc(metros(f.salida_precision))}<br>Distancia al local: ${esc(metros(f.salida_distancia))}${f.salida_dispositivo ? `<br>${esc(f.salida_dispositivo)}` : ''}`,
      });
    }
  }
  return puntos;
}

// ---------------------------------------------------------------------
// Navegacion por secciones
// ---------------------------------------------------------------------

const SECCIONES = {
  hoy: () => cargarHoy(),
  fichajes: () => cargarFichajes(),
  saldos: () => cargarSaldos(),
  turnos: () => cargarTurnos(),
  equipo: () => pintarEquipo(),
  ajustes: () => pintarAjustes(),
};

function mostrarSeccion(nombreSeccion) {
  if (!SECCIONES[nombreSeccion]) nombreSeccion = 'hoy';
  document.querySelectorAll('[data-panel]').forEach((s) => { s.hidden = s.id !== `seccion-${nombreSeccion}`; });
  document.querySelectorAll('.pestana').forEach((b) => b.classList.toggle('activa', b.dataset.seccion === nombreSeccion));
  if (location.hash !== `#${nombreSeccion}`) history.replaceState(null, '', `#${nombreSeccion}`);
  SECCIONES[nombreSeccion]().catch((e) => avisar(mensajeError(e), 'error'));
}

document.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => mostrarSeccion(b.dataset.seccion)));

async function cargarBase() {
  const [{ data: aj, error: e1 }, { data: perfiles, error: e2 }] = await Promise.all([
    sb.from('ajustes').select('*').eq('id', 1).single(),
    sb.from('perfiles').select('*').order('activo', { ascending: false }).order('nombre'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  ajustes = aj;
  trabajadores = perfiles;
  porId.clear();
  for (const p of perfiles) porId.set(p.id, p);
  $('f-trabajador').innerHTML = opcionesTrabajadores({ seleccionado: $('f-trabajador').value });
  $('s-filtro').innerHTML = opcionesTrabajadores({ seleccionado: $('s-filtro').value });
}

// =====================================================================
// HOY
// =====================================================================

let hoyFichajes = [];

async function cargarHoy() {
  const hoy = diaDe();
  const inicioHoy = instanteMadrid(hoy).toISOString();
  const hace7 = instanteMadrid(sumarDias(hoy, -6)).toISOString();

  const [recientes, abiertos, { data: turnos, error: eT }, { data: saldos, error: eS }] = await Promise.all([
    todas(() => sb.from('fichajes').select('*').gte('entrada', hace7).order('entrada', { ascending: false })),
    todas(() => sb.from('fichajes').select('*').is('salida', null).order('entrada')),
    sb.from('turnos').select('*').eq('fecha', hoy).order('hora_inicio'),
    sb.rpc('saldos'),
  ]);
  if (eT) throw eT;
  if (eS) throw eS;

  hoyFichajes = recientes.filter((f) => f.entrada >= inicioHoy || !f.salida);
  for (const f of abiertos) if (!hoyFichajes.some((x) => x.id === f.id)) hoyFichajes.push(f);

  // KPIs
  $('kpi-trabajando').textContent = String(abiertos.length);
  $('kpi-trabajando-det').textContent = abiertos.length ? abiertos.map((f) => nombre(f.usuario_id)).join(', ') : 'Nadie en este momento';
  const horasHoy = recientes.filter((f) => f.entrada >= inicioHoy).reduce((s, f) => s + horasFichaje(f), 0);
  $('kpi-horas').textContent = horasTexto(horasHoy);
  $('kpi-pendiente').textContent = moneda((saldos || []).reduce((s, x) => s + Number(x.saldo), 0));

  // Trabajando ahora
  $('hoy-trabajando').innerHTML = abiertos.length === 0
    ? '<li class="vacio">Nadie ha fichado entrada en este momento.</li>'
    : abiertos.map((f) => `
      <li>
        <div>
          <div class="principal">${esc(nombre(f.usuario_id))}</div>
          <div class="secundario">Desde ${esc(diaDe(f.entrada) === hoy ? hora(f.entrada) : `${fecha(f.entrada)} ${hora(f.entrada)}`)} · ${esc(horasTexto(horasFichaje(f)))}</div>
        </div>
        <div class="botones">${chipUbicacion(f.entrada_distancia, f.entrada_precision)}
          ${f.entrada_lat != null ? `<a class="boton boton-pequeno" href="${enlaceMapa(f.entrada_lat, f.entrada_lng)}" target="_blank" rel="noopener">Mapa</a>` : ''}
        </div>
      </li>`).join('');

  // Turnos de hoy contra fichajes
  let incidenciasHoy = 0;
  const ahora = new Date();
  const fichajesHoy = recientes.filter((f) => diaDe(f.entrada) === hoy);
  $('hoy-turnos').innerHTML = (turnos || []).length === 0
    ? '<li class="vacio">No hay turnos programados para hoy.</li>'
    : turnos.map((t) => {
      const inicio = instanteMadrid(t.fecha, horaCorta(t.hora_inicio));
      const fin = new Date(inicio.getTime() + duracionTurno(t) * 3600000);
      const suyos = fichajesHoy
        .filter((f) => f.usuario_id === t.usuario_id
          && new Date(f.entrada) >= new Date(inicio.getTime() - 3 * 3600000)
          && new Date(f.entrada) < fin)
        .sort((a, b) => new Date(a.entrada) - new Date(b.entrada));
      const primero = suyos[0];
      let estado;
      if (primero) {
        const retraso = Math.round((new Date(primero.entrada) - inicio) / 60000);
        if (retraso > ajustes.margen_retraso_min) {
          estado = `<span class="estado estado-aviso">Entrada ${esc(hora(primero.entrada))}, ${retraso} min tarde</span>`;
          incidenciasHoy += 1;
        } else {
          estado = `<span class="estado estado-ok">Entrada ${esc(hora(primero.entrada))}</span>`;
        }
      } else if (ahora > fin) {
        estado = '<span class="estado estado-error">No fichó</span>';
        incidenciasHoy += 1;
      } else if (ahora > new Date(inicio.getTime() + ajustes.margen_retraso_min * 60000)) {
        estado = '<span class="estado estado-error">Sin fichar</span>';
        incidenciasHoy += 1;
      } else {
        estado = '<span class="estado">Pendiente</span>';
      }
      return `<li>
        <div><div class="principal">${esc(nombre(t.usuario_id))}</div>
          <div class="secundario">${esc(horaCorta(t.hora_inicio))} - ${esc(horaCorta(t.hora_fin))}${t.nota ? ` · ${esc(t.nota)}` : ''}</div></div>
        ${estado}
      </li>`;
    }).join('');

  // Incidencias de los ultimos 7 dias
  const conIncidencias = [...new Map([...recientes, ...abiertos].map((f) => [f.id, f])).values()]
    .map((f) => ({ f, lista: incidenciasFichaje(f) }))
    .filter((x) => x.lista.length > 0);
  incidenciasHoy += conIncidencias.filter((x) => diaDe(x.f.entrada) === hoy || !x.f.salida).length;
  $('kpi-incidencias').textContent = String(incidenciasHoy);
  $('hoy-alertas').innerHTML = conIncidencias.length === 0
    ? '<li class="vacio">Sin incidencias en los últimos 7 días.</li>'
    : conIncidencias.map(({ f, lista }) => `
      <li>
        <div><div class="principal">${esc(nombre(f.usuario_id))} · ${esc(fechaCortaDia(diaDe(f.entrada)))} ${esc(hora(f.entrada))}${f.salida ? ` - ${esc(hora(f.salida))}` : ''}</div>
          <div class="secundario">${lista.map(esc).join(' · ')}</div></div>
        <button class="boton boton-pequeno" data-editar="${f.id}" type="button">Revisar</button>
      </li>`).join('');

  // Tabla de fichajes de hoy
  const tablaHoy = [...fichajesHoy].sort((a, b) => new Date(b.entrada) - new Date(a.entrada));
  $('hoy-fichajes').innerHTML = tablaHoy.length === 0
    ? '<tr><td colspan="6" class="vacio">Todavía no hay fichajes hoy.</td></tr>'
    : tablaHoy.map((f) => `
      <tr>
        <td>${esc(nombre(f.usuario_id))}</td>
        <td class="nowrap">${esc(hora(f.entrada))}</td>
        <td class="nowrap">${f.salida ? esc(hora(f.salida)) : '<span class="estado estado-ok"><span class="punto punto-vivo"></span>En curso</span>'}</td>
        <td class="num">${esc(horasTexto(horasFichaje(f)))}</td>
        <td>${chipUbicacion(f.entrada_distancia, f.entrada_precision)}</td>
        <td class="num"><button class="boton boton-pequeno" data-editar="${f.id}" type="button">Detalle</button></td>
      </tr>`).join('');

  const indice = new Map([...recientes, ...abiertos].map((f) => [String(f.id), f]));
  document.querySelectorAll('#seccion-hoy [data-editar]').forEach((b) => {
    b.addEventListener('click', () => editarFichaje(indice.get(b.dataset.editar), cargarHoy));
  });
}

$('hoy-actualizar').addEventListener('click', () => cargarHoy().catch((e) => avisar(mensajeError(e), 'error')));
$('hoy-mapa').addEventListener('click', () => {
  const abiertos = hoyFichajes.filter((f) => !f.salida);
  abrirMapa('Ubicación de entrada de quienes están trabajando', puntosDeFichajes(abiertos));
});

// =====================================================================
// FICHAJES
// =====================================================================

let listaFichajes = [];

function rangoFiltro() {
  const periodo = $('f-periodo').value;
  if (periodo !== 'personalizado') {
    const r = rangoPeriodo(periodo);
    $('f-desde').value = r.desde;
    $('f-hasta').value = r.hasta;
  }
  return { desde: $('f-desde').value, hasta: $('f-hasta').value };
}

async function cargarFichajes() {
  const { desde, hasta } = rangoFiltro();
  if (!desde || !hasta) return;
  const usuario = $('f-trabajador').value;
  $('f-rango-texto').textContent = `${fecha(instanteMadrid(desde, '12:00'))} - ${fecha(instanteMadrid(hasta, '12:00'))}`;

  listaFichajes = await todas(() => {
    let q = sb.from('fichajes').select('*')
      .gte('entrada', instanteMadrid(desde).toISOString())
      .lt('entrada', instanteMadrid(sumarDias(hasta, 1)).toISOString())
      .order('entrada', { ascending: false });
    if (usuario) q = q.eq('usuario_id', usuario);
    return q;
  });

  const soloIncidencias = $('f-incidencias').checked;
  const visibles = soloIncidencias ? listaFichajes.filter((f) => incidenciasFichaje(f).length) : listaFichajes;
  $('f-contador').textContent = `${visibles.length} registro${visibles.length === 1 ? '' : 's'}`;

  // Resumen por trabajador
  const resumen = new Map();
  for (const f of listaFichajes) {
    if (!resumen.has(f.usuario_id)) resumen.set(f.usuario_id, { dias: new Set(), horas: 0, importe: 0, incidencias: 0 });
    const r = resumen.get(f.usuario_id);
    r.dias.add(diaDe(f.entrada));
    if (f.salida) r.horas += horasFichaje(f);
    r.importe += importeFichaje(f);
    if (incidenciasFichaje(f).length) r.incidencias += 1;
  }
  const filasResumen = [...resumen.entries()].sort((a, b) => nombre(a[0]).localeCompare(nombre(b[0]), 'es'));
  $('f-resumen').innerHTML = filasResumen.length === 0
    ? '<tr><td colspan="5" class="vacio">No hay fichajes en este periodo.</td></tr>'
    : filasResumen.map(([id, r]) => `
      <tr>
        <td>${esc(nombre(id))}</td>
        <td class="num">${r.dias.size}</td>
        <td class="num">${esc(horasTexto(r.horas))}</td>
        <td class="num">${esc(moneda(r.importe))}</td>
        <td class="num">${r.incidencias ? `<span class="estado estado-aviso">${r.incidencias}</span>` : '0'}</td>
      </tr>`).join('');
  const tot = filasResumen.reduce((s, [, r]) => ({ horas: s.horas + r.horas, importe: s.importe + r.importe }), { horas: 0, importe: 0 });
  $('f-resumen-total').innerHTML = filasResumen.length > 1
    ? `<tr><td>Total</td><td></td><td class="num">${esc(horasTexto(tot.horas))}</td><td class="num">${esc(moneda(tot.importe))}</td><td></td></tr>`
    : '';

  // Detalle
  $('f-tabla').innerHTML = visibles.length === 0
    ? '<tr><td colspan="9" class="vacio">No hay registros con estos filtros.</td></tr>'
    : visibles.map((f) => {
      const inc = incidenciasFichaje(f);
      return `<tr>
        <td>${esc(nombre(f.usuario_id))}${f.manual ? ' <span class="estado">Manual</span>' : ''}${f.editado_en && !f.manual ? ' <span class="estado" title="Modificado por el administrador">Editado</span>' : ''}</td>
        <td class="nowrap">${esc(fechaCortaDia(diaDe(f.entrada)))}</td>
        <td class="nowrap">${esc(hora(f.entrada))}</td>
        <td class="nowrap">${f.salida ? `${esc(hora(f.salida))}${diaDe(f.salida) !== diaDe(f.entrada) ? ' <small>(+1)</small>' : ''}` : '<span class="estado estado-ok">En curso</span>'}</td>
        <td class="num">${esc(horasTexto(horasFichaje(f)))}</td>
        <td class="num">${esc(moneda(f.tarifa))}</td>
        <td class="num">${esc(moneda(importeFichaje(f)))}</td>
        <td>${chipUbicacion(f.entrada_distancia, f.entrada_precision)}${inc.length ? `<div class="campo-ayuda" style="margin-top:4px">${inc.map(esc).join('<br>')}</div>` : ''}</td>
        <td class="num"><button class="boton boton-pequeno" data-editar="${f.id}" type="button">Editar</button></td>
      </tr>`;
    }).join('');

  document.querySelectorAll('#f-tabla [data-editar]').forEach((b) => {
    b.addEventListener('click', () => editarFichaje(listaFichajes.find((f) => String(f.id) === b.dataset.editar), cargarFichajes));
  });
}

['f-trabajador', 'f-periodo', 'f-incidencias'].forEach((id) => $(id).addEventListener('change', () => cargarFichajes().catch((e) => avisar(mensajeError(e), 'error'))));
['f-desde', 'f-hasta'].forEach((id) => $(id).addEventListener('change', () => {
  $('f-periodo').value = 'personalizado';
  cargarFichajes().catch((e) => avisar(mensajeError(e), 'error'));
}));
$('f-nuevo').addEventListener('click', () => editarFichaje(null, cargarFichajes));
$('f-mapa').addEventListener('click', () => abrirMapa('Ubicaciones de los fichajes filtrados', puntosDeFichajes(listaFichajes)));

$('f-csv').addEventListener('click', () => {
  const filas = [['Trabajador', 'Día', 'Entrada', 'Salida', 'Horas', 'Tarifa', 'Importe', 'Distancia entrada (m)', 'Precisión entrada (m)', 'Lat entrada', 'Lng entrada', 'Distancia salida (m)', 'Lat salida', 'Lng salida', 'Manual', 'Nota', 'Incidencias']];
  for (const f of [...listaFichajes].reverse()) {
    filas.push([
      nombre(f.usuario_id), fecha(f.entrada), hora(f.entrada), f.salida ? `${fecha(f.salida)} ${hora(f.salida)}` : 'En curso',
      numeroCSV(f.salida ? horasFichaje(f) : 0), numeroCSV(f.tarifa), numeroCSV(importeFichaje(f)),
      f.entrada_distancia != null ? Math.round(f.entrada_distancia) : '', f.entrada_precision != null ? Math.round(f.entrada_precision) : '',
      f.entrada_lat ?? '', f.entrada_lng ?? '',
      f.salida_distancia != null ? Math.round(f.salida_distancia) : '', f.salida_lat ?? '', f.salida_lng ?? '',
      f.manual ? 'Sí' : 'No', f.nota || '', incidenciasFichaje(f).join(' | '),
    ]);
  }
  descargarCSV(`fichajes_${$('f-desde').value}_${$('f-hasta').value}.csv`, filas);
});

function editarFichaje(f, alGuardar) {
  const nuevo = !f;
  const ubicacionHtml = (tipo) => {
    const lat = f?.[`${tipo}_lat`];
    if (lat == null) return '<span class="subtitulo">Sin ubicación</span>';
    return `${chipUbicacion(f[`${tipo}_distancia`], f[`${tipo}_precision`])}
      <span class="subtitulo"> Precisión ${esc(metros(f[`${tipo}_precision`]))}, a ${esc(metros(f[`${tipo}_distancia`]))} del local</span>
      <a href="${enlaceMapa(lat, f[`${tipo}_lng`])}" target="_blank" rel="noopener" class="boton-texto">Google Maps</a>
      ${f[`${tipo}_dispositivo`] ? `<div class="campo-ayuda">${esc(f[`${tipo}_dispositivo`])}</div>` : ''}`;
  };
  const { el, cerrar } = abrirModal({
    titulo: nuevo ? 'Añadir fichaje manual' : `Fichaje de ${nombre(f.usuario_id)}`,
    ancho: !nuevo,
    cuerpo: `
      <form id="form-fichaje">
        ${nuevo ? `<div class="campo"><label for="ff-usuario">Trabajador</label><select id="ff-usuario" required>${opcionesTrabajadores({ todos: false, soloActivos: true })}</select></div>` : ''}
        <div class="fila-campos">
          <div class="campo"><label for="ff-entrada">Entrada</label><input id="ff-entrada" type="datetime-local" required value="${esc(aInputFechaHora(f?.entrada))}"></div>
          <div class="campo"><label for="ff-salida">Salida</label><input id="ff-salida" type="datetime-local" value="${esc(aInputFechaHora(f?.salida))}"></div>
          <div class="campo"><label for="ff-tarifa">Tarifa (EUR/h)</label><input id="ff-tarifa" type="number" min="0" step="0.01" required value="${esc(f ? f.tarifa : '')}"></div>
        </div>
        <div class="campo"><label for="ff-nota">Nota</label><input id="ff-nota" maxlength="300" value="${esc(f?.nota || '')}" placeholder="Motivo de la corrección, observaciones..."></div>
        ${nuevo ? '' : `
          <div class="campo"><span class="etiqueta">Ubicación de entrada</span><div>${ubicacionHtml('entrada')}</div></div>
          ${f.salida ? `<div class="campo"><span class="etiqueta">Ubicación de salida</span><div>${ubicacionHtml('salida')}</div></div>` : ''}
          ${(f.entrada_lat != null || f.salida_lat != null) ? '<div id="ff-mapa" class="mapa mapa-pequeno"></div>' : ''}
          ${incidenciasFichaje(f).length ? `<div class="aviso-caja aviso" style="margin-top:12px">${incidenciasFichaje(f).map(esc).join('<br>')}</div>` : ''}
          <p class="campo-ayuda" style="margin-top:10px">${f.manual ? 'Fichaje introducido manualmente.' : 'Fichaje realizado desde el móvil del trabajador.'}${f.editado_en ? ` Última modificación: ${esc(fecha(f.editado_en))} ${esc(hora(f.editado_en))} por ${esc(nombre(f.editado_por))}.` : ''}</p>`}
      </form>`,
    pie: `${nuevo ? '' : '<button class="boton boton-peligro" type="button" data-borrar style="margin-right:auto">Eliminar</button>'}
      <button class="boton" type="button" data-cerrar>Cancelar</button>
      <button class="boton boton-primario" type="submit" form="form-fichaje">Guardar</button>`,
  });

  if (nuevo) {
    const sel = el.querySelector('#ff-usuario');
    const ponerTarifa = () => { const t = porId.get(sel.value); if (t) el.querySelector('#ff-tarifa').value = tarifaEfectiva(t); };
    sel.addEventListener('change', ponerTarifa);
    ponerTarifa();
  } else if (el.querySelector('#ff-mapa')) {
    const mapa = crearMapa(el.querySelector('#ff-mapa'));
    const lim = [];
    const c = dibujarLocal(mapa);
    if (c) lim.push(c);
    for (const pto of puntosDeFichajes([f])) {
      const color = pto.tipo === 'salida' ? '#111111' : '#1f7a4d';
      if (pto.precision) L.circle([pto.lat, pto.lng], { radius: pto.precision, color, weight: 1, fillOpacity: 0.05 }).addTo(mapa);
      L.circleMarker([pto.lat, pto.lng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).bindPopup(`<strong>${esc(pto.titulo)}</strong><br>${pto.detalle}`).addTo(mapa);
      lim.push([pto.lat, pto.lng]);
    }
    setTimeout(() => { mapa.invalidateSize(); if (lim.length > 1) mapa.fitBounds(lim, { padding: [30, 30], maxZoom: 18 }); else mapa.setView(lim[0], 16); }, 50);
  }

  el.querySelector('#form-fichaje').addEventListener('submit', async (e) => {
    e.preventDefault();
    const entrada = deInputFechaHora(el.querySelector('#ff-entrada').value);
    const salida = deInputFechaHora(el.querySelector('#ff-salida').value);
    const tarifa = Number(el.querySelector('#ff-tarifa').value);
    if (!entrada) { avisar('Indica la hora de entrada.', 'error'); return; }
    if (salida && new Date(salida) <= new Date(entrada)) { avisar('La salida debe ser posterior a la entrada.', 'error'); return; }
    const datos = { entrada, salida, tarifa, nota: el.querySelector('#ff-nota').value.trim() || null };
    let error;
    if (nuevo) {
      ({ error } = await sb.from('fichajes').insert({ ...datos, usuario_id: el.querySelector('#ff-usuario').value, manual: true }));
    } else {
      ({ error } = await sb.from('fichajes').update(datos).eq('id', f.id));
    }
    if (error) {
      avisar(/fichajes_un_abierto/.test(error.message) ? 'Este trabajador ya tiene un fichaje abierto. Indica la hora de salida.' : mensajeError(error), 'error');
      return;
    }
    cerrar();
    avisar('Fichaje guardado.');
    alGuardar();
  });

  el.querySelector('[data-borrar]')?.addEventListener('click', async () => {
    if (!await confirmar('Se eliminará este fichaje de forma permanente.', { titulo: 'Eliminar fichaje', boton: 'Eliminar', peligro: true })) return;
    const { error } = await sb.from('fichajes').delete().eq('id', f.id);
    if (error) { avisar(mensajeError(error), 'error'); return; }
    cerrar();
    avisar('Fichaje eliminado.');
    alGuardar();
  });
}

// =====================================================================
// SALDOS Y PAGOS
// =====================================================================

let saldosActuales = [];
let movimientosActuales = [];

async function cargarSaldos() {
  const { data, error } = await sb.rpc('saldos');
  if (error) throw error;
  saldosActuales = data.filter((s) => porId.has(s.usuario_id))
    .filter((s) => porId.get(s.usuario_id).activo || Number(s.saldo) !== 0 || Number(s.horas) > 0)
    .sort((a, b) => nombre(a.usuario_id).localeCompare(nombre(b.usuario_id), 'es'));

  $('s-tabla').innerHTML = saldosActuales.length === 0
    ? '<tr><td colspan="7" class="vacio">No hay trabajadores.</td></tr>'
    : saldosActuales.map((s) => `
      <tr>
        <td>${esc(nombre(s.usuario_id))}${porId.get(s.usuario_id).activo ? '' : ' <span class="estado">Inactivo</span>'}</td>
        <td class="num">${esc(horasTexto(s.horas))}</td>
        <td class="num">${esc(moneda(s.devengado))}</td>
        <td class="num">${esc(moneda(s.extras))}</td>
        <td class="num">${esc(moneda(s.pagado))}</td>
        <td class="num"><strong>${esc(moneda(s.saldo))}</strong></td>
        <td class="num"><div class="botones" style="justify-content:flex-end">
          <button class="boton boton-pequeno" data-pagar="${s.usuario_id}" type="button">Pagar</button>
          <button class="boton boton-pequeno" data-ver="${s.usuario_id}" type="button">Horas</button>
        </div></td>
      </tr>`).join('');
  const total = saldosActuales.reduce((acc, s) => ({
    horas: acc.horas + Number(s.horas), devengado: acc.devengado + Number(s.devengado), extras: acc.extras + Number(s.extras),
    pagado: acc.pagado + Number(s.pagado), saldo: acc.saldo + Number(s.saldo),
  }), { horas: 0, devengado: 0, extras: 0, pagado: 0, saldo: 0 });
  $('s-total').innerHTML = `<tr><td>Total</td><td class="num">${esc(horasTexto(total.horas))}</td><td class="num">${esc(moneda(total.devengado))}</td>
    <td class="num">${esc(moneda(total.extras))}</td><td class="num">${esc(moneda(total.pagado))}</td><td class="num">${esc(moneda(total.saldo))}</td><td></td></tr>`;

  document.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', () => nuevoMovimiento(b.dataset.pagar)));
  document.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    $('f-trabajador').value = b.dataset.ver;
    $('f-periodo').value = 'mes';
    mostrarSeccion('fichajes');
  }));

  await cargarMovimientos();
}

async function cargarMovimientos() {
  const filtro = $('s-filtro').value;
  movimientosActuales = await todas(() => {
    let q = sb.from('movimientos').select('*').order('fecha', { ascending: false }).order('id', { ascending: false });
    if (filtro) q = q.eq('usuario_id', filtro);
    return q;
  });
  $('s-movimientos').innerHTML = movimientosActuales.length === 0
    ? '<tr><td colspan="6" class="vacio">No hay movimientos registrados.</td></tr>'
    : movimientosActuales.slice(0, 300).map((m) => {
      const t = TIPOS_MOVIMIENTO[m.tipo];
      return `<tr>
        <td class="nowrap">${esc(fechaCortaDia(m.fecha))}</td>
        <td>${esc(nombre(m.usuario_id))}</td>
        <td>${esc(t.nombre)}</td>
        <td>${esc(m.concepto || '')}</td>
        <td class="num">${t.signo > 0 ? '+' : '-'}${esc(moneda(m.importe))}</td>
        <td class="num"><button class="boton boton-pequeno boton-peligro" data-borrar-mov="${m.id}" type="button">Eliminar</button></td>
      </tr>`;
    }).join('');
  document.querySelectorAll('[data-borrar-mov]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmar('Se eliminará este movimiento y el saldo se recalculará.', { titulo: 'Eliminar movimiento', boton: 'Eliminar', peligro: true })) return;
    const { error } = await sb.from('movimientos').delete().eq('id', b.dataset.borrarMov);
    if (error) { avisar(mensajeError(error), 'error'); return; }
    avisar('Movimiento eliminado.');
    cargarSaldos().catch((e) => avisar(mensajeError(e), 'error'));
  }));
}

$('s-filtro').addEventListener('change', () => cargarMovimientos().catch((e) => avisar(mensajeError(e), 'error')));
$('s-nuevo').addEventListener('click', () => nuevoMovimiento(''));
$('s-csv').addEventListener('click', () => {
  const filas = [['Fecha', 'Trabajador', 'Tipo', 'Concepto', 'Importe']];
  for (const m of movimientosActuales) {
    filas.push([fecha(instanteMadrid(m.fecha, '12:00')), nombre(m.usuario_id), TIPOS_MOVIMIENTO[m.tipo].nombre, m.concepto || '', numeroCSV(TIPOS_MOVIMIENTO[m.tipo].signo * m.importe)]);
  }
  descargarCSV(`movimientos_${diaDe()}.csv`, filas);
});

function nuevoMovimiento(usuarioId) {
  const saldoDe = (id) => Number(saldosActuales.find((s) => s.usuario_id === id)?.saldo ?? 0);
  const { el, cerrar } = abrirModal({
    titulo: 'Registrar movimiento',
    cuerpo: `
      <form id="form-mov">
        <div class="campo"><label for="m-usuario">Trabajador</label><select id="m-usuario" required>${opcionesTrabajadores({ todos: false, seleccionado: usuarioId })}</select>
          <span class="campo-ayuda" id="m-saldo"></span></div>
        <div class="fila-campos">
          <div class="campo"><label for="m-tipo">Tipo</label>
            <select id="m-tipo">
              <option value="pago">Pago (reduce lo pendiente)</option>
              <option value="anticipo">Anticipo (reduce lo pendiente)</option>
              <option value="bonificacion">Bonificación / extra (aumenta lo pendiente)</option>
              <option value="descuento">Descuento (reduce lo pendiente)</option>
            </select></div>
          <div class="campo"><label for="m-importe">Importe (EUR)</label><input id="m-importe" type="number" min="0.01" step="0.01" required></div>
          <div class="campo"><label for="m-fecha">Fecha</label><input id="m-fecha" type="date" required value="${diaDe()}"></div>
        </div>
        <div class="campo"><label for="m-concepto">Concepto</label><input id="m-concepto" maxlength="200" placeholder="Por ejemplo: Nómina octubre, propinas, transferencia..."></div>
      </form>`,
    pie: '<button class="boton" type="button" data-cerrar>Cancelar</button><button class="boton boton-primario" type="submit" form="form-mov">Guardar</button>',
  });
  const sel = el.querySelector('#m-usuario');
  const actualizar = () => {
    const s = saldoDe(sel.value);
    el.querySelector('#m-saldo').textContent = `Pendiente actual: ${moneda(s)}`;
    if (el.querySelector('#m-tipo').value === 'pago' && s > 0) el.querySelector('#m-importe').value = s.toFixed(2);
  };
  sel.addEventListener('change', actualizar);
  el.querySelector('#m-tipo').addEventListener('change', actualizar);
  actualizar();

  el.querySelector('#form-mov').addEventListener('submit', async (e) => {
    e.preventDefault();
    const importe = Number(el.querySelector('#m-importe').value);
    if (!(importe > 0)) { avisar('El importe debe ser mayor que cero.', 'error'); return; }
    const { error } = await sb.from('movimientos').insert({
      usuario_id: sel.value,
      tipo: el.querySelector('#m-tipo').value,
      importe,
      fecha: el.querySelector('#m-fecha').value,
      concepto: el.querySelector('#m-concepto').value.trim() || null,
      creado_por: yo.id,
    });
    if (error) { avisar(mensajeError(error), 'error'); return; }
    cerrar();
    avisar('Movimiento registrado.');
    cargarSaldos().catch((err) => avisar(mensajeError(err), 'error'));
  });
}

// =====================================================================
// TURNOS
// =====================================================================

let semana = lunesDe(diaDe());
let turnosSemana = [];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

async function cargarTurnos() {
  const fin = sumarDias(semana, 6);
  const { data, error } = await sb.from('turnos').select('*').gte('fecha', semana).lte('fecha', fin).order('hora_inicio');
  if (error) throw error;
  turnosSemana = data;
  $('t-titulo').textContent = `Semana del ${fechaCortaDia(semana)} al ${fechaCortaDia(fin)}`;

  const hoy = diaDe();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(semana, i));
  const activos = trabajadores.filter((t) => t.activo || data.some((x) => x.usuario_id === t.id));

  let html = `<thead><tr><th>Trabajador</th>${dias.map((d, i) => `<th class="${d === hoy ? 'hoy' : ''}">${DIAS[i]}<br><small>${esc(fechaCortaDia(d).replace(/^\S+\s/, ''))}</small></th>`).join('')}<th style="width:80px">Horas</th></tr></thead><tbody>`;
  if (activos.length === 0) html += '<tr><td colspan="9" class="vacio">Primero da de alta a los trabajadores en la sección Equipo.</td></tr>';
  for (const t of activos) {
    let horas = 0;
    html += `<tr><td class="nombre">${esc(t.nombre)}</td>`;
    for (const d of dias) {
      const suyos = data.filter((x) => x.usuario_id === t.id && x.fecha === d);
      horas += suyos.reduce((s, x) => s + duracionTurno(x), 0);
      html += `<td class="celda" data-usuario="${t.id}" data-dia="${d}">${suyos.map((x) => `<button type="button" class="bloque-turno" data-turno="${x.id}">${esc(horaCorta(x.hora_inicio))} - ${esc(horaCorta(x.hora_fin))}${x.nota ? `<small>${esc(x.nota)}</small>` : ''}</button>`).join('')}</td>`;
    }
    html += `<td class="num">${horasDecimal(horas)} h</td></tr>`;
  }
  html += '</tbody>';
  $('t-cuadrante').innerHTML = html;

  $('t-cuadrante').querySelectorAll('td.celda').forEach((c) => c.addEventListener('click', (e) => {
    const bloque = e.target.closest('[data-turno]');
    if (bloque) editarTurno(turnosSemana.find((x) => String(x.id) === bloque.dataset.turno));
    else editarTurno(null, c.dataset.usuario, c.dataset.dia);
  }));
}

function editarTurno(t, usuarioId, dia) {
  const nuevo = !t;
  const diaBase = t?.fecha || dia;
  const lunes = lunesDe(diaBase);
  const { el, cerrar } = abrirModal({
    titulo: nuevo ? 'Nuevo turno' : 'Modificar turno',
    cuerpo: `
      <form id="form-turno">
        <div class="campo"><label for="tu-usuario">Trabajador</label><select id="tu-usuario" required>${opcionesTrabajadores({ todos: false, soloActivos: nuevo, seleccionado: t?.usuario_id || usuarioId })}</select></div>
        <div class="fila-campos">
          <div class="campo"><label for="tu-fecha">Fecha</label><input id="tu-fecha" type="date" required value="${esc(diaBase)}"></div>
          <div class="campo"><label for="tu-inicio">Inicio</label><input id="tu-inicio" type="time" required value="${esc(horaCorta(t?.hora_inicio) || '12:30')}"></div>
          <div class="campo"><label for="tu-fin">Fin</label><input id="tu-fin" type="time" required value="${esc(horaCorta(t?.hora_fin) || '16:30')}"></div>
        </div>
        <div class="campo"><label for="tu-nota">Nota</label><input id="tu-nota" maxlength="120" value="${esc(t?.nota || '')}" placeholder="Cocina, sala, barra..."></div>
        ${nuevo ? `<div class="campo"><span class="etiqueta">Repetir también esta semana</span>
          <div class="botones">${DIAS.map((n, i) => {
            const d = sumarDias(lunes, i);
            return `<label class="casilla" style="margin:0 8px 0 0"><input type="checkbox" data-repetir="${d}" ${d === diaBase ? 'checked disabled' : ''}>${n.slice(0, 3)}</label>`;
          }).join('')}</div></div>` : ''}
        <p class="campo-ayuda">Si la hora de fin es anterior a la de inicio, el turno termina al día siguiente.</p>
      </form>`,
    pie: `${nuevo ? '' : '<button class="boton boton-peligro" type="button" data-borrar style="margin-right:auto">Eliminar</button>'}
      <button class="boton" type="button" data-cerrar>Cancelar</button>
      <button class="boton boton-primario" type="submit" form="form-turno">Guardar</button>`,
  });

  el.querySelector('#form-turno').addEventListener('submit', async (e) => {
    e.preventDefault();
    const base = {
      usuario_id: el.querySelector('#tu-usuario').value,
      hora_inicio: el.querySelector('#tu-inicio').value,
      hora_fin: el.querySelector('#tu-fin').value,
      nota: el.querySelector('#tu-nota').value.trim() || null,
    };
    if (base.hora_inicio === base.hora_fin) { avisar('La hora de inicio y la de fin no pueden ser iguales.', 'error'); return; }
    const fechaElegida = el.querySelector('#tu-fecha').value;
    let error;
    if (nuevo) {
      const fechas = new Set([fechaElegida]);
      el.querySelectorAll('[data-repetir]:checked:not(:disabled)').forEach((c) => fechas.add(c.dataset.repetir));
      ({ error } = await sb.from('turnos').insert([...fechas].map((f) => ({ ...base, fecha: f }))));
    } else {
      ({ error } = await sb.from('turnos').update({ ...base, fecha: fechaElegida }).eq('id', t.id));
    }
    if (error) { avisar(mensajeError(error), 'error'); return; }
    cerrar();
    avisar('Turno guardado.');
    cargarTurnos().catch((err) => avisar(mensajeError(err), 'error'));
  });

  el.querySelector('[data-borrar]')?.addEventListener('click', async () => {
    const { error } = await sb.from('turnos').delete().eq('id', t.id);
    if (error) { avisar(mensajeError(error), 'error'); return; }
    cerrar();
    avisar('Turno eliminado.');
    cargarTurnos().catch((err) => avisar(mensajeError(err), 'error'));
  });
}

$('t-anterior').addEventListener('click', () => { semana = sumarDias(semana, -7); cargarTurnos().catch((e) => avisar(mensajeError(e), 'error')); });
$('t-siguiente').addEventListener('click', () => { semana = sumarDias(semana, 7); cargarTurnos().catch((e) => avisar(mensajeError(e), 'error')); });
$('t-hoy').addEventListener('click', () => { semana = lunesDe(diaDe()); cargarTurnos().catch((e) => avisar(mensajeError(e), 'error')); });
$('t-copiar').addEventListener('click', async () => {
  const anterior = sumarDias(semana, -7);
  const { data, error } = await sb.from('turnos').select('*').gte('fecha', anterior).lte('fecha', sumarDias(anterior, 6));
  if (error) { avisar(mensajeError(error), 'error'); return; }
  if (!data.length) { avisar('La semana anterior no tiene turnos.', 'error'); return; }
  const clave = (x) => `${x.usuario_id}|${x.fecha}|${horaCorta(x.hora_inicio)}`;
  const existentes = new Set(turnosSemana.map(clave));
  const nuevos = data
    .map((x) => ({ usuario_id: x.usuario_id, fecha: sumarDias(x.fecha, 7), hora_inicio: x.hora_inicio, hora_fin: x.hora_fin, nota: x.nota }))
    .filter((x) => !existentes.has(clave(x)) && porId.get(x.usuario_id)?.activo);
  if (!nuevos.length) { avisar('Los turnos de la semana anterior ya están copiados.'); return; }
  if (!await confirmar(`Se copiarán ${nuevos.length} turnos de la semana anterior a esta semana.`, { titulo: 'Copiar turnos', boton: 'Copiar' })) return;
  const { error: e2 } = await sb.from('turnos').insert(nuevos);
  if (e2) { avisar(mensajeError(e2), 'error'); return; }
  avisar('Turnos copiados.');
  cargarTurnos().catch((e) => avisar(mensajeError(e), 'error'));
});

// =====================================================================
// EQUIPO
// =====================================================================

async function pintarEquipo() {
  $('e-tabla').innerHTML = trabajadores.length === 0
    ? '<tr><td colspan="7" class="vacio">No hay trabajadores.</td></tr>'
    : trabajadores.map((t) => `
      <tr>
        <td>${esc(t.nombre)}${t.telefono ? `<div class="campo-ayuda">${esc(t.telefono)}</div>` : ''}</td>
        <td>${esc(t.usuario)}</td>
        <td>${esc(t.puesto || '')}</td>
        <td>${t.rol === 'admin' ? 'Administrador' : 'Trabajador'}</td>
        <td class="num">${t.tarifa_hora != null ? esc(moneda(t.tarifa_hora)) : `<span class="subtitulo">General (${esc(moneda(ajustes.tarifa_general))})</span>`}</td>
        <td>${t.activo ? '<span class="estado estado-ok">Activo</span>' : '<span class="estado">Inactivo</span>'}</td>
        <td class="num"><button class="boton boton-pequeno" data-editar-t="${t.id}" type="button">Editar</button></td>
      </tr>`).join('');
  document.querySelectorAll('[data-editar-t]').forEach((b) => b.addEventListener('click', () => editarTrabajador(porId.get(b.dataset.editarT))));
}

$('e-nuevo').addEventListener('click', () => editarTrabajador(null));

function editarTrabajador(t) {
  const nuevo = !t;
  const { el, cerrar } = abrirModal({
    titulo: nuevo ? 'Nuevo trabajador' : `Editar: ${t.nombre}`,
    cuerpo: `
      <form id="form-trab" autocomplete="off">
        <div class="fila-campos">
          <div class="campo"><label for="e-nombre">Nombre y apellidos</label><input id="e-nombre" required maxlength="80" value="${esc(t?.nombre || '')}"></div>
          <div class="campo"><label for="e-usuario">Usuario de acceso</label><input id="e-usuario" ${nuevo ? 'required pattern="[a-z0-9._\\-]{3,30}"' : 'disabled'} autocapitalize="none" spellcheck="false" value="${esc(t?.usuario || '')}" placeholder="por ejemplo: lucia">
            ${nuevo ? '<span class="campo-ayuda">Minúsculas, números, punto o guion. No se puede cambiar después.</span>' : ''}</div>
        </div>
        ${nuevo ? `<div class="campo"><label for="e-pass">Contraseña inicial</label>
          <div class="botones" style="flex-wrap:nowrap"><input id="e-pass" required minlength="8" value="${generarPassword()}"><button class="boton" type="button" id="e-generar">Generar</button></div>
          <span class="campo-ayuda">El trabajador podrá cambiarla desde su panel.</span></div>` : ''}
        <div class="fila-campos">
          <div class="campo"><label for="e-puesto">Puesto</label><input id="e-puesto" maxlength="60" value="${esc(t?.puesto || '')}" placeholder="Cocina, sala, barra..."></div>
          <div class="campo"><label for="e-telefono">Teléfono</label><input id="e-telefono" type="tel" maxlength="30" value="${esc(t?.telefono || '')}"></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label for="e-tarifa">Tarifa por hora (EUR)</label><input id="e-tarifa" type="number" min="0" step="0.01" value="${t?.tarifa_hora ?? ''}" placeholder="General: ${esc(String(ajustes.tarifa_general))}">
            <span class="campo-ayuda">Déjalo vacío para usar la tarifa general.</span></div>
          <div class="campo"><label for="e-rol">Rol</label><select id="e-rol" ${t?.id === yo.id ? 'disabled' : ''}>
            <option value="trabajador" ${t?.rol !== 'admin' ? 'selected' : ''}>Trabajador</option>
            <option value="admin" ${t?.rol === 'admin' ? 'selected' : ''}>Administrador</option>
          </select></div>
        </div>
        ${nuevo ? '' : `
          <label class="casilla"><input type="checkbox" id="e-retro">Aplicar la tarifa también a fichajes anteriores desde</label>
          <div class="campo"><input id="e-retro-desde" type="date" value="${rangoPeriodo('mes').desde}" disabled></div>`}
      </form>`,
    pie: nuevo
      ? '<button class="boton" type="button" data-cerrar>Cancelar</button><button class="boton boton-primario" type="submit" form="form-trab">Crear cuenta</button>'
      : `<div class="botones" style="margin-right:auto">
          <button class="boton" type="button" data-pass>Cambiar contraseña</button>
          ${t.id === yo.id ? '' : `<button class="boton" type="button" data-activar>${t.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="boton boton-peligro" type="button" data-eliminar>Eliminar</button>`}
        </div>
        <button class="boton" type="button" data-cerrar>Cancelar</button>
        <button class="boton boton-primario" type="submit" form="form-trab">Guardar</button>`,
  });

  el.querySelector('#e-generar')?.addEventListener('click', () => { el.querySelector('#e-pass').value = generarPassword(); });
  el.querySelector('#e-retro')?.addEventListener('change', (e) => { el.querySelector('#e-retro-desde').disabled = !e.target.checked; });

  el.querySelector('#form-trab').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tarifaTxt = el.querySelector('#e-tarifa').value;
    const datos = {
      nombre: el.querySelector('#e-nombre').value.trim(),
      puesto: el.querySelector('#e-puesto').value.trim() || null,
      telefono: el.querySelector('#e-telefono').value.trim() || null,
      tarifa_hora: tarifaTxt === '' ? null : Number(tarifaTxt),
      rol: el.querySelector('#e-rol').value,
    };
    if (!datos.nombre) { avisar('El nombre es obligatorio.', 'error'); return; }
    const botonGuardar = el.querySelector('.modal-pie [type=submit]');
    botonGuardar.disabled = true;
    try {
      if (nuevo) {
        const usuario = el.querySelector('#e-usuario').value.trim().toLowerCase();
        const password = el.querySelector('#e-pass').value;
        await llamarAdminUsuarios({ accion: 'crear', usuario, password, ...datos });
        cerrar();
        await cargarBase();
        pintarEquipo();
        abrirModal({
          titulo: 'Cuenta creada',
          cuerpo: `<p style="margin-bottom:12px">Entrega estos datos a ${esc(datos.nombre)}. Por seguridad, la contraseña no se volverá a mostrar.</p>
            <div class="aviso-caja"><strong>Dirección:</strong> ${esc(location.origin + location.pathname.replace(/admin\.html$/, ''))}<br>
            <strong>Usuario:</strong> ${esc(usuario)}<br><strong>Contraseña:</strong> ${esc(password)}</div>`,
          pie: '<button class="boton boton-primario" type="button" data-cerrar>Hecho</button>',
        });
      } else {
        if (t.id === yo.id) delete datos.rol;
        const { error } = await sb.from('perfiles').update(datos).eq('id', t.id);
        if (error) throw error;
        if (el.querySelector('#e-retro').checked) {
          const desde = el.querySelector('#e-retro-desde').value;
          const { data: n, error: e2 } = await sb.rpc('aplicar_tarifa', { p_usuario: t.id, p_desde: desde });
          if (e2) throw e2;
          avisar(`Tarifa aplicada a ${n} fichajes.`);
        }
        cerrar();
        avisar('Datos guardados.');
        await cargarBase();
        pintarEquipo();
      }
    } catch (err) {
      avisar(mensajeError(err), 'error');
      botonGuardar.disabled = false;
    }
  });

  el.querySelector('[data-pass]')?.addEventListener('click', () => {
    const nueva = generarPassword();
    const { el: el2, cerrar: cerrar2 } = abrirModal({
      titulo: `Nueva contraseña para ${t.nombre}`,
      cuerpo: `<form id="form-np"><div class="campo"><label for="np">Nueva contraseña</label><input id="np" required minlength="8" value="${nueva}"></div></form>`,
      pie: '<button class="boton" type="button" data-cerrar>Cancelar</button><button class="boton boton-primario" type="submit" form="form-np">Guardar</button>',
    });
    el2.querySelector('#form-np').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await llamarAdminUsuarios({ accion: 'password', id: t.id, password: el2.querySelector('#np').value });
        cerrar2();
        avisar('Contraseña cambiada. Comunícasela al trabajador.');
      } catch (err) { avisar(mensajeError(err), 'error'); }
    });
  });

  el.querySelector('[data-activar]')?.addEventListener('click', async () => {
    const activar = !t.activo;
    if (!activar && !await confirmar(`${t.nombre} no podrá iniciar sesión ni fichar. Su historial se conserva.`, { titulo: 'Desactivar cuenta', boton: 'Desactivar', peligro: true })) return;
    try {
      await llamarAdminUsuarios({ accion: 'activar', id: t.id, activo: activar });
      cerrar();
      avisar(activar ? 'Cuenta activada.' : 'Cuenta desactivada.');
      await cargarBase();
      pintarEquipo();
    } catch (err) { avisar(mensajeError(err), 'error'); }
  });

  el.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    if (!await confirmar(`Se eliminará la cuenta de ${t.nombre} de forma permanente. Solo es posible si no tiene fichajes ni pagos.`, { titulo: 'Eliminar cuenta', boton: 'Eliminar', peligro: true })) return;
    try {
      await llamarAdminUsuarios({ accion: 'eliminar', id: t.id });
      cerrar();
      avisar('Cuenta eliminada.');
      await cargarBase();
      pintarEquipo();
    } catch (err) { avisar(mensajeError(err), 'error'); }
  });
}

// =====================================================================
// AJUSTES
// =====================================================================

let mapaAjustes = null;
let capaLocal = null;

function dibujarAjustesMapa() {
  const lat = Number($('a-lat').value);
  const lng = Number($('a-lng').value);
  const radio = Number($('a-radio').value) || 0;
  if (!mapaAjustes) {
    mapaAjustes = crearMapa($('a-mapa'));
    mapaAjustes.on('click', (e) => {
      $('a-lat').value = e.latlng.lat.toFixed(6);
      $('a-lng').value = e.latlng.lng.toFixed(6);
      dibujarAjustesMapa();
    });
  }
  if (capaLocal) capaLocal.remove();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const circulo = L.circle([lat, lng], { radius: radio, color: '#111', weight: 1, fillColor: '#f2c200', fillOpacity: 0.2 });
  capaLocal = L.layerGroup([
    circulo,
    L.circleMarker([lat, lng], { radius: 6, color: '#111', weight: 2, fillColor: '#f2c200', fillOpacity: 1 }),
  ]).addTo(mapaAjustes);
  setTimeout(() => { mapaAjustes.invalidateSize(); mapaAjustes.fitBounds(L.latLng(lat, lng).toBounds(Math.max(radio, 20) * 2), { padding: [20, 20] }); }, 50);
}

async function pintarAjustes() {
  $('a-tarifa').value = ajustes.tarifa_general;
  $('a-exigir').checked = ajustes.exigir_ubicacion;
  $('a-bloquear').checked = ajustes.bloquear_fuera_zona;
  $('a-margen').value = ajustes.margen_retraso_min;
  $('a-lat').value = ajustes.lat_local ?? '';
  $('a-lng').value = ajustes.lng_local ?? '';
  $('a-radio').value = ajustes.radio_metros;
  dibujarAjustesMapa();
}

['a-lat', 'a-lng', 'a-radio'].forEach((id) => $(id).addEventListener('change', dibujarAjustesMapa));

$('a-mi-ubicacion').addEventListener('click', async () => {
  const info = $('a-ubic-info');
  info.textContent = 'Obteniendo ubicación...';
  try {
    const u = await obtenerUbicacion({ objetivo: 10, maxMs: 20000, alProgresar: (m) => { info.textContent = `Precisión ${metros(m.precision)}...`; } });
    $('a-lat').value = u.lat.toFixed(6);
    $('a-lng').value = u.lng.toFixed(6);
    info.textContent = `Ubicación obtenida (precisión ${metros(u.precision)}). Recuerda guardar.`;
    dibujarAjustesMapa();
  } catch (err) {
    info.textContent = '';
    avisar(err.message, 'error');
  }
});

$('form-ajustes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = {
    tarifa_general: Number($('a-tarifa').value),
    exigir_ubicacion: $('a-exigir').checked,
    bloquear_fuera_zona: $('a-bloquear').checked,
    margen_retraso_min: Number($('a-margen').value),
    lat_local: Number($('a-lat').value),
    lng_local: Number($('a-lng').value),
    radio_metros: Math.round(Number($('a-radio').value)),
    actualizado: new Date().toISOString(),
  };
  const { error } = await sb.from('ajustes').update(datos).eq('id', 1);
  if (error) { avisar(mensajeError(error), 'error'); return; }
  avisar('Ajustes guardados.');
  await cargarBase();
});

$('a-aplicar-general').addEventListener('click', () => {
  const afectados = trabajadores.filter((t) => t.tarifa_hora == null);
  const { el, cerrar } = abrirModal({
    titulo: 'Aplicar tarifa general a fichajes anteriores',
    cuerpo: `<form id="form-apl">
      <p style="margin-bottom:12px">Se recalcularán con la tarifa general guardada (${esc(moneda(ajustes.tarifa_general))}/h) los fichajes de los trabajadores sin tarifa propia: ${afectados.length ? esc(afectados.map((t) => t.nombre).join(', ')) : 'ninguno'}.</p>
      <div class="campo"><label for="apl-desde">Desde el día</label><input id="apl-desde" type="date" required value="${rangoPeriodo('mes').desde}"></div>
      <p class="campo-ayuda">Guarda primero los ajustes si has cambiado la tarifa.</p></form>`,
    pie: '<button class="boton" type="button" data-cerrar>Cancelar</button><button class="boton boton-primario" type="submit" form="form-apl">Aplicar</button>',
  });
  el.querySelector('#form-apl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const desde = el.querySelector('#apl-desde').value;
    let total = 0;
    for (const t of afectados) {
      const { data, error } = await sb.rpc('aplicar_tarifa', { p_usuario: t.id, p_desde: desde });
      if (error) { avisar(mensajeError(error), 'error'); return; }
      total += data;
    }
    cerrar();
    avisar(`Tarifa aplicada a ${total} fichajes.`);
  });
});

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------

try {
  await cargarBase();
} catch (e) {
  avisar(mensajeError(e), 'error');
}
mostrarSeccion(location.hash.slice(1));
window.addEventListener('hashchange', () => mostrarSeccion(location.hash.slice(1)));

// Actualizacion automatica de la seccion "Hoy" cada minuto
setInterval(() => {
  if (!$('seccion-hoy').hidden && document.visibilityState === 'visible' && !document.querySelector('.modal-fondo')) {
    cargarHoy().catch(() => {});
  }
}, 60000);
