<?php
// Funciones comunes de la API del area de equipo.
declare(strict_types=1);

const ZONA = 'Europe/Madrid';
const COOKIE_SESION = 'kali_equipo';
const DURACION_SESION = 60 * 60 * 24 * 30;   // 30 dias, se renueva con el uso
const MAX_INTENTOS_USUARIO = 5;               // en 15 minutos
const MAX_INTENTOS_IP = 20;                   // en 15 minutos

final class ErrorUsuario extends Exception
{
    public function __construct(string $mensaje, public int $estado = 400)
    {
        parent::__construct($mensaje);
    }
}

function config(): array
{
    static $c = null;
    if ($c === null) {
        // config.local.php (si existe) tiene prioridad: util si se despliega desde Git
        $local = __DIR__ . '/config.local.php';
        $c = require (is_file($local) ? $local : __DIR__ . '/config.php');
    }
    return $c;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config();
        $pdo = new PDO(
            "mysql:host={$c['db_host']};dbname={$c['db_nombre']};charset=utf8mb4",
            $c['db_usuario'],
            $c['db_password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function consulta(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function fila(string $sql, array $params = []): ?array
{
    $r = consulta($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function filas(string $sql, array $params = []): array
{
    return consulta($sql, $params)->fetchAll();
}

function responder(mixed $datos, int $estado = 200): never
{
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ---------------------------------------------------------------------
// Fechas (en la base de datos todo esta en UTC)
// ---------------------------------------------------------------------

function ahora(): string
{
    return gmdate('Y-m-d H:i:s');
}

// DATETIME UTC de la base de datos -> "2026-10-05T19:30:00Z"
function a_iso(?string $dt): ?string
{
    return $dt === null ? null : str_replace(' ', 'T', $dt) . 'Z';
}

// Cualquier fecha ISO enviada por el navegador -> DATETIME UTC
function de_iso(mixed $valor, string $campo): ?string
{
    if ($valor === null || $valor === '') {
        return null;
    }
    try {
        $d = new DateTimeImmutable((string) $valor);
    } catch (Exception) {
        throw new ErrorUsuario("Fecha no valida en $campo");
    }
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

// "2026-10-05" (dia en Madrid) -> DATETIME UTC del inicio de ese dia
function inicio_dia_madrid(string $dia): string
{
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $dia, new DateTimeZone(ZONA));
    if (!$d) {
        throw new ErrorUsuario('Fecha no valida');
    }
    return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

function validar_dia(mixed $v, string $campo): string
{
    if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4))) {
        throw new ErrorUsuario("Fecha no valida en $campo");
    }
    return $v;
}

function validar_hora(mixed $v, string $campo): string
{
    if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $v)) {
        throw new ErrorUsuario("Hora no valida en $campo");
    }
    return strlen($v) === 5 ? "$v:00" : $v;
}

// ---------------------------------------------------------------------
// Conversion de filas a JSON con tipos correctos
// ---------------------------------------------------------------------

const CAMPOS_ID = ['id', 'usuario_id', 'editado_por', 'creado_por'];
const CAMPOS_NUMERO = ['tarifa_general', 'lat_local', 'lng_local', 'radio_metros', 'margen_retraso_min', 'tarifa_hora', 'tarifa',
    'entrada_lat', 'entrada_lng', 'entrada_precision', 'entrada_distancia', 'salida_lat', 'salida_lng', 'salida_precision',
    'salida_distancia', 'importe', 'horas', 'devengado', 'extras', 'pagado', 'saldo'];
const CAMPOS_BOOL = ['exigir_ubicacion', 'bloquear_fuera_zona', 'activo', 'manual'];
const CAMPOS_FECHAHORA = ['entrada', 'salida', 'editado_en', 'creado', 'actualizado'];

function normalizar(?array $f): ?array
{
    if ($f === null) {
        return null;
    }
    unset($f['password_hash']);
    foreach ($f as $k => $v) {
        if ($v === null) {
            continue;
        }
        if (in_array($k, CAMPOS_ID, true)) {
            $f[$k] = (string) $v;
        } elseif (in_array($k, CAMPOS_NUMERO, true)) {
            $f[$k] = (float) $v;
        } elseif (in_array($k, CAMPOS_BOOL, true)) {
            $f[$k] = (bool) $v;
        } elseif (in_array($k, CAMPOS_FECHAHORA, true)) {
            $f[$k] = a_iso($v);
        }
    }
    return $f;
}

function normalizar_todas(array $lista): array
{
    return array_map('normalizar', $lista);
}

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

function distancia_metros(?float $lat1, ?float $lng1, ?float $lat2, ?float $lng2): ?float
{
    if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) {
        return null;
    }
    $r = fn($x) => deg2rad($x);
    $a = sin($r($lat2 - $lat1) / 2) ** 2 + cos($r($lat1)) * cos($r($lat2)) * sin($r($lng2 - $lng1) / 2) ** 2;
    return 2 * 6371000 * asin(sqrt($a));
}

function numero_o_null(mixed $v): ?float
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_numeric($v)) {
        throw new ErrorUsuario('Valor numerico no valido');
    }
    return (float) $v;
}

