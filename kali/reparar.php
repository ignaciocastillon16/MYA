<?php
// Reparacion automatica de la web de Kali en Hostinger.
// 1. Copia la web publica y el area de equipo a la raiz del dominio (public_html).
// 2. Busca los datos de la base de datos que ya existan y escribe un config.php limpio.
// 3. Comprueba que todo funciona y, si es asi, se borra a si misma.
declare(strict_types=1);
ob_start();
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

const HTACCESS = [
    'equipo/.htaccess' => <<<'TXT'
# Area privada de equipo: fuera de los buscadores y sin listado de archivos
Options -Indexes

<IfModule mod_headers.c>
  Header always set X-Robots-Tag "noindex, nofollow, noarchive"
  Header always set Referrer-Policy "no-referrer"
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  <FilesMatch "\.(html|js|css)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>

# Forzar HTTPS (necesario para que el movil permita usar la ubicacion)
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !=https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>
TXT,
    'equipo/api/.htaccess' => <<<'TXT'
# Solo api.php e instalar.php son accesibles desde el navegador
Options -Indexes

<IfModule mod_authz_core.c>
  <FilesMatch "^(config|config\.local|lib|push)\.php$|\.(sql|md|log)$">
    Require all denied
  </FilesMatch>
</IfModule>
<IfModule !mod_authz_core.c>
  <FilesMatch "^(config|config\.local|lib|push)\.php$|\.(sql|md|log)$">
    Order allow,deny
    Deny from all
  </FilesMatch>
</IfModule>

<IfModule mod_headers.c>
  Header always set X-Robots-Tag "noindex, nofollow"
  Header always set Cache-Control "no-store"
</IfModule>
TXT,
];

