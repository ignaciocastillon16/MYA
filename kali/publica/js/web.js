// Kali Pedregalejo - pequeno comportamiento de la pagina
document.documentElement.classList.add('js');

const cabecera = document.getElementById('cabecera');
const menu = document.getElementById('menu');
const menuBoton = document.getElementById('menu-boton');

// Cabecera con fondo al bajar
function actualizarCabecera() {
  cabecera.classList.toggle('solida', window.scrollY > 40);
}
window.addEventListener('scroll', actualizarCabecera, { passive: true });
actualizarCabecera();

// Menu en el movil
function cerrarMenu() {
  menu.classList.remove('abierto');
  cabecera.classList.remove('menu-abierto');
  menuBoton.setAttribute('aria-expanded', 'false');
  menuBoton.setAttribute('aria-label', 'Abrir menú');
}
menuBoton.addEventListener('click', () => {
  const abrir = !menu.classList.contains('abierto');
  menu.classList.toggle('abierto', abrir);
  cabecera.classList.toggle('menu-abierto', abrir);
  menuBoton.setAttribute('aria-expanded', String(abrir));
  menuBoton.setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
});
menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', cerrarMenu));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenu(); });

// Aparicion suave de las secciones
const elementos = document.querySelectorAll('.aparece');
if ('IntersectionObserver' in window) {
  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add('visible');
        observador.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.15 });
  elementos.forEach((el) => observador.observe(el));
} else {
  elementos.forEach((el) => el.classList.add('visible'));
}

// El mapa de Google solo se carga si la persona lo pide
document.getElementById('mapa-cargar').addEventListener('click', () => {
  const iframe = document.createElement('iframe');
  iframe.src = 'https://www.google.com/maps?q=' + encodeURIComponent('Kali Pedregalejo, Paseo Marítimo El Pedregal 62, Málaga') + '&output=embed';
  iframe.title = 'Mapa: Kali Pedregalejo';
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'no-referrer-when-downgrade';
  const mapa = document.getElementById('mapa');
  mapa.innerHTML = '';
  mapa.appendChild(iframe);
});

document.getElementById('anio').textContent = new Date().getFullYear();