function texto_o_null(mixed $v, int $max): ?string
{
    if ($v === null) {
        return null;
    }
    $t = trim((string) $v);
    return $t === '' ? null : mb_substr($t, 0, $max);
}

function ip_cliente(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

function validar_password(mixed $p): string
{
    if (!is_string($p) || mb_strlen($p) < 8) {
        throw new ErrorUsuario('La contraseña debe tener al menos 8 caracteres');
    }
    if (strlen($p) > 200) {
        throw new ErrorUsuario('La contraseña es demasiado larga');
    }
    return $p;
}

function es_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443');
}

// ---------------------------------------------------------------------
// Sesiones (token aleatorio en cookie HttpOnly, guardado con hash)
// ---------------------------------------------------------------------

function ruta_cookie(): string
{
    // Limita la cookie a la carpeta del area de equipo (por ejemplo /equipo/)
    $ruta = dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/equipo/api/api.php'));
    return rtrim(str_replace('\\', '/', $ruta), '/') . '/';
}

function poner_cookie(string $valor, int $expira): void
{
    setcookie(COOKIE_SESION, $valor, [
        'expires' => $expira,
        'path' => ruta_cookie(),
        'secure' => es_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function crear_sesion(int $usuarioId): void
{
    $token = bin2hex(random_bytes(32));
    $expira = time() + DURACION_SESION;
    consulta(
        'INSERT INTO equipo_sesiones (token_hash, usuario_id, creada, expira, ultimo_uso, ip, agente) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [hash('sha256', $token), $usuarioId, ahora(), gmdate('Y-m-d H:i:s', $expira), ahora(), ip_cliente(),
            substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255)]
    );
    poner_cookie($token, $expira);
    // Limpieza ocasional de sesiones caducadas
    if (random_int(1, 50) === 1) {
        consulta('DELETE FROM equipo_sesiones WHERE expira < ?', [ahora()]);
        consulta('DELETE FROM equipo_intentos_login WHERE momento < ?', [gmdate('Y-m-d H:i:s', time() - 86400)]);
    }
}

function cerrar_sesion(): void
{
    $token = $_COOKIE[COOKIE_SESION] ?? '';
    if (is_string($token) && $token !== '') {
        consulta('DELETE FROM equipo_sesiones WHERE token_hash = ?', [hash('sha256', $token)]);
    }
    poner_cookie('', time() - 3600);
}

function usuario_actual(): ?array
{
    static $usuario = false;
    if ($usuario !== false) {
        return $usuario;
    }
    $usuario = null;
    $token = $_COOKIE[COOKIE_SESION] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }
    $hash = hash('sha256', $token);
    $f = fila(
        'SELECT p.*, s.ultimo_uso AS sesion_uso FROM equipo_sesiones s JOIN equipo_perfiles p ON p.id = s.usuario_id
          WHERE s.token_hash = ? AND s.expira > ? AND p.activo = 1',
        [$hash, ahora()]
    );
    if ($f === null) {
        return null;
    }
    // Renueva la sesion como mucho una vez por hora
    if (strtotime($f['sesion_uso'] . ' UTC') < time() - 3600) {
        $expira = time() + DURACION_SESION;
        consulta('UPDATE equipo_sesiones SET ultimo_uso = ?, expira = ? WHERE token_hash = ?',
            [ahora(), gmdate('Y-m-d H:i:s', $expira), $hash]);
        poner_cookie($token, $expira);
    }
    unset($f['sesion_uso']);
    $usuario = $f;
    return $usuario;
}

function requerir_sesion(): array
{
    $u = usuario_actual();
    if ($u === null) {
        throw new ErrorUsuario('La sesión ha caducado. Vuelve a iniciar sesión.', 401);
    }
    return $u;
}

function requerir_admin(): array
{
    $u = requerir_sesion();
    if ($u['rol'] !== 'admin') {
        throw new ErrorUsuario('No autorizado', 403);
    }
    return $u;
}

function es_admin(array $u): bool
{
    return $u['rol'] === 'admin';
}
