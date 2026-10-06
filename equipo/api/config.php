<?php
// Datos de la base de datos MySQL de Hostinger.
// Si existe includes/db.php (el de la web del restaurante), se usan sus mismos datos,
// asi que basta con cambiar la contrasena en un solo sitio.
$db_web = dirname(__DIR__, 2) . '/includes/db.php';
if (is_file($db_web)) {
    require_once $db_web;
    return [
        'db_host'     => DB_HOST,
        'db_nombre'   => DB_NAME,
        'db_usuario'  => DB_USER,
        'db_password' => DB_PASS,
    ];
}

// Si no, rellena aqui los datos (hPanel > Bases de datos > Administracion).
return [
    'db_host'     => 'localhost',
    'db_nombre'   => 'u000000000_nombre',
    'db_usuario'  => 'u000000000_usuario',
    'db_password' => 'CAMBIAR',
];
