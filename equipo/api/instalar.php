<?php
// Instalacion inicial: crea las tablas y la cuenta del administrador.
// Solo funciona mientras no exista ningun administrador. Despues puedes borrar este archivo.
declare(strict_types=1);

require __DIR__ . '/lib.php';

header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function crear_tablas(): void
{
    $sql = (string) file_get_contents(__DIR__ . '/schema.sql');
    $sql = preg_replace('/^\s*--.*$/m', '', $sql);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $sentencia) {
        db()->exec($sentencia);
    }
}

function hay_admin(): bool
{
    try {
        return fila("SELECT id FROM equipo_perfiles WHERE rol = 'admin' AND activo = 1 LIMIT 1") !== null;
    } catch (PDOException) {
        return false;   // las tablas aun no existen
    }
}

$estado = 'formulario';
$mensaje = '';
$datos = ['nombre' => '', 'usuario' => ''];

try {
    db();
    if (hay_admin()) {
        crear_tablas();   // aplica posibles tablas nuevas tras una actualizacion
        $estado = 'instalado';
    } elseif (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $datos['nombre'] = trim((string) ($_POST['nombre'] ?? ''));
        $datos['usuario'] = strtolower(trim((string) ($_POST['usuario'] ?? '')));
        $password = (string) ($_POST['password'] ?? '');
        if ($datos['nombre'] === '') {
            $mensaje = 'Escribe tu nombre.';
        } elseif (!preg_match('/^[a-z0-9._-]{3,30}$/', $datos['usuario'])) {
            $mensaje = 'El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto o guion.';
        } elseif (mb_strlen($password) < 8) {
            $mensaje = 'La contraseña debe tener al menos 8 caracteres.';
        } elseif ($password !== (string) ($_POST['password2'] ?? '')) {
            $mensaje = 'Las contraseñas no coinciden.';
        } else {
            crear_tablas();
            $existente = fila('SELECT id FROM equipo_perfiles WHERE usuario = ?', [$datos['usuario']]);
            if ($existente) {
                consulta("UPDATE equipo_perfiles SET nombre = ?, password_hash = ?, rol = 'admin', activo = 1 WHERE id = ?",
                    [mb_substr($datos['nombre'], 0, 80), password_hash($password, PASSWORD_DEFAULT), $existente['id']]);
            } else {
                consulta("INSERT INTO equipo_perfiles (usuario, nombre, password_hash, rol, activo, creado) VALUES (?, ?, ?, 'admin', 1, ?)",
                    [$datos['usuario'], mb_substr($datos['nombre'], 0, 80), password_hash($password, PASSWORD_DEFAULT), ahora()]);
            }
            $estado = 'hecho';
        }
    }
} catch (PDOException $e) {
    error_log('[equipo instalar] ' . $e->getMessage());
    $estado = 'error_bd';
    $mensaje = $e->getMessage();
}

$h = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Instalación</title>
  <link rel="stylesheet" href="../css/equipo.css">
</head>
<body>
  <main class="login-pagina">
    <div class="login-caja" style="max-width:440px">
      <div class="login-marca">
        <h1>Área de equipo</h1>
        <p>Instalación</p>
      </div>
      <div class="tarjeta">
      <?php if ($estado === 'error_bd'): ?>
        <div class="aviso-caja error">No se puede conectar con la base de datos.</div>
        <p style="margin-bottom:10px">Revisa los datos del archivo <strong>equipo/api/config.php</strong>. Están en hPanel &gt; Bases de datos &gt; Administración.</p>
        <p class="campo-ayuda">Detalle técnico: <?= $h($mensaje) ?></p>
      <?php elseif ($estado === 'instalado'): ?>
        <div class="aviso-caja ok">La instalación ya está hecha.</div>
        <p style="margin-bottom:14px">Por seguridad, puedes borrar el archivo <strong>equipo/api/instalar.php</strong> del servidor.</p>
        <a class="boton boton-primario" href="../">Ir al inicio de sesión</a>
      <?php elseif ($estado === 'hecho'): ?>
        <div class="aviso-caja ok">Instalación completada. Ya puedes iniciar sesión con el usuario <strong><?= $h($datos['usuario']) ?></strong>.</div>
        <p style="margin-bottom:14px">Por seguridad, borra ahora el archivo <strong>equipo/api/instalar.php</strong> del servidor.</p>
        <a class="boton boton-primario" href="../">Ir al inicio de sesión</a>
      <?php else: ?>
        <p style="margin-bottom:14px">Conexión con la base de datos correcta. Crea la cuenta del administrador.</p>
        <?php if ($mensaje): ?><div class="aviso-caja error"><?= $h($mensaje) ?></div><?php endif; ?>
        <form method="post" autocomplete="off">
          <div class="campo"><label for="nombre">Tu nombre</label><input id="nombre" name="nombre" required maxlength="80" value="<?= $h($datos['nombre']) ?>"></div>
          <div class="campo"><label for="usuario">Usuario</label><input id="usuario" name="usuario" required autocapitalize="none" spellcheck="false" pattern="[a-z0-9._\-]{3,30}" value="<?= $h($datos['usuario']) ?>">
            <span class="campo-ayuda">Minúsculas, números, punto o guion. Por ejemplo: andres</span></div>
          <div class="campo"><label for="password">Contraseña</label><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"></div>
          <div class="campo"><label for="password2">Repite la contraseña</label><input id="password2" name="password2" type="password" required minlength="8" autocomplete="new-password"></div>
          <button class="boton boton-primario" type="submit">Crear tablas y administrador</button>
        </form>
      <?php endif; ?>
      </div>
    </div>
  </main>
</body>
</html>
