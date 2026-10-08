<?php
// API del area de equipo. Todas las peticiones: POST api.php?accion=... con cuerpo JSON.
declare(strict_types=1);

require __DIR__ . '/lib.php';
require __DIR__ . '/push.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        throw new ErrorUsuario('Metodo no permitido', 405);
    }
    // Proteccion CSRF: un formulario de otra web no puede enviar esta cabecera
    if (($_SERVER['HTTP_X_EQUIPO'] ?? '') !== '1') {
        throw new ErrorUsuario('Peticion no valida', 400);
    }
    $entrada = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($entrada)) {
        $entrada = [];
    }
    // La accion llega en la URL y tambien en el cuerpo (por si un proxy no reenvia la URL completa)
    $accion = (string) ($_GET['accion'] ?? ($entrada['accion'] ?? ''));
    if (!preg_match('/^[a-z_]+$/', $accion) || !function_exists("accion_$accion")) {
        throw new ErrorUsuario('Accion desconocida', 404);
    }
    responder(("accion_$accion")($entrada));
} catch (ErrorUsuario $e) {
    responder(['error' => $e->getMessage()], $e->estado);
} catch (Throwable $e) {
    error_log('[equipo] ' . $e->getMessage() . ' en ' . $e->getFile() . ':' . $e->getLine());
    $msg = $e instanceof PDOException && str_contains($e->getMessage(), 'SQLSTATE[HY000] [')
        ? 'No se puede conectar con la base de datos. Revisa api/config.php.'
        : 'Error interno del servidor';
    responder(['error' => $msg], 500);
}

// =====================================================================
// Sesion
// =====================================================================

