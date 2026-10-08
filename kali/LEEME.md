# Área de equipo de Bar Kali: instalación con Netlify y Hostinger

La app está repartida en dos partes:

- **`web/`** va a **Netlify**. Son las pantallas que abren los trabajadores y el administrador, y su dirección será algo como `https://kali-equipo.netlify.app`.
- **`api/`** va a **Hostinger**, junto a la base de datos. Es la parte del servidor: guarda los fichajes, comprueba las contraseñas y envía los avisos. Nadie la abre directamente.

Netlify reenvía por dentro las peticiones de la app a Hostinger, así que para el navegador todo es la misma web. Netlify no ejecuta PHP; por eso esa parte se queda en Hostinger.

> **No subas nunca la carpeta `api/` a Netlify.** Contiene la contraseña de la base de datos, y Netlify la publicaría como texto.

---

## 1. Hostinger: base de datos

En hPanel, abre **Bases de datos > Bases de datos MySQL**. Crea una base de datos con su usuario y su contraseña, y apunta el **nombre**, el **usuario** y la **contraseña**.

## 2. Hostinger: subir la API

1. En **Archivos > Administrador de archivos**, entra en `public_html` del dominio que tengas en Hostinger.
2. Sube la carpeta `api/` y **cámbiale el nombre** a algo que no sea fácil de adivinar, por ejemplo `kali-api-7q3m`. Ese nombre lo vas a usar en el paso 5.
3. Comprueba que se ha subido el archivo oculto `.htaccess` de esa carpeta, que protege la configuración.
4. Abre `config.php` dentro de esa carpeta con el editor y rellena los datos del paso 1. Deja `'detras_de_netlify' => true`.

## 3. Hostinger: instalar

1. Abre en el navegador `https://tu-dominio-de-hostinger/kali-api-7q3m/instalar.php`, con el nombre de carpeta que hayas puesto.
2. Escribe tu nombre, tu usuario y tu contraseña de administrador. Se crearán las tablas y tu cuenta.
3. **Borra después `instalar.php`** de esa carpeta.

## 4. Netlify: crear la cuenta

Crea una cuenta gratuita en https://app.netlify.com. Hazlo antes del paso 6: si subes la web sin cuenta, Netlify la borra al cabo de una hora.

## 5. Conectar la web con la API

Abre el archivo `web/_redirects` con cualquier editor de texto y cambia la dirección por la de tu carpeta de Hostinger:

```
/api/*  https://tu-dominio-de-hostinger/kali-api-7q3m/:splat  200
```

Respeta los espacios y deja `:splat  200` tal cual.

## 6. Netlify: subir la web

1. Con la sesión iniciada en Netlify, ve a **Sites** (o **Projects**) y arrastra la **carpeta `web`** entera a la zona de "Deploy manually" / "Drag and drop".
2. Netlify te dará una dirección del tipo `https://nombre-aleatorio.netlify.app`. Para ponerle un nombre más claro, entra en **Site configuration > Change site name**, por ejemplo `kali-equipo`.
3. Abre esa dirección e inicia sesión con tu usuario de administrador.

**Para actualizar la web más adelante:** entra en el sitio, ve a **Deploys** y arrastra de nuevo la carpeta `web`, con tu `_redirects` ya editado. Cada actualización gasta parte del cupo gratuito mensual de Netlify, pero para el uso de un bar sobra.

Si en lugar de la dirección de Netlify quieres usar un dominio propio (por ejemplo `equipo.barkali.es`), se configura en **Domain management**.

## 7. Primeros pasos

1. **Fija la ubicación del bar.** Viene puesta una ubicación aproximada del Paseo Marítimo El Pedregal, 62. Ve al bar con el móvil, entra en **Ajustes**, pulsa **Usar mi ubicación actual** y guarda. Hasta que lo hagas, la pantalla **Hoy** muestra un aviso y los avisos de "fuera de zona" no son fiables. Revisa también el radio permitido (150 m por defecto) y la tarifa general.
2. **Fichar solo desde el bar.** En **Ajustes > Control** está marcada por defecto la opción "Solo se puede fichar la entrada y la salida desde el bar". Con ella, nadie puede fichar la entrada ni la salida si su móvil está fuera del radio permitido, ni si el móvil da una ubicación tan imprecisa que no permite comprobarlo. Si un trabajador se marcha sin fichar la salida, la corriges tú desde **Fichajes > Editar**. Si instalaste la app antes de este cambio, marca esa casilla y guarda.
3. En **Equipo**, crea las cuentas de los trabajadores. Al crear cada cuenta, la app te muestra la dirección, el usuario y la contraseña que tienes que entregarles.
4. En **Turnos**, prepara el cuadrante de la semana.

Para fichar más rápido, los trabajadores pueden añadir la web a la pantalla de inicio del móvil: en Safari, Compartir > Añadir a pantalla de inicio; en Chrome, menú > Añadir a pantalla de inicio.

## El logo

El logo provisional está en `web/img/logo.png`. Para poner el logo real de Kali, sustituye ese archivo por otro con el **mismo nombre**: una imagen PNG cuadrada, idealmente de 512 × 512 píxeles. Después vuelve a subir la carpeta `web` a Netlify.

## Avisos en el móvil del administrador

Cada vez que alguien fiche la entrada o la salida, a los administradores que lo activen les llega una notificación en el móvil, aunque tengan la app cerrada. Por ejemplo: "Marta Ruiz ha fichado la entrada · 18:02 · En el local". Si alguien ficha lejos del bar, el aviso lo indica.

Para activarlos en un **iPhone** (iOS 16.4 o posterior):

1. Abre la web en Safari, pulsa **Compartir > Añadir a pantalla de inicio** y abre la app desde ese icono. En una pestaña normal de Safari, el iPhone no permite notificaciones.
2. Inicia sesión con tu usuario de administrador y entra en **Ajustes > Avisos en este móvil**.
3. Pulsa **Activar avisos** y acepta el permiso.
4. Pulsa **Enviar aviso de prueba** para comprobar que llega.

En **Android** se activa igual desde Chrome, sin necesidad de instalar la app. Puedes activarlos en varios móviles, y cada administrador recibe los suyos. Si algún día dejan de llegar, pulsa **Desactivar en este móvil** y vuelve a activarlos.

Los avisos los envía la API de Hostinger, sin servicios de terceros de pago. Las claves de seguridad se generan solas la primera vez.

## Requisitos

- **HTTPS en Netlify y en Hostinger.** Netlify lo pone solo. En Hostinger se activa en **hPanel > Seguridad > SSL** para el dominio donde está la API; Hostinger lo incluye gratis.
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
