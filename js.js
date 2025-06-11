const fotos = document.querySelectorAll('.slide');
const prevBtn = document.querySelector('.prev');
const nextBtn = document.querySelector('.next');
let currentIndex = 0;

function mostrarFoto(index) {
  fotos.forEach((slide, i) => {
    slide.classList.toggle('activo', i === index);
  });
}

prevBtn.addEventListener('click', () => {
  currentIndex = (currentIndex - 1 + fotos.length) % fotos.length;
  mostrarFoto(currentIndex);
});

nextBtn.addEventListener('click', () => {
  currentIndex = (currentIndex + 1) % fotos.length;
  mostrarFoto(currentIndex);
});

// Mostrar la primera imagen al cargar la página
mostrarFoto(currentIndex);