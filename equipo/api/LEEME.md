# Área de equipo de Bar Kali: instalación en Hostinger

Todo funciona dentro de tu hosting de Hostinger: las páginas, una pequeña API en PHP y una base de datos MySQL. No hace falta ningún servicio externo ni ninguna cuota adicional.

La dirección será `https://dominio-de-kali/equipo/`. No hay ningún enlace a ella desde la web pública, los buscadores tienen prohibido indexarla y sin iniciar sesión no se puede ver ningún dato.

---

## 1. Base de datos

En hPanel, abre **Bases de datos > Bases de datos MySQL**.

- **Si no tienes ninguna**, crea una nueva con su usuario y su contraseña.
- **Si la web de Kali ya usa una base de datos**, puedes usar esa misma. Todas las tablas nuevas empiezan por `equipo_`, así que no tocan las que ya existen.

Apunta cuatro datos: el **nombre de la base de datos**, el **usuario**, la **contraseña** y el **host**, que en Hostinger es `localhost`. El nombre y el usuario tienen la forma `u123456789_algo`.

## 2. Subir los archivos

1. Abre **Archivos > Administrador de archivos** y entra en `public_html`, donde están los archivos de la web.
2. Sube el `.zip` y usa **Extraer** en `public_html`. Se creará la carpeta `equipo/`, que es independiente del resto de la web.
3. Comprueba que se han subido los archivos ocultos `equipo/.htaccess` y `equipo/api/.htaccess`. Protegen la configuración.

## 3. Configurar la conexión

En el Administrador de archivos, abre `public_html/equipo/api/config.php` con el editor y rellena los datos del paso 1:

```php
'db_host'     => 'localhost',
'db_nombre'   => 'u123456789_equipo',
'db_usuario'  => 'u123456789_equipo',
'db_password' => 'tu contraseña',
```

Guarda el archivo. Cuando subas una actualización, no sustituyas este archivo: si lo haces, tendrás que volver a rellenarlo.

## 4. Instalar

1. Abre en el navegador `https://dominio-de-kali/equipo/api/instalar.php`.
2. Si la conexión es correcta, escribe tu nombre, tu usuario y tu contraseña de administrador. Se crearán las tablas y tu cuenta.
3. **Borra después el archivo `equipo/api/instalar.php`** desde el Administrador de archivos. Aunque lo dejes, deja de funcionar en cuanto existe un administrador.

## 5. Primeros pasos

1. Entra en `https://dominio-de-kali/equipo/` con tu usuario.
2. **Fija la ubicación del bar.** Viene puesta una ubicación aproximada del Paseo Marítimo El Pedregal, 62. Ve al bar con el móvil, entra en **Ajustes**, pulsa **Usar mi ubicación actual** y guarda. Hasta que lo hagas, la pantalla **Hoy** muestra un aviso y los avisos de "fuera de zona" no son fiables. Revisa también el radio permitido (150 m por defecto) y la tarifa general.
3. En **Equipo**, crea las cuentas de los trabajadores y entrégales su usuario y su contraseña.
4. En **Turnos**, prepara el cuadrante de la semana.

## El logo

El logo provisional está en `equipo/img/logo.png`. Para poner el logo real de Kali, sustituye ese archivo por otro con el **mismo nombre**: una imagen PNG cuadrada, idealmente de 512 × 512 píxeles. Se usa en la pantalla de acceso, en la barra superior y como icono en la pantalla de inicio del móvil.

## Instalar en el móvil

Para fichar más rápido, los trabajadores pueden añadir la página a la pantalla de inicio del móvil: en Safari, Compartir > Añadir a pantalla de inicio; en Chrome, menú > Añadir a pantalla de inicio.

## Requisitos

- **HTTPS activo.** Sin él, el móvil no deja usar la ubicación. Se activa en **hPanel > Seguridad > SSL**; Hostinger lo incluye gratis. El área de equipo redirige automáticamente a HTTPS.
- **PHP 8.0 o superior.** Se comprueba en **hPanel > Avanzado > Configuración de PHP**. Hostinger usa PHP 8 por defecto.

## Seguridad incluida

- Las contraseñas se guardan cifradas con `password_hash`; nunca en texto plano.
- La sesión dura 30 días en el móvil del trabajador y se renueva con el uso. Va en una cookie protegida (HttpOnly, SameSite=Strict, Secure).
- Tras 5 intentos fallidos, ese usuario queda bloqueado 15 minutos.
- Cada trabajador solo recibe sus propios datos. Lo comprueba el servidor en cada petición, no solo la página.
- La hora de los fichajes la pone el servidor. El trabajador no puede adelantarla ni retrasarla.
- Al desactivar una cuenta o cambiar su contraseña, se cierran todas sus sesiones abiertas.
- Los archivos `config.php`, `lib.php` y `schema.sql` no se pueden abrir desde el navegador.

## Cómo se calcula lo que se debe

- Cada fichaje guarda la tarifa vigente en el momento de la entrada: la propia del trabajador o, si no tiene, la general. Si cambias un sueldo, los fichajes anteriores no cambian, salvo que marques "Aplicar la tarifa también a fichajes anteriores desde...".
- **Pendiente = horas de fichajes cerrados × tarifa + bonificaciones − descuentos − pagos − anticipos.**

## Aspectos legales (España)

- El registro diario de jornada es obligatorio (art. 34.9 del Estatuto de los Trabajadores) y hay que conservarlo **4 años**. No elimines fichajes antiguos.
- Para registrar la ubicación al fichar, hay que **informar a los trabajadores por escrito** de que se recoge y para qué se usa (art. 90 de la LOPDGDD). La ubicación solo se toma en el momento de fichar, nunca durante la jornada.

## Copias de seguridad

- Hostinger hace copias automáticas, que puedes ver en **hPanel > Archivos > Copias de seguridad**.
- También puedes exportar desde la propia aplicación: **Fichajes > Exportar CSV** y **Saldos y pagos > Exportar CSV**. Los archivos se abren con Excel.
