import './styles.css';
import { applyBrand } from './brand.js';
import { initFaqAccordion } from './faq.js';

applyBrand('Conectá con tus clientes en un toque');
initFaqAccordion();

// Hero tag: cycle through the destinations a tap can open.
const dests = ['WhatsApp', 'Instagram', 'Menú', 'Pago', 'Reseña'];
const tagDest = document.getElementById('tagdest');
let destIndex = 0;

function cycleDest() {
  tagDest.style.opacity = 0;
  setTimeout(() => {
    tagDest.textContent = '→ ' + dests[destIndex % dests.length];
    tagDest.style.opacity = 1;
    destIndex++;
  }, 300);
}

if (tagDest) {
  cycleDest();
  setInterval(cycleDest, 2200);
}
