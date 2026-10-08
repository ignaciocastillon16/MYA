import { api, mensajeError } from './comun.js';

const formulario = document.getElementById('formulario');
const mensaje = document.getElementById('mensaje');
const boton = document.getElementById('entrar');

const destino = (perfil) => (perfil.rol === 'admin' ? 'admin.html' : 'panel.html');

// Si ya hay sesion abierta, entrar directamente
try {
  const perfil = await api('sesion');
  location.replace(destino(perfil));
} catch {
  // Sin sesion: se muestra el formulario
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
    const perfil = await api('login', { usuario, password });
    location.replace(destino(perfil));
  } catch (err) {
    mensaje.textContent = mensajeError(err);
    mensaje.hidden = false;
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});
