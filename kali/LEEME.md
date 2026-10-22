# Área de equipo de Bar Kali: instalación en Hostinger

Todo funciona dentro de Hostinger: las páginas, la API en PHP y la base de datos MySQL. Se sube una sola carpeta, `equipo/`.

La dirección será `https://tu-dominio/equipo/`. Los buscadores tienen prohibido indexarla y sin iniciar sesión no se puede ver ningún dato.

---

## 1. Base de datos

En hPanel, abre **Bases de datos > Bases de datos MySQL**. Crea una base de datos con su usuario y su contraseña, y apunta el **nombre**, el **usuario** y la **contraseña**. Si ya tenías una de la versión anterior, usa esa misma.

## 2. Subir los archivos

1. Abre **Archivos > Administrador de archivos** y entra en `public_html`.
2. Sube el `.zip` y usa **Extraer**. Se creará la carpeta `equipo/`.
3. Comprueba que se han subido los archivos ocultos `equipo/.htaccess` y `equipo/api/.htaccess`. Protegen la configuración.

## 3. Configurar la conexión

Abre `equipo/api/config.php` con el editor y rellena los datos del paso 1. Deja `'detras_de_netlify' => false`.

Cuando subas una actualización, no sustituyas este archivo: si lo haces, tendrás que volver a rellenarlo.

## 4. Instalar

Si la base de datos es nueva:

1. Abre `https://tu-dominio/equipo/api/instalar.php`.
2. Crea tu cuenta de administrador. Se crearán las tablas.
3. **Borra después `equipo/api/instalar.php`.**

Si ya tenías la base de datos de antes, este paso no hace falta: tus cuentas y tus datos siguen ahí.

## Si venías de la versión con Netlify

1. Antes de borrar nada, abre la carpeta antigua de la API en Hostinger (por ejemplo `public_html/kali-api-7q3m`) y copia los datos de su `config.php`.
2. Si tenías los avisos activados, desactívalos en la app de Netlify: **Ajustes > Avisos en este móvil > Desactivar en este móvil**.
3. Sube la carpeta `equipo/` y rellena su `config.php` con esos datos (pasos 2 y 3). No hace falta el paso 4.
4. Entra en `https://tu-dominio/equipo/` y comprueba que ves tus trabajadores y fichajes.
5. Después borra la carpeta antigua de la API y elimina el sitio en Netlify (**Site configuration > Delete site**). **La base de datos no la borres.**
6. Pasa la nueva dirección a los trabajadores. Quien tuviera la app en la pantalla de inicio tiene que borrar el icono antiguo y añadir la nueva dirección.
7. Vuelve a activar los avisos desde la nueva dirección.

## Primeros pasos

1. **Fija la ubicación del bar.** Viene puesta una ubicación aproximada del Paseo Marítimo El Pedregal, 62. Ve al bar con el móvil, entra en **Ajustes**, pulsa **Usar mi ubicación actual** y guarda. Hasta que lo hagas, la pantalla **Hoy** muestra un aviso y los avisos de "fuera de zona" no son fiables. Revisa también el radio permitido (150 m por defecto) y la tarifa general.
2. **Fichar solo desde el bar.** En **Ajustes > Control** está marcada por defecto la opción "Solo se puede fichar la entrada y la salida desde el bar". Con ella, nadie puede fichar la entrada ni la salida si su móvil está fuera del radio permitido, ni si el móvil da una ubicación tan imprecisa que no permite comprobarlo. Si un trabajador se marcha sin fichar la salida, la corriges tú desde **Fichajes > Editar**. Si instalaste la app antes de este cambio, marca esa casilla y guarda.
3. En **Equipo**, crea las cuentas de los trabajadores. Al crear cada cuenta, la app te muestra la dirección, el usuario y la contraseña que tienes que entregarles.
4. En **Turnos**, prepara el cuadrante de la semana.

Para fichar más rápido, los trabajadores pueden añadir la web a la pantalla de inicio del móvil: en Safari, Compartir > Añadir a pantalla de inicio; en Chrome, menú > Añadir a pantalla de inicio.

