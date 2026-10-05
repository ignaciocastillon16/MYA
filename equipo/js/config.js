// Datos del proyecto de Supabase (Project Settings > API).
// La clave "anon" es publica por diseno: la seguridad la garantizan las reglas RLS de la base de datos.
export const CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-CLAVE-ANON',
  // Debe coincidir con DOMINIO_USUARIOS de la funcion admin-usuarios.
  // Es interno: los trabajadores solo escriben su nombre de usuario, nunca se envian correos.
  DOMINIO_USUARIOS: 'equipo.myapedregalejo.es',
  ZONA_HORARIA: 'Europe/Madrid',
};
