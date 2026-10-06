import {
  api, resultado, requerirSesion, cerrarSesion, moneda, hora, horasTexto, horaCorta, metros, esc,
  diaDe, sumarDias, instanteMadrid, rangoPeriodo, fechaLarga, fechaCortaDia,
  horasFichaje, agruparPorDia, duracionTurno, obtenerUbicacion, descripcionDispositivo,
  avisar, mensajeError, abrirModal, confirmar, botonActualizar, TIPOS_MOVIMIENTO,
} from './comun.js';

const perfil = await requerirSesion();
const $ = (id) => document.getElementById(id);

let ajustes = null;
let abierto = null;       // fichaje en curso (si existe)
let turnoHoy = null;

$('nombre-usuario').textContent = perfil.nombre;
$('enlace-admin').hidden = perfil.rol !== 'admin';
$('salir').addEventListener('click', cerrarSesion);
$('datos-cuenta').textContent = `Usuario: ${perfil.usuario}${perfil.puesto ? ` · Puesto: ${perfil.puesto}` : ''}`;

// ---------------------------------------------------------------------
// Reloj y estado de fichaje
// ---------------------------------------------------------------------

function pintarReloj() {
  const ahora = new Date();
  $('reloj').textContent = hora(ahora);
  const f = fechaLarga(ahora);
  $('fecha-hoy').textContent = f.charAt(0).toUpperCase() + f.slice(1);
  if (abierto) {
    $('contador').textContent = `Llevas ${horasTexto(horasFichaje(abierto, ahora))} trabajando`;
  }
}
setInterval(pintarReloj, 1000);
pintarReloj();

function pintarEstado() {
  const boton = $('boton-fichar');
  boton.disabled = false;
  if (abierto) {
    $('estado-fichaje').innerHTML = `<span class="estado estado-ok"><span class="punto punto-vivo"></span>Trabajando desde las ${esc(hora(abierto.entrada))}</span>`;
    boton.textContent = 'Fichar salida';
    boton.className = 'boton boton-primario fichar-boton';
  } else {
    $('estado-fichaje').innerHTML = '<span class="estado">Fuera de turno</span>';
    boton.textContent = 'Fichar entrada';
    boton.className = 'boton boton-acento fichar-boton';
    if (turnoHoy) {
      $('contador').textContent = `Tu turno de hoy: ${horaCorta(turnoHoy.hora_inicio)} a ${horaCorta(turnoHoy.hora_fin)}`;
    } else {
      $('contador').textContent = '';
    }
  }
  pintarReloj();
}

async function cargarEstado() {
  const [{ data: aj }, { data: abiertos }] = await Promise.all([
    resultado(api('ajustes')),
    resultado(api('fichajes', { propios: true, abiertos: true, limite: 1 })),
  ]);
  ajustes = aj;
  abierto = abiertos && abiertos[0] ? abiertos[0] : null;
  pintarEstado();
}

