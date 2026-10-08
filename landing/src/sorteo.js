// Modal del sorteo de Instagram en la home. Se abre solo cuando la visita
// viene del QR del disfraz (?utm_source=disfraz) y queda una pastilla abajo
// para volver a abrirlo. Config en sorteo-config.js; backend en server/sorteo.js.

import { SORTEO, sorteoAbierto } from './sorteo-config.js';
import { evento, obtenerVisitanteId } from './visita.js';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const ACTIVO_KEY = 'nexttap_sorteo_activo'; // vino del QR en esta pestaña
const ANOTADO_KEY = `nexttap_sorteo_${SORTEO.slug}`; // @ con el que ya participó

const leer = (store, key) => {
  try {
    return window[store].getItem(key);
  } catch {
    return null;
  }
};
const escribir = (store, key, valor) => {
  try {
    window[store].setItem(key, valor);
  } catch {
    // storage bloqueado: sigue andando sin recordar
  }
};

const IG_URL = `https://instagram.com/${SORTEO.instagram}`;
const params = new URLSearchParams(window.location.search);
const vieneDelQr = params.get('utm_source') === SORTEO.utmSource || params.has('sorteo');

if (sorteoAbierto() && (vieneDelQr || leer('sessionStorage', ACTIVO_KEY))) {
  escribir('sessionStorage', ACTIVO_KEY, '1');
  montar();
}

function montar() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sorteo-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="modal sorteo-modal" role="dialog" aria-modal="true" aria-labelledby="sorteo-titulo">
      <button type="button" class="modal-close" aria-label="Cerrar">✕</button>

      <div class="sorteo-paso" data-vista="form">
        <div class="sorteo-badge">🎁 Sorteo gratis</div>
        <h3 id="sorteo-titulo">Ganate 2 llaveros NextTap</h3>
        <p class="modal-sub"><b>${SORTEO.ganadores} ganadores</b>, 2 llaveros cada uno: uno que lleva a tu Instagram y otro a tu WhatsApp. Sorteamos el ${SORTEO.fechaSorteoTexto.replace(/ de 2026$/, '')}.</p>

        <ol class="sorteo-pasos">
          <li>
            <span class="sorteo-num">1</span>
            <div><b>Seguinos</b> en Instagram</div>
            <a class="sorteo-seguir" href="${IG_URL}" target="_blank" rel="noopener">Seguir @${SORTEO.instagram}</a>
          </li>
          <li>
            <span class="sorteo-num">2</span>
            <div><b>Anotate</b> acá abajo</div>
          </li>
        </ol>

        <form class="modal-form" novalidate>
          <label>
            <span>Tu usuario de Instagram</span>
            <div class="sorteo-arroba"><span>@</span><input name="instagram" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="tu.usuario" required></div>
          </label>
          <label>
            <span>WhatsApp o mail <small>(solo para avisarte si ganás)</small></span>
            <input name="contacto" type="text" inputmode="email" autocomplete="email" placeholder="11 2345 6789 o vos@mail.com" required>
          </label>
          <input name="web" type="text" class="sorteo-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <label class="modal-check">
            <input name="bases" type="checkbox">
            <span>Acepto las <a href="/sorteo.html" target="_blank">bases del sorteo</a>. Sin obligación de compra.</span>
          </label>
          <button type="submit" class="btn-primary modal-submit">Participar</button>
          <p class="modal-status" role="status"></p>
        </form>
      </div>

      <div class="sorteo-paso" data-vista="listo" hidden>
        <div class="sorteo-badge">✅ Ya estás participando</div>
        <h3>¡Adentro, <span data-handle></span>!</h3>
        <p class="modal-sub">Te avisamos por Instagram y por tu contacto si ganás. Sorteo en vivo el ${SORTEO.fechaSorteoTexto.replace(/ de 2026$/, '')} en @${SORTEO.instagram}.</p>
        <div class="sorteo-extra">
          <b>¿Querés más chances?</b>
          <ul>
            <li><b>+1</b> subí una historia con el cubo y etiquetá <b>@${SORTEO.instagram}</b></li>
            <li><b>+1</b> hacé un posteo etiquetando <b>@${SORTEO.instagram}</b></li>
          </ul>
        </div>
        <a class="sorteo-seguir sorteo-seguir--full" href="${IG_URL}" target="_blank" rel="noopener">Ir a @${SORTEO.instagram}</a>
        <button type="button" class="btn-ghost modal-submit" data-cerrar>Ver cómo funciona el llavero</button>
      </div>
    </div>`;

  const pastilla = document.createElement('button');
  pastilla.type = 'button';
  pastilla.className = 'sorteo-pastilla';
  pastilla.hidden = true;

  document.body.append(overlay, pastilla);

  const form = overlay.querySelector('form');
  const status = form.querySelector('.modal-status');
  const submit = form.querySelector('button[type="submit"]');
  const vistaForm = overlay.querySelector('[data-vista="form"]');
  const vistaListo = overlay.querySelector('[data-vista="listo"]');

  function mostrarListo(handle) {
    overlay.querySelector('[data-handle]').textContent = `@${handle}`;
    vistaForm.hidden = true;
    vistaListo.hidden = false;
    pastilla.textContent = '✅ Participando · Sumá chances';
  }

  function abrir() {
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    pastilla.hidden = true;
  }
  function cerrar() {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    pastilla.hidden = false;
  }

  overlay.querySelector('.modal-close').addEventListener('click', cerrar);
  overlay.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) cerrar();
  });
  pastilla.addEventListener('click', abrir);
  overlay.querySelectorAll('.sorteo-seguir').forEach((a) =>
    a.addEventListener('click', () => evento('sorteo_seguir'))
  );

  const yaAnotado = leer('localStorage', ANOTADO_KEY);
  pastilla.textContent = '🎁 Sorteo: ganate 2 llaveros';
  if (yaAnotado) {
    mostrarListo(yaAnotado);
    cerrar();
  } else {
    // Un instante para que se vea la página detrás: el que escaneó entiende dónde está.
    setTimeout(abrir, 600);
    evento('sorteo_visto');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));
    status.className = 'modal-status';
    if (!datos.instagram.trim()) return error('Poné tu usuario de Instagram.');
    if (!datos.contacto.trim()) return error('Dejanos un WhatsApp o mail para avisarte si ganás.');
    if (!form.bases.checked) return error('Tenés que aceptar las bases.');

    submit.disabled = true;
    status.textContent = 'Anotándote…';
    try {
      const res = await fetch(`${API_BASE}/api/sorteo/participar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instagram: datos.instagram,
          contacto: datos.contacto,
          aceptaBases: true,
          web: datos.web,
          visitanteId: await obtenerVisitanteId(),
        }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'No pudimos anotarte. Probá de nuevo.');
      escribir('localStorage', ANOTADO_KEY, r.instagram);
      evento('sorteo_participo', { yaParticipaba: Boolean(r.yaParticipaba) });
      status.textContent = '';
      mostrarListo(r.instagram);
    } catch (err) {
      error(err.message === 'Failed to fetch' ? 'Sin conexión. Probá de nuevo en un toque.' : err.message);
    } finally {
      submit.disabled = false;
    }
  });

  function error(msg) {
    status.className = 'modal-status is-error';
    status.textContent = msg;
  }
}