## El logo

El logo provisional está en `equipo/img/logo.png`. Para poner el logo real de Kali, sustituye ese archivo por otro con el **mismo nombre**: una imagen PNG cuadrada, idealmente de 512 × 512 píxeles. 

## Avisos en el móvil del administrador

Cada vez que alguien fiche la entrada o la salida, a los administradores que lo activen les llega una notificación en el móvil, aunque tengan la app cerrada. Por ejemplo: "Marta Ruiz ha fichado la entrada · 18:02 · En el local". Si alguien ficha lejos del bar, el aviso lo indica.

Para activarlos en un **iPhone** (iOS 16.4 o posterior):

1. Abre la web en Safari, pulsa **Compartir > Añadir a pantalla de inicio** y abre la app desde ese icono. En una pestaña normal de Safari, el iPhone no permite notificaciones.
2. Inicia sesión con tu usuario de administrador y entra en **Ajustes > Avisos en este móvil**.
3. Pulsa **Activar avisos** y acepta el permiso.
4. Pulsa **Enviar aviso de prueba** para comprobar que llega.

En **Android** se activa igual desde Chrome, sin necesidad de instalar la app. Puedes activarlos en varios móviles, y cada administrador recibe los suyos. Si algún día dejan de llegar, pulsa **Desactivar en este móvil** y vuelve a activarlos.

Los avisos salen de tu propio hosting, sin servicios de terceros de pago. Las claves de seguridad se generan solas la primera vez.

## Requisitos

- **HTTPS activo.** Sin él, el móvil no deja usar la ubicación ni recibir avisos. Se activa en **hPanel > Seguridad > SSL**; Hostinger lo incluye gratis. El área de equipo redirige automáticamente a HTTPS.
- **PHP 8.0 o superior, con las extensiones `openssl` y `curl`.** Se comprueba en **hPanel > Avanzado > Configuración de PHP**. Hostinger usa PHP 8 y trae ambas extensiones activadas por defecto.

## Seguridad incluida

- Las contraseñas se guardan cifradas con `password_hash`; nunca en texto plano.
- La sesión dura 30 días en el móvil del trabajador y se renueva con el uso. Va en una cookie protegida (HttpOnly, SameSite=Strict, Secure).
- Tras 5 intentos fallidos, ese usuario queda bloqueado 15 minutos.
- Cada trabajador solo recibe sus propios datos. Lo comprueba el servidor en cada petición, no solo la página.
- La hora de los fichajes la pone el servidor. El trabajador no puede adelantarla ni retrasarla.
- Al desactivar una cuenta o cambiar su contraseña, se cierran todas sus sesiones abiertas.
- Los archivos `config.php`, `lib.php`, `push.php` y `schema.sql` no se pueden abrir desde el navegador.

## Cómo se calcula lo que se debe

- Cada fichaje guarda la tarifa vigente en el momento de la entrada: la propia del trabajador o, si no tiene, la general. Si cambias un sueldo, los fichajes anteriores no cambian, salvo que marques "Aplicar la tarifa también a fichajes anteriores desde...".
- **Pendiente = horas de fichajes cerrados × tarifa + bonificaciones − descuentos − pagos − anticipos.**

## Aspectos legales (España)

- El registro diario de jornada es obligatorio (art. 34.9 del Estatuto de los Trabajadores) y hay que conservarlo **4 años**. No elimines fichajes antiguos.
- Para registrar la ubicación al fichar, hay que **informar a los trabajadores por escrito** de que se recoge y para qué se usa (art. 90 de la LOPDGDD). La ubicación solo se toma en el momento de fichar, nunca durante la jornada.

## Copias de seguridad

- Hostinger hace copias automáticas, que puedes ver en **hPanel > Archivos > Copias de seguridad**.
- También puedes exportar desde la propia aplicación: **Fichajes > Exportar CSV** y **Saldos y pagos > Exportar CSV**. Los archivos se abren con Excel.