$('boton-fichar').addEventListener('click', async () => {
  const esSalida = Boolean(abierto);
  if (esSalida) {
    const ok = await confirmar(`Vas a registrar tu salida. Llevas ${horasTexto(horasFichaje(abierto))} trabajando.`, {
      titulo: 'Fichar salida', boton: 'Fichar salida',
    });
    if (!ok) return;
  }

  const boton = $('boton-fichar');
  const info = $('info-ubicacion');
  boton.disabled = true;
  boton.textContent = 'Obteniendo ubicación...';
  info.textContent = 'Buscando señal GPS. Mantén el móvil quieto unos segundos.';

  let ubic = null;
  try {
    ubic = await obtenerUbicacion({
      alProgresar: (m) => { info.textContent = `Precisión actual: ${metros(m.precision)}. Afinando...`; },
    });
  } catch (err) {
    if (ajustes?.exigir_ubicacion !== false) {
      info.textContent = '';
      avisar(err.message, 'error');
      pintarEstado();
      return;
    }
  }

  boton.textContent = 'Registrando...';
  const parametros = {
    tipo: esSalida ? 'salida' : 'entrada',
    lat: ubic?.lat ?? null,
    lng: ubic?.lng ?? null,
    precision: ubic ? Math.round(ubic.precision) : null,
    dispositivo: descripcionDispositivo(),
  };
  const { data, error } = await resultado(api('fichar', parametros));
  if (error) {
    info.textContent = '';
    avisar(mensajeError(error), 'error');
    await cargarEstado();
    return;
  }

  const distancia = esSalida ? data.salida_distancia : data.entrada_distancia;
  const fuera = ajustes && distancia != null && distancia > ajustes.radio_metros + (parametros.precision || 0);
  info.textContent = ubic
    ? `Ubicación registrada (precisión ${metros(ubic.precision)}${distancia != null ? `, a ${metros(distancia)} del local` : ''})${fuera ? '. Atención: estás fuera de la zona del local.' : ''}`
    : 'Fichaje registrado sin ubicación.';
  avisar(esSalida
    ? `Salida registrada a las ${hora(data.salida)}. Total: ${horasTexto(horasFichaje(data))}.`
    : `Entrada registrada a las ${hora(data.entrada)}.`);
  abierto = esSalida ? null : data;
  if (esSalida) $('contador').textContent = '';
  pintarEstado();
  cargarSaldo();
  cargarHoras();
});

// ---------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------

async function cargarSaldo() {
  const { data, error } = await resultado(api('saldos', { propios: true }));
  if (error) { avisar(mensajeError(error), 'error'); return; }
  const s = (data || []).find((x) => x.usuario_id === perfil.id) || { horas: 0, devengado: 0, extras: 0, pagado: 0, saldo: 0 };
  $('saldo').textContent = moneda(s.saldo);
  $('saldo-horas').textContent = horasTexto(s.horas).replace(' min', '');
  $('saldo-generado').textContent = moneda(Number(s.devengado) + Number(s.extras));
  $('saldo-cobrado').textContent = moneda(s.pagado);
  const tarifa = perfil.tarifa_hora ?? ajustes?.tarifa_general;
  $('saldo-tarifa').textContent = tarifa != null ? `Tu tarifa actual: ${moneda(tarifa)} por hora.` : '';
}

// ---------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------

async function cargarTurnos() {
  const hoy = diaDe();
  const { data, error } = await resultado(api('turnos', { propios: true, desde: hoy, hasta: sumarDias(hoy, 28) }));
  const ul = $('lista-turnos');
  if (error) { ul.innerHTML = `<li class="vacio">${esc(mensajeError(error))}</li>`; return; }

  turnoHoy = (data || []).find((t) => t.fecha === hoy && instanteMadrid(t.fecha, t.hora_fin) > new Date()) || null;
  if (!abierto) pintarEstado();

  if (!data || data.length === 0) {
    ul.innerHTML = '<li class="vacio">No tienes turnos asignados próximamente.</li>';
    return;
  }
  ul.innerHTML = data.map((t, i) => `
    <li class="${i === 0 ? 'turno-proximo' : ''}">
      <div>
        <div class="principal">${t.fecha === hoy ? 'Hoy' : t.fecha === sumarDias(hoy, 1) ? 'Mañana' : esc(fechaCortaDia(t.fecha))}</div>
        ${t.nota ? `<div class="secundario">${esc(t.nota)}</div>` : ''}
      </div>
      <div class="num">
        <div class="principal">${esc(horaCorta(t.hora_inicio))} - ${esc(horaCorta(t.hora_fin))}</div>
        <div class="secundario">${esc(horasTexto(duracionTurno(t)))}</div>
      </div>
    </li>`).join('');
}

// ---------------------------------------------------------------------
// Horas por dia
// ---------------------------------------------------------------------

