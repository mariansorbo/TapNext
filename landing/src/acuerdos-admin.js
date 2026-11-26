// Solapa "Acuerdos" del admin: genera el link de firma para un comercio (con los
// parámetros por defecto editables), lo copia o arma el mensaje de WhatsApp, y
// lista los acuerdos con su estado. Backend: server/acuerdos.js.
// El envío del link lo hace el admin a mano: acá nunca se manda nada solo.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pesos = (n) => `$${Math.round(Number(n)).toLocaleString('es-AR')}`;
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const ESTADOS = { enviado: 'Link enviado', firmado: 'Firmado · falta anticipo', pagado: 'Firmado y pagado', vencido: 'Link vencido', anulado: 'Anulado' };

// Campos de los parámetros: [clave, etiqueta, tipo]. El texto del contrato los usa todos.
const CAMPOS = [
  ['precioRendicion', 'Precio de rendición ($/u)', 'number'],
  ['plazoDias', 'Plazo de rendición (días)', 'number'],
  ['unidIg', 'Llaveros Instagram', 'number'],
  ['unidWpp', 'Llaveros WhatsApp', 'number'],
  ['muestras', 'Muestras (cantidad)', 'number'],
  ['muestrasDetalle', 'Detalle de muestras (opcional)', 'text'],
  ['anticipo', 'Anticipo ($)', 'number'],
  ['precioSugeridoDesde', 'Precio sugerido desde ($)', 'number'],
  ['precioSugeridoHasta', 'Precio sugerido hasta ($)', 'number'],
  ['tasaMoraMensual', 'Interés por mora (% mensual simple)', 'number'],
  ['diasReclamoFabrica', 'Días para reclamar falla de fábrica', 'number'],
  ['preavisoDias', 'Preaviso para terminar (días)', 'number'],
  ['valorReposicionStand', 'Valor de reposición del stand ($) *', 'number'],
  ['valorReposicionMuestra', 'Valor de reposición por muestra ($) *', 'number'],
  ['jurisdiccion', 'Jurisdicción', 'text'],
  ['noCompetenciaMeses', 'No desarrollar producto equivalente (meses después)', 'number'],
  ['confidencialidadMeses', 'Confidencialidad (meses después)', 'number'],
  ['penalidad', 'Penalidad por copiar o competir ($, opcional)', 'number'],
];

async function copiar(texto, btn) {
  try {
    await navigator.clipboard.writeText(texto);
    const original = btn.textContent;
    btn.textContent = 'Copiado ✓';
    setTimeout(() => (btn.textContent = original), 1500);
  } catch {
    window.prompt('Copiá esto:', texto);
  }
}

