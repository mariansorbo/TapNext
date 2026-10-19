// Aviso informativo de cookies — se carga junto con el Pixel (ver pixel.js), o
// sea en las mismas páginas públicas. NO es un banner de consentimiento: las
// cookies (nt_vid, Pixel, PAP) se cargan igual, esto solo avisa y linkea a
// /privacidad.html. Las condiciones de Meta piden ese aviso visible.
// "Entendido" se recuerda en localStorage; si el navegador no deja guardar,
// el aviso vuelve a aparecer en la próxima página (nunca rompe nada).
const CLAVE = 'nt_aviso_cookies';

function yaLoCerro() {
  try {
    return localStorage.getItem(CLAVE) === '1';
  } catch {
    return false;
  }
}

function mostrarAviso() {
  if (yaLoCerro() || location.pathname.startsWith('/privacidad')) return;

  const aviso = document.createElement('div');
  aviso.className = 'aviso-cookies';
  aviso.setAttribute('role', 'region');
  aviso.setAttribute('aria-label', 'Aviso de cookies');
  aviso.innerHTML = `
    <p>Usamos cookies para medir las visitas y mejorar nuestros anuncios. <a href="/privacidad.html">Más info</a></p>
    <button type="button" class="aviso-cookies-ok">Entendido</button>
  `;
  aviso.querySelector('button').addEventListener('click', () => {
    try {
      localStorage.setItem(CLAVE, '1');
    } catch {
      /* sin storage: se cierra igual en esta página */
    }
    aviso.remove();
  });
  document.body.appendChild(aviso);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mostrarAviso);
} else {
  mostrarAviso();
}