async function cargarHoras() {
  const { desde, hasta } = rangoPeriodo($('periodo').value);
  const { data, error } = await resultado(api('fichajes', {
    propios: true,
    desde: instanteMadrid(desde).toISOString(),
    hasta: instanteMadrid(sumarDias(hasta, 1)).toISOString(),
  }));
  const tbody = $('tabla-dias');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="vacio">${esc(mensajeError(error))}</td></tr>`; return; }

  const dias = agruparPorDia(data || []);
  const totalHoras = dias.reduce((s, d) => s + d.horas, 0);
  const totalImporte = dias.reduce((s, d) => s + d.importe, 0);
  $('periodo-horas').textContent = horasTexto(totalHoras).replace(' min', '');
  $('periodo-importe').textContent = moneda(totalImporte);
  $('periodo-dias').textContent = String(dias.length);

  if (dias.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="vacio">No hay fichajes en este periodo.</td></tr>';
    return;
  }
  tbody.innerHTML = dias.map((d) => `
    <tr>
      <td class="nowrap">${esc(fechaCortaDia(d.dia))}</td>
      <td>${d.fichajes.map((f) => `${esc(hora(f.entrada))} - ${f.salida ? esc(hora(f.salida)) : '<span class="estado estado-ok">en curso</span>'}`).join('<br>')}</td>
      <td class="num">${esc(horasTexto(d.horas))}</td>
      <td class="num">${esc(moneda(d.importe))}</td>
    </tr>`).join('');
}

$('periodo').addEventListener('change', cargarHoras);

// ---------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------

async function cargarMovimientos() {
  const { data, error } = await resultado(api('movimientos', { propios: true, limite: 50 }));
  const tbody = $('tabla-movimientos');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="vacio">${esc(mensajeError(error))}</td></tr>`; return; }
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="vacio">Todavía no hay pagos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map((m) => {
    const t = TIPOS_MOVIMIENTO[m.tipo];
    return `<tr>
      <td class="nowrap">${esc(fechaCortaDia(m.fecha))}</td>
      <td>${esc(t.nombre)}</td>
      <td>${esc(m.concepto || '')}</td>
      <td class="num">${t.signo > 0 ? '+' : ''}${esc(moneda(m.importe))}</td>
    </tr>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Cambio de contrasena
// ---------------------------------------------------------------------

$('cambiar-password').addEventListener('click', () => {
  const { el, cerrar } = abrirModal({
    titulo: 'Cambiar contraseña',
    cuerpo: `
      <form id="form-password">
        <div class="campo"><label for="p0">Contraseña actual</label><input id="p0" type="password" autocomplete="current-password" required></div>
        <div class="campo"><label for="p1">Nueva contraseña</label><input id="p1" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="campo"><label for="p2">Repite la contraseña</label><input id="p2" type="password" autocomplete="new-password" minlength="8" required></div>
        <p class="campo-ayuda">Mínimo 8 caracteres.</p>
      </form>`,
    pie: '<button class="boton" data-cerrar type="button">Cancelar</button><button class="boton boton-primario" type="submit" form="form-password">Guardar</button>',
  });
  el.querySelector('#form-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = el.querySelector('#p1').value;
    const p2 = el.querySelector('#p2').value;
    if (p1.length < 8) { avisar('La contraseña debe tener al menos 8 caracteres.', 'error'); return; }
    if (p1 !== p2) { avisar('Las contraseñas no coinciden.', 'error'); return; }
    const { error } = await resultado(api('cambiar_password', { actual: el.querySelector('#p0').value, nueva: p1 }));
    if (error) { avisar(mensajeError(error), 'error'); return; }
    cerrar();
    avisar('Contraseña actualizada.');
  });
});

async function actualizarTodo() {
  await cargarEstado();
  await Promise.all([cargarSaldo(), cargarTurnos(), cargarHoras(), cargarMovimientos()]);
}

botonActualizar($('actualizar'), actualizarTodo);

// Refresca al volver a la aplicacion (por ejemplo, tras tenerla en segundo plano)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { cargarEstado(); cargarSaldo(); }
});

await cargarEstado();
cargarSaldo();
cargarTurnos();
cargarHoras();
cargarMovimientos();
