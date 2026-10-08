-- Bar Kali Pedregalejo - Area de equipo
-- Tablas para MySQL / MariaDB (Hostinger). Las crea automaticamente instalar.php.
-- Todas las fechas y horas se guardan en UTC.

CREATE TABLE IF NOT EXISTS equipo_ajustes (
  id                  TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  tarifa_general      DECIMAL(10,2) NOT NULL DEFAULT 10.00,
  lat_local           DOUBLE NULL,
  lng_local           DOUBLE NULL,
  radio_metros        INT UNSIGNED NOT NULL DEFAULT 150,
  exigir_ubicacion    TINYINT(1) NOT NULL DEFAULT 1,
  bloquear_fuera_zona TINYINT(1) NOT NULL DEFAULT 0,
  margen_retraso_min  INT UNSIGNED NOT NULL DEFAULT 5,
  actualizado         DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO equipo_ajustes (id, lat_local, lng_local) VALUES (1, 36.719500, -4.378500);

CREATE TABLE IF NOT EXISTS equipo_perfiles (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario       VARCHAR(30) NOT NULL,
  nombre        VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol           ENUM('admin', 'trabajador') NOT NULL DEFAULT 'trabajador',
  tarifa_hora   DECIMAL(10,2) NULL,
  puesto        VARCHAR(60) NULL,
  telefono      VARCHAR(30) NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  creado        DATETIME NOT NULL,
  UNIQUE KEY uk_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipo_fichajes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id          INT UNSIGNED NOT NULL,
  entrada             DATETIME NOT NULL,
  salida              DATETIME NULL,
  tarifa              DECIMAL(10,2) NOT NULL,
  entrada_lat         DOUBLE NULL,
  entrada_lng         DOUBLE NULL,
  entrada_precision   DOUBLE NULL,
  entrada_distancia   DOUBLE NULL,
  entrada_dispositivo VARCHAR(300) NULL,
  salida_lat          DOUBLE NULL,
  salida_lng          DOUBLE NULL,
  salida_precision    DOUBLE NULL,
  salida_distancia    DOUBLE NULL,
  salida_dispositivo  VARCHAR(300) NULL,
  manual              TINYINT(1) NOT NULL DEFAULT 0,
  nota                VARCHAR(300) NULL,
  editado_por         INT UNSIGNED NULL,
  editado_en          DATETIME NULL,
  creado              DATETIME NOT NULL,
  KEY ix_usuario_entrada (usuario_id, entrada),
  KEY ix_entrada (entrada),
  KEY ix_abiertos (salida),
  CONSTRAINT fk_fichajes_usuario FOREIGN KEY (usuario_id) REFERENCES equipo_perfiles (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fichajes_editor FOREIGN KEY (editado_por) REFERENCES equipo_perfiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipo_movimientos (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NOT NULL,
  fecha       DATE NOT NULL,
  tipo        ENUM('pago', 'anticipo', 'bonificacion', 'descuento') NOT NULL DEFAULT 'pago',
  importe     DECIMAL(10,2) NOT NULL,
  concepto    VARCHAR(200) NULL,
  creado_por  INT UNSIGNED NULL,
  creado      DATETIME NOT NULL,
  KEY ix_usuario_fecha (usuario_id, fecha),
  CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES equipo_perfiles (id) ON DELETE RESTRICT,
  CONSTRAINT fk_mov_creador FOREIGN KEY (creado_por) REFERENCES equipo_perfiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipo_turnos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id   INT UNSIGNED NOT NULL,
  fecha        DATE NOT NULL,
  hora_inicio  TIME NOT NULL,
  hora_fin     TIME NOT NULL,
  nota         VARCHAR(120) NULL,
  creado       DATETIME NOT NULL,
  KEY ix_fecha_usuario (fecha, usuario_id),
  CONSTRAINT fk_turnos_usuario FOREIGN KEY (usuario_id) REFERENCES equipo_perfiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipo_sesiones (
  token_hash  CHAR(64) NOT NULL PRIMARY KEY,
  usuario_id  INT UNSIGNED NOT NULL,
  creada      DATETIME NOT NULL,
  expira      DATETIME NOT NULL,
  ultimo_uso  DATETIME NOT NULL,
  ip          VARCHAR(45) NULL,
  agente      VARCHAR(255) NULL,
  KEY ix_usuario (usuario_id),
  KEY ix_expira (expira),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id) REFERENCES equipo_perfiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipo_intentos_login (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario  VARCHAR(60) NOT NULL,
  ip       VARCHAR(45) NOT NULL,
  momento  DATETIME NOT NULL,
  KEY ix_usuario_momento (usuario, momento),
  KEY ix_ip_momento (ip, momento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Avisos push a los administradores (tambien se crean solas si faltan)
CREATE TABLE IF NOT EXISTS equipo_vapid (
  id          TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  publica     VARCHAR(120) NOT NULL,
  privada_pem TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipo_suscripciones (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