function accion_login(array $e): array
{
    $usuario = strtolower(trim((string) ($e['usuario'] ?? '')));
    $password = (string) ($e['password'] ?? '');
    if ($usuario === '' || $password === '') {
        throw new ErrorUsuario('Introduce tu usuario y contraseña.');
    }
    $usuario = mb_substr($usuario, 0, 60);
    $hace15 = gmdate('Y-m-d H:i:s', time() - 900);
    $porUsuario = (int) fila('SELECT COUNT(*) n FROM equipo_intentos_login WHERE usuario = ? AND momento > ?', [$usuario, $hace15])['n'];
    $porIp = (int) fila('SELECT COUNT(*) n FROM equipo_intentos_login WHERE ip = ? AND momento > ?', [ip_cliente(), $hace15])['n'];
    if ($porUsuario >= MAX_INTENTOS_USUARIO || $porIp >= MAX_INTENTOS_IP) {
        throw new ErrorUsuario('Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.', 429);
    }

    $p = fila('SELECT * FROM equipo_perfiles WHERE usuario = ?', [$usuario]);
    if ($p === null || !password_verify($password, $p['password_hash'])) {
        consulta('INSERT INTO equipo_intentos_login (usuario, ip, momento) VALUES (?, ?, ?)', [$usuario, ip_cliente(), ahora()]);
        throw new ErrorUsuario('Usuario o contraseña incorrectos.', 401);
    }
    if (!$p['activo']) {
        throw new ErrorUsuario('Esta cuenta está desactivada.', 403);
    }
    if (password_needs_rehash($p['password_hash'], PASSWORD_DEFAULT)) {
        consulta('UPDATE equipo_perfiles SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $p['id']]);
    }
    consulta('DELETE FROM equipo_intentos_login WHERE usuario = ?', [$usuario]);
    crear_sesion((int) $p['id']);
    return normalizar($p);
}

function accion_logout(array $e): array
{
    cerrar_sesion();
    return ['ok' => true];
}

function accion_sesion(array $e): array
{
    return normalizar(requerir_sesion());
}

function accion_cambiar_password(array $e): array
{
    $u = requerir_sesion();
    if (!password_verify((string) ($e['actual'] ?? ''), $u['password_hash'])) {
        throw new ErrorUsuario('La contraseña actual no es correcta.');
    }
    $nueva = validar_password($e['nueva'] ?? null);
    consulta('UPDATE equipo_perfiles SET password_hash = ? WHERE id = ?', [password_hash($nueva, PASSWORD_DEFAULT), $u['id']]);
    // Cierra la sesion en el resto de dispositivos
    $actual = hash('sha256', (string) ($_COOKIE[COOKIE_SESION] ?? ''));
    consulta('DELETE FROM equipo_sesiones WHERE usuario_id = ? AND token_hash <> ?', [$u['id'], $actual]);
    return ['ok' => true];
}

// =====================================================================
// Ajustes
// =====================================================================

function obtener_ajustes(): array
{
    return fila('SELECT * FROM equipo_ajustes WHERE id = 1');
}

function accion_ajustes(array $e): array
{
    requerir_sesion();
    return normalizar(obtener_ajustes());
}

function accion_ajustes_guardar(array $e): array
{
    requerir_admin();
    $tarifa = numero_o_null($e['tarifa_general'] ?? null);
    $lat = numero_o_null($e['lat_local'] ?? null);
    $lng = numero_o_null($e['lng_local'] ?? null);
    $radio = (int) ($e['radio_metros'] ?? 0);
    $margen = (int) ($e['margen_retraso_min'] ?? 0);
    if ($tarifa === null || $tarifa < 0) throw new ErrorUsuario('La tarifa general no es válida.');
    if ($lat === null || $lat < -90 || $lat > 90 || $lng === null || $lng < -180 || $lng > 180) throw new ErrorUsuario('Las coordenadas no son válidas.');
    if ($radio < 10) throw new ErrorUsuario('El radio debe ser de al menos 10 metros.');
    if ($margen < 0) throw new ErrorUsuario('El margen de retraso no es válido.');
    consulta(
        'UPDATE equipo_ajustes SET tarifa_general = ?, lat_local = ?, lng_local = ?, radio_metros = ?, exigir_ubicacion = ?,
                bloquear_fuera_zona = ?, margen_retraso_min = ?, actualizado = ? WHERE id = 1',
        [$tarifa, $lat, $lng, $radio, empty($e['exigir_ubicacion']) ? 0 : 1, empty($e['bloquear_fuera_zona']) ? 0 : 1, $margen, ahora()]
    );
    return normalizar(obtener_ajustes());
}

// =====================================================================
// Fichar (la hora la pone siempre el servidor)
// =====================================================================

function accion_fichar(array $e): array
{
    $u = requerir_sesion();
    $tipo = $e['tipo'] ?? '';
    if ($tipo !== 'entrada' && $tipo !== 'salida') {
        throw new ErrorUsuario('Tipo de fichaje no válido');
    }
    $lat = numero_o_null($e['lat'] ?? null);
    $lng = numero_o_null($e['lng'] ?? null);
    $precision = numero_o_null($e['precision'] ?? null);
    if (($lat !== null && ($lat < -90 || $lat > 90)) || ($lng !== null && ($lng < -180 || $lng > 180))) {
        throw new ErrorUsuario('Ubicación no válida');
    }
    if ($lat === null || $lng === null) {
        $lat = $lng = $precision = null;
    }
    $dispositivo = texto_o_null($e['dispositivo'] ?? null, 300);
    $aj = obtener_ajustes();

    if ($aj['exigir_ubicacion'] && $lat === null) {
        throw new ErrorUsuario('Es necesario compartir la ubicación para fichar.');
    }
    $dist = distancia_metros($lat, $lng, $aj['lat_local'] !== null ? (float) $aj['lat_local'] : null, $aj['lng_local'] !== null ? (float) $aj['lng_local'] : null);
    if ($aj['bloquear_fuera_zona'] && $dist !== null && $dist > (float) $aj['radio_metros'] + (float) ($precision ?? 0)) {
        throw new ErrorUsuario('Estás fuera del local (a ' . round($dist) . ' m). No se puede fichar desde aquí.');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Bloquea la fila del trabajador para evitar dobles fichajes simultaneos
        $p = fila('SELECT * FROM equipo_perfiles WHERE id = ? FOR UPDATE', [$u['id']]);
        $abierto = fila('SELECT id FROM equipo_fichajes WHERE usuario_id = ? AND salida IS NULL ORDER BY entrada DESC LIMIT 1', [$u['id']]);
        if ($tipo === 'entrada') {
            if ($abierto !== null) {
                throw new ErrorUsuario('Ya tienes una entrada abierta. Ficha la salida primero.');
            }
            $tarifa = $p['tarifa_hora'] ?? $aj['tarifa_general'];
            consulta(
                'INSERT INTO equipo_fichajes (usuario_id, entrada, tarifa, entrada_lat, entrada_lng, entrada_precision, entrada_distancia, entrada_dispositivo, creado)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$u['id'], ahora(), $tarifa, $lat, $lng, $precision, $dist, $dispositivo, ahora()]
            );
            $id = (int) $pdo->lastInsertId();
        } else {
            if ($abierto === null) {
                throw new ErrorUsuario('No tienes ninguna entrada abierta.');
            }
            $id = (int) $abierto['id'];
            consulta(
                'UPDATE equipo_fichajes SET salida = GREATEST(?, entrada + INTERVAL 1 SECOND), salida_lat = ?, salida_lng = ?, salida_precision = ?,
                        salida_distancia = ?, salida_dispositivo = ? WHERE id = ?',
                [ahora(), $lat, $lng, $precision, $dist, $dispositivo, $id]
            );
        }
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
    $f = fila('SELECT * FROM equipo_fichajes WHERE id = ?', [$id]);
    $radio = (float) $aj['radio_metros'];
    despues_de_responder(fn() => avisar_fichaje($u, $f, $tipo, $radio));
    return normalizar($f);
}

function hora_madrid(string $utc): string
{
    return (new DateTimeImmutable($utc, new DateTimeZone('UTC')))->setTimezone(new DateTimeZone(ZONA))->format('H:i');
}

function texto_distancia(?float $dist, ?float $precision, float $radio): string
{
    if ($dist === null) {
        return 'Sin ubicación';
    }
    if ($dist > $radio + ($precision ?? 0)) {
        return 'Fuera del local, a ' . ($dist >= 1000 ? number_format($dist / 1000, 1, ',', '') . ' km' : round($dist) . ' m');
    }
    return 'En el local';
}

function avisar_fichaje(array $u, array $f, string $tipo, float $radio): void
{
    if ($tipo === 'entrada') {
        $titulo = "{$u['nombre']} ha fichado la entrada";
        $cuerpo = hora_madrid($f['entrada']) . ' · ' . texto_distancia(
            $f['entrada_distancia'] !== null ? (float) $f['entrada_distancia'] : null,
            $f['entrada_precision'] !== null ? (float) $f['entrada_precision'] : null, $radio);
    } else {
        $minutos = intdiv(strtotime($f['salida'] . ' UTC') - strtotime($f['entrada'] . ' UTC'), 60);
        $titulo = "{$u['nombre']} ha fichado la salida";
        $cuerpo = hora_madrid($f['salida']) . ' · ' . intdiv($minutos, 60) . ' h ' . str_pad((string) ($minutos % 60), 2, '0', STR_PAD_LEFT) . ' min trabajadas';
        $lugar = texto_distancia(
            $f['salida_distancia'] !== null ? (float) $f['salida_distancia'] : null,
            $f['salida_precision'] !== null ? (float) $f['salida_precision'] : null, $radio);
        if ($lugar !== 'En el local') {
            $cuerpo .= ' · ' . $lugar;
        }
    }
    avisar_administradores($titulo, $cuerpo, (int) $u['id']);
}

// =====================================================================
// Avisos push para administradores
// =====================================================================

function accion_push_clave(array $e): array
{
    requerir_admin();
    return ['clave' => claves_vapid()['publica']];
}

function accion_push_suscribir(array $e): array
{
    $u = requerir_admin();
    $endpoint = (string) ($e['endpoint'] ?? '');
    $p256dh = (string) ($e['keys']['p256dh'] ?? '');
    $auth = (string) ($e['keys']['auth'] ?? '');
    if (!preg_match('#^https://[^\s]{10,1000}$#', $endpoint) || $p256dh === '' || $auth === '') {
        throw new ErrorUsuario('Suscripción no válida.');
    }
    clave_desde_punto(de_b64url($p256dh));   // valida la clave
    if (strlen(de_b64url($auth)) !== 16) {
        throw new ErrorUsuario('Suscripción no válida.');
    }
    asegurar_tablas_push();
    consulta(
        'INSERT INTO equipo_suscripciones (usuario_id, endpoint, endpoint_hash, p256dh, auth, dispositivo, creado) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), p256dh = VALUES(p256dh), auth = VALUES(auth), dispositivo = VALUES(dispositivo)',
        [$u['id'], $endpoint, hash('sha256', $endpoint), $p256dh, $auth, texto_o_null($e['dispositivo'] ?? null, 120), ahora()]
    );
    return ['ok' => true];
}

function accion_push_baja(array $e): array
{
    $u = requerir_sesion();
    asegurar_tablas_push();
    consulta('DELETE FROM equipo_suscripciones WHERE endpoint_hash = ? AND usuario_id = ?', [hash('sha256', (string) ($e['endpoint'] ?? '')), $u['id']]);
    return ['ok' => true];
}

function accion_push_probar(array $e): array
{
    $u = requerir_admin();
    asegurar_tablas_push();
    $subs = filas('SELECT * FROM equipo_suscripciones WHERE usuario_id = ?', [$u['id']]);
    if (!$subs) {
        throw new ErrorUsuario('Este usuario no tiene ningún dispositivo con avisos activados.');
    }
    $n = enviar_push($subs, ['titulo' => 'Aviso de prueba', 'cuerpo' => 'Los avisos de fichajes funcionan en este dispositivo.', 'url' => 'admin.html#hoy']);
    if ($n === 0) {
        throw new ErrorUsuario('No se pudo entregar el aviso. Desactiva y vuelve a activar los avisos en este dispositivo.');
    }
    return ['enviados' => $n];
}

// =====================================================================
// Consultas (el trabajador solo recibe sus propios datos)
// =====================================================================

function filtro_usuario(array $u, array $e, array &$cond, array &$params, string $col = 'usuario_id'): void
{
    // "propios": el panel personal pide solo los datos de quien ha iniciado sesion,
    // tambien cuando es administrador
    if (!es_admin($u) || !empty($e['propios'])) {
        $cond[] = "$col = ?";
        $params[] = $u['id'];
    } elseif (!empty($e['usuario_id'])) {
        $cond[] = "$col = ?";
        $params[] = (int) $e['usuario_id'];
    }
}

function accion_fichajes(array $e): array
{
    $u = requerir_sesion();
    $cond = [];
    $params = [];
    filtro_usuario($u, $e, $cond, $params);
    if (!empty($e['desde'])) { $cond[] = 'entrada >= ?'; $params[] = de_iso($e['desde'], 'desde'); }
    if (!empty($e['hasta'])) { $cond[] = 'entrada < ?'; $params[] = de_iso($e['hasta'], 'hasta'); }
    if (!empty($e['abiertos'])) { $cond[] = 'salida IS NULL'; }
    $limite = min(max((int) ($e['limite'] ?? 20000), 1), 20000);
    $sql = 'SELECT * FROM equipo_fichajes' . ($cond ? ' WHERE ' . implode(' AND ', $cond) : '') . " ORDER BY entrada DESC LIMIT $limite";
    return normalizar_todas(filas($sql, $params));
}

function accion_turnos(array $e): array
{
    $u = requerir_sesion();
    $cond = [];
    $params = [];
    filtro_usuario($u, $e, $cond, $params);
    if (!empty($e['desde'])) { $cond[] = 'fecha >= ?'; $params[] = validar_dia($e['desde'], 'desde'); }
    if (!empty($e['hasta'])) { $cond[] = 'fecha <= ?'; $params[] = validar_dia($e['hasta'], 'hasta'); }
    $sql = 'SELECT * FROM equipo_turnos' . ($cond ? ' WHERE ' . implode(' AND ', $cond) : '') . ' ORDER BY fecha, hora_inicio LIMIT 5000';
    return normalizar_todas(filas($sql, $params));
}

function accion_movimientos(array $e): array
{
    $u = requerir_sesion();
    $cond = [];
    $params = [];
    filtro_usuario($u, $e, $cond, $params);
    $limite = min(max((int) ($e['limite'] ?? 5000), 1), 5000);
    $sql = 'SELECT * FROM equipo_movimientos' . ($cond ? ' WHERE ' . implode(' AND ', $cond) : '') . " ORDER BY fecha DESC, id DESC LIMIT $limite";
    return normalizar_todas(filas($sql, $params));
}

// Lo que se debe a cada trabajador: horas cerradas x tarifa + extras - pagos
function accion_saldos(array $e): array
{
    $u = requerir_sesion();
    $cond = [];
    $params = [];
    filtro_usuario($u, ['propios' => !empty($e['propios'])], $cond, $params, 'p.id');
    $sql = "SELECT p.id AS usuario_id,
                   ROUND(COALESCE(f.horas, 0), 2) AS horas,
                   COALESCE(f.devengado, 0) AS devengado,
                   COALESCE(m.extras, 0) AS extras,
                   COALESCE(m.pagado, 0) AS pagado,
                   COALESCE(f.devengado, 0) + COALESCE(m.extras, 0) - COALESCE(m.pagado, 0) AS saldo
              FROM equipo_perfiles p
              LEFT JOIN (
                SELECT usuario_id,
                       SUM(TIMESTAMPDIFF(SECOND, entrada, salida)) / 3600 AS horas,
                       SUM(ROUND(TIMESTAMPDIFF(SECOND, entrada, salida) / 3600 * tarifa, 2)) AS devengado
                  FROM equipo_fichajes WHERE salida IS NOT NULL GROUP BY usuario_id
              ) f ON f.usuario_id = p.id
              LEFT JOIN (
                SELECT usuario_id,
                       SUM(CASE tipo WHEN 'bonificacion' THEN importe WHEN 'descuento' THEN -importe ELSE 0 END) AS extras,
                       SUM(CASE WHEN tipo IN ('pago', 'anticipo') THEN importe ELSE 0 END) AS pagado
                  FROM equipo_movimientos GROUP BY usuario_id
              ) m ON m.usuario_id = p.id"
        . ($cond ? ' WHERE ' . implode(' AND ', $cond) : '');
    return normalizar_todas(filas($sql, $params));
}

// =====================================================================
// Administracion: fichajes
// =====================================================================

function accion_fichaje_guardar(array $e): array
{
    $admin = requerir_admin();
    $entrada = de_iso($e['entrada'] ?? null, 'entrada');
    $salida = de_iso($e['salida'] ?? null, 'salida');
    $tarifa = numero_o_null($e['tarifa'] ?? null);
    $nota = texto_o_null($e['nota'] ?? null, 300);
    if ($entrada === null) throw new ErrorUsuario('Indica la hora de entrada.');
    if ($salida !== null && $salida <= $entrada) throw new ErrorUsuario('La salida debe ser posterior a la entrada.');
    if ($tarifa === null || $tarifa < 0) throw new ErrorUsuario('La tarifa no es válida.');

    $id = !empty($e['id']) ? (int) $e['id'] : null;
    if ($id === null) {
        $usuarioId = (int) ($e['usuario_id'] ?? 0);
        if (fila('SELECT id FROM equipo_perfiles WHERE id = ?', [$usuarioId]) === null) throw new ErrorUsuario('Trabajador no válido.');
    } else {
        $actual = fila('SELECT * FROM equipo_fichajes WHERE id = ?', [$id]);
        if ($actual === null) throw new ErrorUsuario('El fichaje no existe.', 404);
        $usuarioId = (int) $actual['usuario_id'];
    }
    if ($salida === null) {
        $otro = fila('SELECT id FROM equipo_fichajes WHERE usuario_id = ? AND salida IS NULL AND id <> ?', [$usuarioId, $id ?? 0]);
        if ($otro !== null) throw new ErrorUsuario('Este trabajador ya tiene un fichaje abierto. Indica la hora de salida.');
    }

    if ($id === null) {
        consulta(
            'INSERT INTO equipo_fichajes (usuario_id, entrada, salida, tarifa, nota, manual, editado_por, editado_en, creado) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
            [$usuarioId, $entrada, $salida, $tarifa, $nota, $admin['id'], ahora(), ahora()]
        );
        $id = (int) db()->lastInsertId();
    } else {
        $cambiaDatos = $actual['entrada'] !== $entrada || $actual['salida'] !== $salida || (float) $actual['tarifa'] !== $tarifa;
        consulta(
            'UPDATE equipo_fichajes SET entrada = ?, salida = ?, tarifa = ?, nota = ?'
                . ($cambiaDatos ? ', editado_por = ?, editado_en = ?' : '') . ' WHERE id = ?',
            $cambiaDatos ? [$entrada, $salida, $tarifa, $nota, $admin['id'], ahora(), $id] : [$entrada, $salida, $tarifa, $nota, $id]
        );
    }
    return normalizar(fila('SELECT * FROM equipo_fichajes WHERE id = ?', [$id]));
}

function accion_fichaje_eliminar(array $e): array
{
    requerir_admin();
    consulta('DELETE FROM equipo_fichajes WHERE id = ?', [(int) ($e['id'] ?? 0)]);
    return ['ok' => true];
}

function accion_aplicar_tarifa(array $e): array
{
    requerir_admin();
    $usuarioId = (int) ($e['usuario_id'] ?? 0);
    $desde = inicio_dia_madrid(validar_dia($e['desde'] ?? null, 'desde'));
    $p = fila('SELECT tarifa_hora FROM equipo_perfiles WHERE id = ?', [$usuarioId]);
    if ($p === null) throw new ErrorUsuario('Trabajador no válido.');
    $tarifa = $p['tarifa_hora'] ?? obtener_ajustes()['tarifa_general'];
    $n = consulta('UPDATE equipo_fichajes SET tarifa = ? WHERE usuario_id = ? AND entrada >= ? AND tarifa <> ?',
        [$tarifa, $usuarioId, $desde, $tarifa])->rowCount();
    return ['actualizados' => $n];
}

// =====================================================================
// Administracion: pagos y movimientos
// =====================================================================

function accion_movimiento_crear(array $e): array
{
    $admin = requerir_admin();
    $usuarioId = (int) ($e['usuario_id'] ?? 0);
    $tipo = (string) ($e['tipo'] ?? '');
    $importe = numero_o_null($e['importe'] ?? null);
    if (fila('SELECT id FROM equipo_perfiles WHERE id = ?', [$usuarioId]) === null) throw new ErrorUsuario('Trabajador no válido.');
    if (!in_array($tipo, ['pago', 'anticipo', 'bonificacion', 'descuento'], true)) throw new ErrorUsuario('Tipo no válido.');
    if ($importe === null || $importe <= 0) throw new ErrorUsuario('El importe debe ser mayor que cero.');
    consulta(
        'INSERT INTO equipo_movimientos (usuario_id, fecha, tipo, importe, concepto, creado_por, creado) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$usuarioId, validar_dia($e['fecha'] ?? null, 'fecha'), $tipo, round($importe, 2), texto_o_null($e['concepto'] ?? null, 200), $admin['id'], ahora()]
    );
    return ['ok' => true];
}

function accion_movimiento_eliminar(array $e): array
{
    requerir_admin();
    consulta('DELETE FROM equipo_movimientos WHERE id = ?', [(int) ($e['id'] ?? 0)]);
    return ['ok' => true];
}

// =====================================================================
// Administracion: turnos
// =====================================================================

function datos_turno(array $t): array
{
    $usuarioId = (int) ($t['usuario_id'] ?? 0);
    if (fila('SELECT id FROM equipo_perfiles WHERE id = ?', [$usuarioId]) === null) throw new ErrorUsuario('Trabajador no válido.');
    $inicio = validar_hora($t['hora_inicio'] ?? null, 'inicio');
    $fin = validar_hora($t['hora_fin'] ?? null, 'fin');
    if ($inicio === $fin) throw new ErrorUsuario('La hora de inicio y la de fin no pueden ser iguales.');
    return [$usuarioId, validar_dia($t['fecha'] ?? null, 'fecha'), $inicio, $fin, texto_o_null($t['nota'] ?? null, 120)];
}

function accion_turnos_crear(array $e): array
{
    requerir_admin();
    $lista = $e['turnos'] ?? [];
    if (!is_array($lista) || count($lista) === 0 || count($lista) > 500) throw new ErrorUsuario('No hay turnos que guardar.');
    $pdo = db();
    $pdo->beginTransaction();
    try {
        foreach ($lista as $t) {
            if (!is_array($t)) throw new ErrorUsuario('Turno no válido.');
            consulta('INSERT INTO equipo_turnos (usuario_id, fecha, hora_inicio, hora_fin, nota, creado) VALUES (?, ?, ?, ?, ?, ?)',
                [...datos_turno($t), ahora()]);
        }
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
    return ['creados' => count($lista)];
}

function accion_turno_actualizar(array $e): array
{
    requerir_admin();
    consulta('UPDATE equipo_turnos SET usuario_id = ?, fecha = ?, hora_inicio = ?, hora_fin = ?, nota = ? WHERE id = ?',
        [...datos_turno($e), (int) ($e['id'] ?? 0)]);
    return ['ok' => true];
}

function accion_turno_eliminar(array $e): array
{
    requerir_admin();
    consulta('DELETE FROM equipo_turnos WHERE id = ?', [(int) ($e['id'] ?? 0)]);
    return ['ok' => true];
}

// =====================================================================
// Administracion: cuentas del equipo
// =====================================================================

function accion_perfiles(array $e): array
{
    requerir_admin();
    return normalizar_todas(filas('SELECT * FROM equipo_perfiles ORDER BY activo DESC, nombre'));
}

function datos_perfil(array $e): array
{
    $nombre = texto_o_null($e['nombre'] ?? null, 80);
    if ($nombre === null) throw new ErrorUsuario('El nombre es obligatorio.');
    $tarifa = numero_o_null($e['tarifa_hora'] ?? null);
    if ($tarifa !== null && $tarifa < 0) throw new ErrorUsuario('La tarifa no es válida.');
    return [
        'nombre' => $nombre,
        'puesto' => texto_o_null($e['puesto'] ?? null, 60),
        'telefono' => texto_o_null($e['telefono'] ?? null, 30),
        'tarifa_hora' => $tarifa,
        'rol' => ($e['rol'] ?? '') === 'admin' ? 'admin' : 'trabajador',
    ];
}

function accion_usuario_crear(array $e): array
{
    requerir_admin();
    $usuario = strtolower(trim((string) ($e['usuario'] ?? '')));
    if (!preg_match('/^[a-z0-9._-]{3,30}$/', $usuario)) {
        throw new ErrorUsuario('El usuario debe tener entre 3 y 30 caracteres (letras minúsculas, números, punto o guion).');
    }
    if (fila('SELECT id FROM equipo_perfiles WHERE usuario = ?', [$usuario]) !== null) throw new ErrorUsuario('Ese usuario ya existe.');
    $password = validar_password($e['password'] ?? null);
    $d = datos_perfil($e);
    consulta(
        'INSERT INTO equipo_perfiles (usuario, nombre, password_hash, rol, tarifa_hora, puesto, telefono, activo, creado) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
        [$usuario, $d['nombre'], password_hash($password, PASSWORD_DEFAULT), $d['rol'], $d['tarifa_hora'], $d['puesto'], $d['telefono'], ahora()]
    );
    return normalizar(fila('SELECT * FROM equipo_perfiles WHERE id = ?', [(int) db()->lastInsertId()]));
}

function accion_usuario_actualizar(array $e): array
{
    $admin = requerir_admin();
    $id = (int) ($e['id'] ?? 0);
    if (fila('SELECT id FROM equipo_perfiles WHERE id = ?', [$id]) === null) throw new ErrorUsuario('Trabajador no válido.', 404);
    $d = datos_perfil($e);
    if ($id === (int) $admin['id']) {
        $d['rol'] = 'admin';   // nadie puede quitarse a si mismo el rol de administrador
    }
    consulta('UPDATE equipo_perfiles SET nombre = ?, puesto = ?, telefono = ?, tarifa_hora = ?, rol = ? WHERE id = ?',
        [$d['nombre'], $d['puesto'], $d['telefono'], $d['tarifa_hora'], $d['rol'], $id]);
    return normalizar(fila('SELECT * FROM equipo_perfiles WHERE id = ?', [$id]));
}

function accion_usuario_password(array $e): array
{
    requerir_admin();
    $id = (int) ($e['id'] ?? 0);
    $password = validar_password($e['password'] ?? null);
    consulta('UPDATE equipo_perfiles SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), $id]);
    consulta('DELETE FROM equipo_sesiones WHERE usuario_id = ?', [$id]);
    return ['ok' => true];
}

function accion_usuario_activar(array $e): array
{
    $admin = requerir_admin();
    $id = (int) ($e['id'] ?? 0);
    $activo = !empty($e['activo']);
    if ($id === (int) $admin['id'] && !$activo) throw new ErrorUsuario('No puedes desactivar tu propia cuenta.');
    consulta('UPDATE equipo_perfiles SET activo = ? WHERE id = ?', [$activo ? 1 : 0, $id]);
    if (!$activo) {
        consulta('DELETE FROM equipo_sesiones WHERE usuario_id = ?', [$id]);
    }
    return ['ok' => true];
}

function accion_usuario_eliminar(array $e): array
{
    $admin = requerir_admin();
    $id = (int) ($e['id'] ?? 0);
    if ($id === (int) $admin['id']) throw new ErrorUsuario('No puedes eliminar tu propia cuenta.');
    $usos = (int) fila('SELECT (SELECT COUNT(*) FROM equipo_fichajes WHERE usuario_id = ?) + (SELECT COUNT(*) FROM equipo_movimientos WHERE usuario_id = ?) n', [$id, $id])['n'];
    if ($usos > 0) {
        throw new ErrorUsuario('Este trabajador tiene fichajes o pagos registrados. Desactiva la cuenta en lugar de eliminarla para conservar el historial.');
    }
    consulta('DELETE FROM equipo_perfiles WHERE id = ?', [$id]);
    return ['ok' => true];
}