$aqui = __DIR__;
$raiz = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? '')) ?: $aqui;
$paquete = is_file($aqui . '/paquete-kali.txt');
$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
$host = preg_replace('/[^a-z0-9.\-:]/i', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
$web = 'https://' . $host . '/';

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

// Copia recursiva; $proteger son rutas relativas que no se sobrescriben si ya existen
function copiar_arbol(string $origen, string $destino, array $proteger, string $rel = ''): int
{
    $n = 0;
    if (!is_dir($destino) && !mkdir($destino, 0755, true)) {
        throw new RuntimeException("No se pudo crear la carpeta $destino");
    }
    foreach (scandir($origen) as $e) {
        if ($e === '.' || $e === '..' || $e === 'paquete-kali.txt') {
            continue;
        }
        $o = "$origen/$e";
        $d = "$destino/$e";
        $r = ltrim("$rel/$e", '/');
        if (is_dir($o)) {
            $n += copiar_arbol($o, $d, $proteger, $r);
        } else {
            if (in_array($r, $proteger, true) && is_file($d)) {
                continue;
            }
            if (!copy($o, $d)) {
                throw new RuntimeException("No se pudo copiar $r");
            }
            $n++;
        }
    }
    return $n;
}

function borrar_arbol(string $dir): void
{
    foreach (scandir($dir) as $e) {
        if ($e === '.' || $e === '..') {
            continue;
        }
        $p = "$dir/$e";
        is_dir($p) && !is_link($p) ? borrar_arbol($p) : @unlink($p);
    }
    @rmdir($dir);
}

// Lee un config.php sin que su contenido "suelto" estropee nada
function leer_config(string $archivo): ?array
{
    if (!is_file($archivo)) {
        return null;
    }
    ob_start();
    try {
        $c = (static function (string $f) { return include $f; })($archivo);
    } catch (Throwable $e) {
        $c = null;
    }
    ob_end_clean();
    if (!is_array($c) || empty($c['db_nombre']) || empty($c['db_usuario']) || !isset($c['db_password'])) {
        return null;
    }
    if ($c['db_password'] === 'CAMBIAR' || str_starts_with((string) $c['db_nombre'], 'u000000000')) {
        return null;
    }
    return $c;
}

function probar_conexion(array $c): array
{
    try {
        $pdo = new PDO("mysql:host={$c['db_host']};dbname={$c['db_nombre']};charset=utf8mb4", $c['db_usuario'], $c['db_password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]);
        $tablas = (bool) $pdo->query("SHOW TABLES LIKE 'equipo_perfiles'")->fetchColumn();
        $admin = $tablas && (bool) $pdo->query("SELECT id FROM equipo_perfiles WHERE rol = 'admin' AND activo = 1 LIMIT 1")->fetchColumn();
        return ['conecta' => true, 'tablas' => $tablas, 'admin' => $admin];
    } catch (Throwable $e) {
        return ['conecta' => false, 'tablas' => false, 'admin' => false];
    }
}

// Busca credenciales validas: primero las del area de equipo, luego carpetas antiguas de la API
function buscar_credenciales(string $raiz): ?array
{
    $candidatos = array_merge(
        [$raiz . '/equipo/api/config.local.php', $raiz . '/equipo/api/config.php'],
        glob($raiz . '/kali-api*/config.php') ?: [],
        glob($raiz . '/*/api/config.php') ?: [],
        glob($raiz . '/*/config.php') ?: [],
        glob($raiz . '/*/*/api/config.php') ?: []
    );
    $mejor = null;
    foreach (array_unique($candidatos) as $f) {
        $c = leer_config($f);
        if ($c === null) {
            continue;
        }
        $c['db_host'] = $c['db_host'] ?? 'localhost';
        $p = probar_conexion($c);
        if ($p['conecta'] && $p['tablas']) {
            return $c + ['_origen' => $f];
        }
        if ($p['conecta'] && $mejor === null) {
            $mejor = $c + ['_origen' => $f];
        }
    }
    return $mejor;
}

function escribir_config(string $raiz, array $c): void
{
    $datos = [
        'db_host' => (string) ($c['db_host'] ?: 'localhost'),
        'db_nombre' => (string) $c['db_nombre'],
        'db_usuario' => (string) $c['db_usuario'],
        'db_password' => (string) $c['db_password'],
        'detras_de_netlify' => false,
    ];
    $php = "<?php\n// Datos de la base de datos MySQL (escrito por reparar.php)\nreturn " . var_export($datos, true) . ";\n";
    if (file_put_contents($raiz . '/equipo/api/config.php', $php, LOCK_EX) === false) {
        throw new RuntimeException('No se pudo escribir equipo/api/config.php');
    }
    @unlink($raiz . '/equipo/api/config.local.php');
}

// ---------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------

$pasos = [];
$error = '';
$pedirDatos = false;
$terminado = false;

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    try {
        // 1. Colocar los archivos en la raiz
        if ($paquete && $aqui !== $raiz) {
            $n = copiar_arbol($aqui, $raiz, ['equipo/api/config.php']);
            $pasos[] = ['ok', "Archivos colocados en la carpeta principal de la web ($n archivos)."];
        } else {
            $pasos[] = ['ok', 'Los archivos ya están en la carpeta principal de la web.'];
        }
        // Las protecciones .htaccess: si el extractor no copio los archivos ocultos, se crean
        foreach (HTACCESS as $f => $contenido) {
            if (!is_file("$raiz/$f") && file_put_contents("$raiz/$f", $contenido) !== false) {
                $pasos[] = ['ok', "Creada la protección $f."];
            }
        }
        foreach (['equipo/index.html', 'equipo/js/comun.js', 'equipo/api/api.php', 'equipo/api/lib.php', 'equipo/.htaccess', 'equipo/api/.htaccess', 'index.html'] as $f) {
            if (!is_file("$raiz/$f")) {
                throw new RuntimeException("Falta el archivo $f después de copiar.");
            }
        }

        // La pagina de bienvenida de Hostinger (default.php) puede tapar la web: se aparta
        if (is_file("$raiz/default.php") && is_file("$raiz/index.html") && @rename("$raiz/default.php", "$raiz/default.php.bak")) {
            $pasos[] = ['ok', 'Retirada la página de bienvenida de Hostinger (default.php).'];
        }

        // 2. Datos de la base de datos. Si ya hay unos que funcionan, se usan esos
        // y se ignora lo escrito a mano (nadie puede cambiar la base de datos desde aqui).
        $encontradas = buscar_credenciales($raiz);
        $funcionan = $encontradas !== null && probar_conexion($encontradas)['admin'];
        if ($funcionan) {
            $c = $encontradas;
        } elseif (!empty($_POST['db_nombre'])) {
            $c = ['db_host' => trim((string) ($_POST['db_host'] ?? '')) ?: 'localhost', 'db_nombre' => trim((string) $_POST['db_nombre']),
                'db_usuario' => trim((string) $_POST['db_usuario']), 'db_password' => (string) $_POST['db_password']];
            if (!probar_conexion($c)['conecta']) {
                $pedirDatos = true;
                throw new RuntimeException('Con esos datos no se puede conectar a la base de datos. Revísalos en hPanel > Bases de datos.');
            }
        } else {
            $c = $encontradas;
            if ($c === null) {
                $pedirDatos = true;
                throw new RuntimeException('No he encontrado los datos de la base de datos. Escríbelos abajo una sola vez.');
            }
        }
        escribir_config($raiz, $c);
        $pasos[] = ['ok', 'Configuración de la base de datos escrita de nuevo, limpia.'];

        // 3. Comprobaciones finales
        $p = probar_conexion($c);
        $pasos[] = [$p['conecta'] ? 'ok' : 'mal', $p['conecta'] ? 'La base de datos conecta.' : 'La base de datos no conecta.'];
        if (!$p['tablas']) {
            $pasos[] = ['aviso', 'Esa base de datos está vacía. Abre equipo/api/instalar.php para crear tu cuenta de administrador.'];
        } else {
            $pasos[] = [$p['admin'] ? 'ok' : 'aviso', $p['admin'] ? 'Tu cuenta de administrador existe.' : 'No hay ningún administrador: abre equipo/api/instalar.php.'];
        }

        // 4. Limpieza: borra la carpeta del paquete y este archivo
        if ($p['conecta'] && $p['tablas'] && $p['admin']) {
            if ($paquete && $aqui !== $raiz) {
                borrar_arbol($aqui);
            }
            @unlink($raiz . '/reparar.php');
            @unlink($raiz . '/equipo/api/instalar.php');
            $pasos[] = ['ok', 'Limpieza hecha: se han borrado los archivos de instalación.'];
            $terminado = true;
        }
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

// Diagnostico previo (al abrir la pagina)
$existeEquipo = is_file($raiz . '/equipo/api/api.php');
$credsPrevias = $_SERVER['REQUEST_METHOD'] === 'GET' ? buscar_credenciales($raiz) : null;
ob_end_clean();
?>
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="only light">
  <title>Reparar Kali</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #FDF6E6; color: #1F2D5A; padding: 32px 16px; line-height: 1.5; }
    .caja { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #ecdcb5; border-radius: 16px; padding: 24px; }
    h1 { font-size: 22px; margin-bottom: 6px; }
    p { margin-bottom: 12px; }
    ul { list-style: none; margin: 16px 0; }
    li { padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; font-size: 15px; }
    .ok { background: #e6f4ec; color: #1f6b44; }
    .mal { background: #fdecea; color: #b42318; }
    .aviso { background: #fdf3dc; color: #8a5a00; }
    .boton { display: block; width: 100%; text-align: center; background: #1F2D5A; color: #FAE9C2; border: 0; border-radius: 999px; padding: 14px; font-size: 16px; font-weight: 600; text-decoration: none; cursor: pointer; margin-top: 10px; }
    .boton.claro { background: #FAE9C2; color: #1F2D5A; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #d9c99f; border-radius: 10px; font-size: 16px; }
    small { color: #55648F; }
  </style>
</head>
<body>
  <div class="caja">
    <h1>Reparar la web de Kali</h1>
    <?php if ($terminado): ?>
      <ul><?php foreach ($pasos as [$t, $m]): ?><li class="<?= $h($t) ?>"><?= $h($m) ?></li><?php endforeach; ?></ul>
      <p><strong>Todo listo.</strong> Ya puedes cerrar esta página.</p>
      <a class="boton" href="<?= $h($web) ?>equipo/">Entrar en el área de equipo</a>
      <a class="boton claro" href="<?= $h($web) ?>">Ver la web pública</a>
    <?php else: ?>
      <?php if ($pasos || $error): ?>
        <ul>
          <?php foreach ($pasos as [$t, $m]): ?><li class="<?= $h($t) ?>"><?= $h($m) ?></li><?php endforeach; ?>
          <?php if ($error): ?><li class="mal"><?= $h($error) ?></li><?php endif; ?>
        </ul>
      <?php else: ?>
        <p>Esta página coloca la web y el área de equipo en su sitio, recupera los datos de tu base de datos y comprueba que todo funcione. No borra fichajes ni cuentas.</p>
        <ul>
          <li class="<?= $existeEquipo ? 'ok' : 'aviso' ?>"><?= $existeEquipo ? 'El área de equipo está instalada.' : 'El área de equipo aún no está en su sitio: se colocará ahora.' ?></li>
          <li class="<?= $credsPrevias ? 'ok' : 'aviso' ?>"><?= $credsPrevias ? 'He encontrado los datos de tu base de datos.' : 'No encuentro los datos de la base de datos: te los pediré.' ?></li>
        </ul>
      <?php endif; ?>
      <form method="post">
        <?php if ($pedirDatos || (!$pasos && !$credsPrevias && !$error)): ?>
          <p><small>Los encuentras en hPanel &gt; Bases de datos &gt; Bases de datos MySQL.</small></p>
          <label for="db_nombre">Nombre de la base de datos</label><input id="db_nombre" name="db_nombre" placeholder="u123456789_kali" required>
          <label for="db_usuario">Usuario de la base de datos</label><input id="db_usuario" name="db_usuario" placeholder="u123456789_kali" required>
          <label for="db_password">Contraseña de la base de datos</label><input id="db_password" name="db_password" type="password" required>
          <label for="db_host">Servidor</label><input id="db_host" name="db_host" value="localhost">
        <?php endif; ?>
        <button class="boton" type="submit"><?= ($pasos || $error) ? 'Volver a intentarlo' : 'Reparar ahora' ?></button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>
