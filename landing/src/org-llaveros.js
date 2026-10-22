// Mi panel → "Llaveros de tu equipo" (solo cuentas de empresa, ver
// server/organizaciones.js): todos los llaveros de la empresa, quién activó
// cada uno (contacto, mail y teléfono) y dos acciones por llavero:
//   desactivar/reactivar  el tap deja de llevar al contacto (y vuelve)
//   resetear              borra a la persona y su contacto: queda listo para
//                         que lo active otra (por ejemplo, alguien que entra)

const ESTADOS = {
  activo: 'Activo',
  sin_activar: 'Sin activar',
  desactivado: 'Desactivado',
};
const TIPOS = { whatsapp: 'WhatsApp', instagram: 'Instagram' };

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// El destino tal como lo reconoce la gente: @usuario, +número o el link.
function destinoLegible(d) {
  if (!d) return null;
  const v = String(d.valor || '');
  if (d.tipo === 'instagram' && !/^https?:/i.test(v)) return v.startsWith('@') ? v : `@${v}`;
  if (d.tipo === 'whatsapp' && /^\d+$/.test(v)) return `+${v}`;
  return v;
}

const fecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

export function initOrgLlaveros({ api }) {
  const box = document.getElementById('org-llaveros');
  const resumen = document.getElementById('org-llaveros-resumen');
  const lista = document.getElementById('org-llaveros-lista');
  if (!box) return { cargar: () => {} };

  function pintar(llaveros) {
    box.hidden = false;
    if (!llaveros.length) {
      resumen.textContent = 'Todavía no hay llaveros asignados a tu empresa. Cuando te los entreguemos, los vas a ver acá.';
      lista.innerHTML = '';
      return;
    }
    const n = (e) => llaveros.filter((l) => l.estado === e).length;
    const partes = [`${llaveros.length} llavero${llaveros.length === 1 ? '' : 's'}`, `${n('activo')} activos`];
    if (n('sin_activar')) partes.push(`${n('sin_activar')} sin activar`);
    if (n('desactivado')) partes.push(`${n('desactivado')} desactivado${n('desactivado') === 1 ? '' : 's'}`);
    resumen.textContent = partes.join(' · ');

    lista.innerHTML = llaveros
      .map((l) => {
        const datos = [
          ['Contacto', destinoLegible(l.destino)],
          ['Mail', l.email],
          ['Teléfono', l.telefono],
          ['Activo desde', fecha(l.desde)],
        ].filter(([, v]) => v);
        return `
        <article class="org-llavero" data-codigo="${esc(l.codigo)}">
          <header>
            <span class="org-llavero-codigo">${esc(l.codigo)}</span>
            ${l.funcion ? `<span class="org-llavero-tipo">${esc(TIPOS[l.funcion] || l.funcion)}</span>` : ''}
            <span class="org-llavero-estado is-${l.estado}">${ESTADOS[l.estado] || l.estado}</span>
          </header>
          ${
            datos.length
              ? `<dl>${datos.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
              : '<p class="org-llavero-vacio">Nadie lo activó todavía.</p>'
          }
          <div class="org-llavero-acciones">
            ${
              l.estado === 'desactivado'
                ? '<button type="button" class="btn-ghost" data-accion="reactivar">Reactivar</button>'
                : '<button type="button" class="btn-ghost" data-accion="desactivar">Desactivar</button>'
            }
            ${l.estado !== 'sin_activar' ? '<button type="button" class="btn-ghost" data-accion="resetear">Resetear</button>' : ''}
          </div>
          <p class="modal-status" role="status"></p>
        </article>`;
      })
      .join('');
  }

  async function cargar() {
    try {
      const { llaveros } = await api('/me/organizacion/llaveros');
      pintar(llaveros);
    } catch (err) {
      box.hidden = false;
      resumen.textContent = `No pudimos cargar los llaveros: ${err.message}`;
    }
  }

  const CONFIRMAR = {
    desactivar: '¿Desactivar este llavero? Al tocarlo ya no va a llevar al contacto de esa persona. Lo podés reactivar cuando quieras.',
    resetear: '¿Resetear este llavero? Se borran la persona y su contacto, y queda listo para que lo active otra persona. No se puede deshacer.',
  };

  lista?.addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const card = boton.closest('[data-codigo]');
    const accion = boton.dataset.accion;
    if (CONFIRMAR[accion] && !confirm(CONFIRMAR[accion])) return;
    const status = card.querySelector('.modal-status');
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    status.className = 'modal-status';
    status.textContent = 'Un momento…';
    try {
      await api(`/me/organizacion/llaveros/${encodeURIComponent(card.dataset.codigo)}/${accion}`, { method: 'POST' });
      await cargar();
    } catch (err) {
      status.className = 'modal-status is-error';
      status.textContent = err.message;
      card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  });

  return { cargar };
}