export function initAcuerdosAdmin({ api }) {
  const raiz = document.getElementById('acuerdos-tab');
  let cargado = false;
  let defaults = {};

  raiz.innerHTML = `
    <div class="admin-section">
      <div class="admin-section-head"><h3>Nuevo acuerdo</h3></div>
      <p class="section-lead">Cada valor viene con su default y lo podés cambiar para este comercio. Los campos con * hay que completarlos. Al generar el link los valores quedan congelados.</p>
      <div class="modal-form" id="ac-ad-form">
        <label><span>Nombre del comercio</span><input id="ac-ad-comercio" maxlength="120"></label>
        <label><span>Mail o WhatsApp del comercio (acá llega el código)</span><input id="ac-ad-email" maxlength="160" placeholder="mail@comercio.com  o  11 2263 6101"></label>
        <label><span>Teléfono (opcional)</span><input id="ac-ad-tel" maxlength="40"></label>
        <label><span>El link vence en (días)</span><input id="ac-ad-dias" type="number" min="1" max="60" value="7"></label>
        <label><span>No vender equivalentes de otras marcas mientras dure el acuerdo</span>
          <select id="ac-ad-excl"><option value="true">Sí</option><option value="false">No</option></select></label>
        <label><span>Anticipo reembolsable</span>
          <select id="ac-ad-reemb"><option value="true">Sí — se devuelve el saldo a favor</option><option value="false">No</option></select></label>
        <div id="ac-ad-campos" class="ac-ad-campos"></div>
        <button type="button" class="btn-primary panel-btn" id="ac-ad-generar" style="width:auto;">Generar link</button>
        <p class="modal-status" id="ac-ad-status"></p>
      </div>
      <div id="ac-ad-resultado" hidden>
        <p class="section-lead"><b>Link generado.</b> Copialo o mandalo por WhatsApp (lo enviás vos, no se manda solo):</p>
        <input id="ac-ad-link" readonly style="width:100%">
        <textarea id="ac-ad-mensaje" rows="4" readonly style="width:100%;margin-top:8px"></textarea>
        <div class="pap-bienvenida-acciones" style="margin-top:8px">
          <button type="button" class="row-btn" id="ac-ad-copiar-link">Copiar link</button>
          <button type="button" class="row-btn" id="ac-ad-copiar-msg">Copiar mensaje</button>
          <a class="row-btn" id="ac-ad-wa" target="_blank" rel="noopener">Abrir WhatsApp</a>
        </div>
      </div>
    </div>
    <div class="admin-section">
      <div class="admin-section-head"><h3>Acuerdos</h3></div>
      <div id="ac-ad-lista"></div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const estado = (texto, error = false) => {
    const el = $('ac-ad-status');
    el.className = `modal-status${error ? ' is-error' : texto ? ' is-success' : ''}`;
    el.textContent = texto;
  };

  function pintarCampos() {
    $('ac-ad-campos').innerHTML = CAMPOS.map(([k, label, tipo]) => {
      const v = defaults[k];
      return `<label><span>${esc(label)}</span><input data-param="${k}" type="${tipo}" value="${v === null || v === undefined ? '' : esc(v)}" ${tipo === 'number' ? 'min="0" step="any"' : ''}></label>`;
    }).join('');
    $('ac-ad-reemb').value = String(defaults.anticipoReembolsable !== false);
    $('ac-ad-excl').value = String(defaults.exclusividadVenta !== false);
  }

  async function generar() {
    estado('');
    const params = { anticipoReembolsable: $('ac-ad-reemb').value === 'true', exclusividadVenta: $('ac-ad-excl').value === 'true' };
    for (const input of raiz.querySelectorAll('[data-param]')) params[input.dataset.param] = input.value;
    try {
      const r = await api('/acuerdos', {
        method: 'POST',
        body: JSON.stringify({
          comercio: $('ac-ad-comercio').value,
          contacto: $('ac-ad-email').value,
          telefono: $('ac-ad-tel').value,
          diasValidez: Number($('ac-ad-dias').value) || 7,
          params,
        }),
      });
      $('ac-ad-link').value = r.link;
      $('ac-ad-mensaje').value = r.mensaje;
      const tel = $('ac-ad-tel').value.replace(/\D/g, '');
      $('ac-ad-wa').href = `https://wa.me/${tel}?text=${encodeURIComponent(r.mensaje)}`;
      $('ac-ad-resultado').hidden = false;
      estado('Listo: link generado.');
      await listar();
    } catch (err) {
      estado(err.message, true);
    }
  }

  async function listar() {
    const { acuerdos } = await api('/acuerdos');
    const caja = $('ac-ad-lista');
    if (!acuerdos.length) {
      caja.innerHTML = '<p class="admin-empty">Todavía no hay acuerdos.</p>';
      return;
    }
    caja.innerHTML = `<table><thead><tr><th>Comercio</th><th>Contacto</th><th>Estado</th><th>Lote</th><th>Anticipo</th><th>Creado</th><th></th></tr></thead><tbody>${acuerdos
      .map(
        (a) => `<tr>
        <td>${esc(a.comercio)}</td><td>${esc(a.canal === 'whatsapp' ? `WhatsApp ${a.contacto}` : a.contacto)}</td><td>${esc(ESTADOS[a.estado] || a.estado)}</td>
        <td>${a.unidades} u</td><td>${pesos(a.anticipo)}</td><td>${fecha(a.creadoEn)}</td>
        <td>
          ${a.link ? `<button type="button" class="row-btn" data-copiar="${esc(a.link)}">Copiar link</button>` : ''}
          ${a.estado === 'firmado' ? `<button type="button" class="row-btn" data-pagado="${a.id}">Anticipo recibido</button>` : ''}
          ${a.estado === 'enviado' || a.estado === 'firmado' ? `<button type="button" class="row-btn" data-anular="${a.id}">Anular</button>` : ''}
        </td></tr>`
      )
      .join('')}</tbody></table>`;
  }

  raiz.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.id === 'ac-ad-generar') await generar();
      else if (b.id === 'ac-ad-copiar-link') await copiar($('ac-ad-link').value, b);
      else if (b.id === 'ac-ad-copiar-msg') await copiar($('ac-ad-mensaje').value, b);
      else if (b.dataset.copiar) await copiar(b.dataset.copiar, b);
      else if (b.dataset.pagado) {
        if (!confirm('¿Confirmás que ya recibiste el anticipo?')) return;
        await api(`/acuerdos/${b.dataset.pagado}/anticipo-pagado`, { method: 'POST', body: JSON.stringify({ via: 'transferencia' }) });
        await listar();
      } else if (b.dataset.anular) {
        if (!confirm('¿Anular este acuerdo? El link deja de funcionar.')) return;
        await api(`/acuerdos/${b.dataset.anular}/anular`, { method: 'POST', body: '{}' });
        await listar();
      }
    } catch (err) {
      alert(err.message);
    }
  });

  return {
    async abrir() {
      if (cargado) return listar();
      try {
        defaults = (await api('/acuerdos/defaults')).defaults;
        pintarCampos();
        cargado = true;
        await listar();
      } catch (err) {
        raiz.insertAdjacentHTML('afterbegin', `<p class="modal-status is-error">${esc(err.message)}</p>`);
      }
    },
  };
}
