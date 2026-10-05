# Área de equipo de MYA: instalación

El área de equipo está en la carpeta `equipo/`. Es una web estática (HTML, CSS y JavaScript), así que se sube al mismo hosting que la web pública. Los datos, las cuentas y la seguridad los gestiona **Supabase**, una base de datos en la nube con un plan gratuito que basta para un restaurante.

La dirección será `https://tudominio/equipo/`. No hay ningún enlace a ella desde la web pública y los buscadores tienen prohibido indexarla. Además, nadie puede ver ni modificar datos sin iniciar sesión.

> **No subas la carpeta `supabase/` al hosting.** Solo contiene instrucciones y código para Supabase.

---

## 1. Crear el proyecto en Supabase

1. Crea una cuenta en https://supabase.com y pulsa **New project**.
2. Ponle un nombre (por ejemplo `mya-equipo`), elige una contraseña para la base de datos y, en la región, una de Europa (**West EU / Frankfurt / Paris**).
3. Espera a que el proyecto termine de crearse.

## 2. Crear las tablas

1. En el menú izquierdo, abre **SQL Editor** y pulsa **New query**.
2. Pega todo el contenido de `supabase/schema.sql` y pulsa **Run**.

Puedes volver a ejecutarlo cuando haya actualizaciones. No borra datos.

## 3. Cerrar el registro público

En **Authentication > Sign In / Providers**:

- Desactiva **Allow new users to sign up**. Así solo el administrador puede crear cuentas.
- Desactiva **Confirm email**. Los trabajadores no usan correo: entran con un nombre de usuario.

Aunque se te olvide este paso, la base de datos deja desactivada cualquier cuenta que no haya creado el administrador.

## 4. Instalar la función de gestión de cuentas

La usa el panel de administración para crear trabajadores, cambiar contraseñas y desactivar cuentas.

**Desde el navegador:** abre **Edge Functions > Deploy a new function > Via Editor**, llámala exactamente `admin-usuarios`, pega el contenido de `supabase/functions/admin-usuarios/index.ts` y pulsa **Deploy**.

**O desde un terminal**, si tienes Node instalado:

```
npx supabase login
npx supabase functions deploy admin-usuarios --project-ref TU_REFERENCIA
```

## 5. Crear tu cuenta de administrador

1. Abre **Authentication > Users > Add user > Create new user**.
2. En el correo escribe `andres@equipo.myapedregalejo.es` (cambia `andres` por el nombre de usuario que quieras usar). Pon una contraseña y marca **Auto Confirm User**.
3. En **SQL Editor**, ejecuta lo siguiente, con tu usuario y tu nombre:

```sql
update public.perfiles
   set rol = 'admin', activo = true, nombre = 'Andrés'
 where usuario = 'andres';
```

El correo no tiene que existir. Solo sirve como identificador interno y nunca se envía nada.

## 6. Conectar la web con Supabase

En **Project Settings > API** copia la **Project URL** y la clave **anon public**, y pégalas en `equipo/js/config.js`:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

La clave `anon` es pública por diseño. Lo que protege los datos son las reglas de la base de datos.

## 7. Subir la web

Sube la carpeta `equipo/` a la raíz del hosting, junto a `inicio.html` y la carpeta `img/`, porque el área de equipo usa `img/logo.jpg`.

- La web **tiene que ir por HTTPS**. Si no, el móvil no permite acceder a la ubicación.
- Entra en `https://tudominio/equipo/` con tu usuario de administrador.
- En **Ajustes**, ve al local con el móvil, pulsa **Usar mi ubicación actual** y guarda. Así quedan fijadas las coordenadas exactas del restaurante. Ajusta también el radio permitido (150 m por defecto) y la tarifa general.
- En **Equipo**, crea las cuentas de los trabajadores y entrégales su usuario y su contraseña.

Para fichar más rápido, los trabajadores pueden añadir la página a la pantalla de inicio del móvil: en Safari, Compartir > Añadir a pantalla de inicio; en Chrome, menú > Añadir a pantalla de inicio.

## Uso de un subdominio (opcional)

Si prefieres algo como `equipo.myapedregalejo.es`, crea el subdominio en tu hosting, apúntalo a la carpeta `equipo/` y copia el logo dentro de ella. Después cambia `../img/logo.jpg` por la nueva ruta en los tres archivos HTML y en `manifest.webmanifest`. Para la seguridad da igual una opción que otra.

## Cómo se calcula lo que se debe

- Cada fichaje guarda la tarifa vigente en el momento de la entrada: la propia del trabajador o, si no tiene, la general. Si cambias un sueldo, los fichajes anteriores no cambian, salvo que marques "Aplicar la tarifa también a fichajes anteriores desde...".
- **Pendiente = horas de fichajes cerrados × tarifa + bonificaciones − descuentos − pagos − anticipos.**
- La hora de cada fichaje la pone siempre el servidor, no el móvil. El trabajador no puede adelantarla ni retrasarla.

## Aspectos legales (España)

- El registro diario de jornada es obligatorio (art. 34.9 del Estatuto de los Trabajadores) y hay que conservarlo **4 años**. No elimines fichajes antiguos. Para guardar una copia, usa **Fichajes > Exportar CSV**.
- Para registrar la ubicación al fichar, hay que **informar a los trabajadores por escrito** de que se recoge y para qué se usa (art. 90 de la LOPDGDD). La ubicación solo se toma en el momento de fichar, nunca durante la jornada.

## Mantenimiento

- En el plan gratuito, Supabase pausa los proyectos que pasan una semana sin ningún uso. Con un uso diario no ocurre.
- Para hacer copias de seguridad: **Fichajes > Exportar CSV** y **Saldos y pagos > Exportar CSV**, o **Database > Backups** en Supabase.
