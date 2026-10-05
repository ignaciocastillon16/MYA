import { sb, emailDeUsuario, mensajeError } from './comun.js';

const formulario = document.getElementById('formulario');
const mensaje = document.getElementById('mensaje');
const boton = document.getElementById('entrar');

async function destinoSegunRol(userId) {
  const { data } = await sb.from('perfiles').select('rol, activo').eq('id', userId).single();
  if (!data || !data.activo) {
    await sb.auth.signOut();
    return null;
  }
  return data.rol === 'admin' ? 'admin.html' : 'panel.html';
}

// Si ya hay sesion abierta, entrar directamente
const { data: { session } } = await sb.auth.getSession();
if (session) {
  const destino = await destinoSegunRol(session.user.id);
  if (destino) location.replace(destino);
}

formulario.addEventListener('submit', async (e) => {
  e.preventDefault();
  mensaje.hidden = true;
  const usuario = formulario.usuario.value.trim();
  const password = formulario.password.value;
  if (!usuario || !password) {
    mensaje.textContent = 'Introduce tu usuario y contraseña.';
    mensaje.hidden = false;
    return;
  }
  boton.disabled = true;
  boton.textContent = 'Comprobando...';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: emailDeUsuario(usuario), password });
    if (error) {
      throw new Error(/invalid|credentials/i.test(error.message)
        ? 'Usuario o contraseña incorrectos.'
        : /banned/i.test(error.message) ? 'Esta cuenta está desactivada.' : error.message);
    }
    const destino = await destinoSegunRol(data.user.id);
    if (!destino) throw new Error('Esta cuenta está desactivada.');
    location.replace(destino);
  } catch (err) {
    mensaje.textContent = mensajeError(err);
    mensaje.hidden = false;
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});
