<?php
// Notificaciones push (Web Push) sin librerias externas.
// Cifrado del mensaje segun RFC 8291 (aes128gcm) y autenticacion VAPID (RFC 8292).
declare(strict_types=1);

function b64url(string $datos): string
{
    return rtrim(strtr(base64_encode($datos), '+/', '-_'), '=');
}

function de_b64url(string $texto): string
{
    $r = base64_decode(strtr($texto, '-_', '+/') . str_repeat('=', (4 - strlen($texto) % 4) % 4), true);
    if ($r === false) {
        throw new ErrorUsuario('Datos de suscripción no válidos');
    }
    return $r;
}

function asegurar_tablas_push(): void
{
    static $hecho = false;
    if ($hecho) {
        return;
    }
    db()->exec("CREATE TABLE IF NOT EXISTS equipo_vapid (
        id          TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        publica     VARCHAR(120) NOT NULL,
        privada_pem TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("CREATE TABLE IF NOT EXISTS equipo_suscripciones (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        usuario_id    INT UNSIGNED NOT NULL,
        endpoint      TEXT NOT NULL,
        endpoint_hash CHAR(64) NOT NULL,
        p256dh        VARCHAR(120) NOT NULL,
        auth          VARCHAR(60) NOT NULL,
        dispositivo   VARCHAR(120) NULL,
        creado        DATETIME NOT NULL,
        UNIQUE KEY uk_endpoint (endpoint_hash),
        KEY ix_usuario (usuario_id),
        CONSTRAINT fk_susc_usuario FOREIGN KEY (usuario_id) REFERENCES equipo_perfiles (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $hecho = true;
}

// Punto publico EC P-256 sin comprimir (65 bytes) a partir de una clave OpenSSL
function punto_publico($clave): string
{
    $d = openssl_pkey_get_details($clave)['ec'];
    return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}

// Punto publico sin comprimir (65 bytes) -> clave publica OpenSSL
function clave_desde_punto(string $punto)
{
    if (strlen($punto) !== 65 || $punto[0] !== "\x04") {
        throw new ErrorUsuario('Clave de suscripción no válida');
    }
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $punto;
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $clave = openssl_pkey_get_public($pem);
    if ($clave === false) {
        throw new ErrorUsuario('Clave de suscripción no válida');
    }
    return $clave;
}

function nueva_clave_ec()
{
    $clave = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if ($clave === false) {
        throw new RuntimeException('No se pudo generar la clave EC');
    }
    return $clave;
}

// Claves VAPID del servidor: se crean solas la primera vez
function claves_vapid(): array
{
    asegurar_tablas_push();
    $f = fila('SELECT publica, privada_pem FROM equipo_vapid WHERE id = 1');
    if ($f === null) {
        $clave = nueva_clave_ec();
        openssl_pkey_export($clave, $pem);
        consulta('INSERT IGNORE INTO equipo_vapid (id, publica, privada_pem) VALUES (1, ?, ?)', [b64url(punto_publico($clave)), $pem]);
        $f = fila('SELECT publica, privada_pem FROM equipo_vapid WHERE id = 1');
    }
    return $f;
}

// Firma ECDSA en DER -> formato JWS (R || S, 64 bytes)
function der_a_jose(string $der): string
{
    $pos = 2;
    if (ord($der[1]) & 0x80) {
        $pos += ord($der[1]) & 0x7f;
    }
    $partes = [];
    for ($i = 0; $i < 2; $i++) {
        $longitud = ord($der[$pos + 1]);
        $valor = substr($der, $pos + 2, $longitud);
        $partes[] = str_pad(ltrim($valor, "\0"), 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $longitud;
    }
    return $partes[0] . $partes[1];
}

function cabecera_vapid(string $endpoint, array $vapid, string $contacto): string
{
    $u = parse_url($endpoint);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $datos = b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.'
        . b64url(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $contacto], JSON_UNESCAPED_SLASHES));
    $privada = openssl_pkey_get_private($vapid['privada_pem']);
    if (!openssl_sign($datos, $firma, $privada, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('No se pudo firmar la cabecera VAPID');
    }
    return 'vapid t=' . $datos . '.' . b64url(der_a_jose($firma)) . ', k=' . $vapid['publica'];
}

function hkdf_paso(string $sal, string $ikm, string $info, int $longitud): string
{
    $prk = hash_hmac('sha256', $ikm, $sal, true);
    return substr(hash_hmac('sha256', $info . "\x01", $prk, true), 0, $longitud);
}

// Cifra el mensaje para una suscripcion (RFC 8291, una sola entrada aes128gcm)
function cifrar_push(string $mensaje, string $p256dh, string $auth): string
{
    $puntoCliente = de_b64url($p256dh);
    $secretoAuth = de_b64url($auth);
    $clienteClave = clave_desde_punto($puntoCliente);

    $efimera = nueva_clave_ec();
    $puntoServidor = punto_publico($efimera);
    $compartido = openssl_pkey_derive($clienteClave, $efimera, 32);
    if ($compartido === false) {
        throw new RuntimeException('Fallo en el intercambio de claves');
    }

    $ikm = hkdf_paso($secretoAuth, $compartido, "WebPush: info\0" . $puntoCliente . $puntoServidor, 32);
    $sal = random_bytes(16);
    $cek = hkdf_paso($sal, $ikm, "Content-Encoding: aes128gcm\0", 16);
    $nonce = hkdf_paso($sal, $ikm, "Content-Encoding: nonce\0", 12);

    $cifrado = openssl_encrypt($mensaje . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $etiqueta);
    if ($cifrado === false) {
        throw new RuntimeException('Fallo al cifrar el mensaje');
    }
    return $sal . pack('N', 4096) . chr(strlen($puntoServidor)) . $puntoServidor . $cifrado . $etiqueta;
}

// Envia un aviso a todos los administradores suscritos (menos a quien lo provoca).
// Las suscripciones que el servicio da por caducadas se eliminan.
function avisar_administradores(string $titulo, string $cuerpo, ?int $excepto = null): int
{
    asegurar_tablas_push();
    $subs = filas(
        "SELECT s.* FROM equipo_suscripciones s JOIN equipo_perfiles p ON p.id = s.usuario_id
          WHERE p.rol = 'admin' AND p.activo = 1" . ($excepto !== null ? ' AND s.usuario_id <> ?' : ''),
        $excepto !== null ? [$excepto] : []
    );
    return enviar_push($subs, ['titulo' => $titulo, 'cuerpo' => $cuerpo, 'url' => 'admin.html#hoy']);
}

function enviar_push(array $subs, array $datos): int
{
    if (!$subs || !function_exists('curl_multi_init')) {
        return 0;
    }
    $vapid = claves_vapid();
    $contacto = 'https://' . preg_replace('/[^a-z0-9.\-:]/i', '', (string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $mensaje = json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $multi = curl_multi_init();
    $peticiones = [];
    foreach ($subs as $s) {
        try {
            $cuerpo = cifrar_push($mensaje, $s['p256dh'], $s['auth']);
            $ch = curl_init($s['endpoint']);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $cuerpo,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 10,
                CURLOPT_HTTPHEADER => [
                    'Content-Type: application/octet-stream',
                    'Content-Encoding: aes128gcm',
                    'TTL: 86400',
                    'Urgency: high',
                    'Authorization: ' . cabecera_vapid($s['endpoint'], $vapid, $contacto),
                ],
            ]);
            curl_multi_add_handle($multi, $ch);
            $peticiones[] = [$ch, $s];
        } catch (Throwable $e) {
            error_log('[equipo push] ' . $e->getMessage());
        }
    }
    do {
        $estado = curl_multi_exec($multi, $activas);
        if ($activas) {
            curl_multi_select($multi, 1.0);
        }
    } while ($activas && $estado === CURLM_OK);

    $enviados = 0;
    foreach ($peticiones as [$ch, $s]) {
        $codigo = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($codigo >= 200 && $codigo < 300) {
            $enviados++;
        } elseif ($codigo === 404 || $codigo === 410) {
            consulta('DELETE FROM equipo_suscripciones WHERE id = ?', [$s['id']]);
        } else {
            error_log("[equipo push] respuesta $codigo: " . substr((string) curl_multi_getcontent($ch), 0, 200));
        }
        curl_multi_remove_handle($multi, $ch);
    }
    curl_multi_close($multi);
    return $enviados;
}
