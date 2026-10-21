import './styles.css';
import './pixel.js';
import './pap.js';
import './visita.js';
import './nav-sesion.js';
import './empresas-demo.js';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';
import { colorMayoritario, paletaPantalla } from './color-logo.js';
import { encuadreAutomatico, colorDeBordes } from './encuadre.js';

applyBrand('Para empresas');
initFaqAccordion();

// "Subís tu logo y listo": tiras de pantallas del tap con logos inventados de
// la página de prueba. Encuadre y fondo calculados igual que el editor de Mi
// panel (src/encuadre.js, src/color-logo.js), sin nada escrito a mano.
const LOGOS = [
  'cafe-brasa.svg',
  'gimnasio-fuerza.svg',
  'vivero-verde-raiz.svg',
  'pixel-norte.svg',
  'sastreria-ortiz.svg',
  'heladeria-polo.svg',
];
const LADO = 300;

const tira = document.getElementById('emp-logos');

function cargar(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function colorDe(canvas) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 128, 128);
  return colorMayoritario(ctx.getImageData(0, 0, 128, 128).data);
}

if (tira) {
  LOGOS.forEach(async (logo) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'emp-logo-pantalla';
    tarjeta.innerHTML = '<div class="emp-org-img"><img alt=""></div><div class="emp-mark">Next<span class="tap">Tap</span></div>';
    tira.appendChild(tarjeta);
    try {
      const cuadro = encuadreAutomatico(await cargar(`/images/prueba-logos/${logo}`)).canvas;
      const chico = document.createElement('canvas');
      chico.width = chico.height = LADO;
      chico.getContext('2d').drawImage(cuadro, 0, 0, LADO, LADO);
      tarjeta.querySelector('img').src = chico.toDataURL('image/png');
      const p = paletaPantalla(colorDe(cuadro), colorDeBordes(cuadro));
      tarjeta.style.setProperty('--fondo', p.fondo);
      tarjeta.style.setProperty('--texto', p.texto);
      tarjeta.style.setProperty('--pista', p.pista);
      tarjeta.style.setProperty('--acento', p.acento);
      tarjeta.style.setProperty('--acento-texto', p.acentoTexto);
      tarjeta.style.setProperty('--sombra', p.sombra);
    } catch {
      tarjeta.remove();
    }
  });
}
