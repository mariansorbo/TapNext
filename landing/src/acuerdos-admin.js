// Solapa "Acuerdos" del admin: genera el link de firma para un comercio (con los
// valores por defecto editables), y lista los acuerdos como tarjetas que se abren
// para ver el detalle. Pensada primero para celular. Backend: server/acuerdos.js.
// El envío del link lo hace el admin a mano: acá nunca se manda nada solo.

import './acuerdos-admin.css';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pesos = (n) => `$${Math.round(Number(n)).toLocaleString('es-AR')}`;
const fmt = (v, conHora = false) => {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T12:00:00`) : new Date(v);
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}) });
};

const ESTADOS = { enviado: 'Por firmar', firmado: 'Falta anticipo', pagado: 'Firmado y pagado', vencido: 'Link vencido', anulado: 'Anulado' };
const FILTROS = [
  ['todos', 'Todos', () => true],
  ['porfirmar', 'Por firmar', (a) => a.estado === 'enviado'],
  ['anticipo', 'Falta anticipo', (a) => a.estado === 'firmado'],
  ['pagados', 'Pagados', (a) => a.estado === 'pagado'],
];

// Campos del formulario, por grupo: [clave, etiqueta, tipo, ayuda?]. Los tipos son number | text | date | bool.
// `fuera: true` = no es un parámetro del contrato (se manda aparte).
const GRUPOS = [
  { titulo: 'Lote y kit', campos: [
    ['unidIg', 'Llaveros de Instagram', 'number'],
    ['unidWpp', 'Llaveros de WhatsApp', 'number'],
    ['muestras', 'Muestras (cantidad)', 'number'],
    ['muestrasDetalle', 'Detalle de muestras (opcional)', 'text'],
    ['valorReposicionStand', 'Reposición del stand ($) *', 'number', 'Lo que te cuesta rehacerlo.'],
    ['valorReposicionMuestra', 'Reposición por muestra ($) *', 'number', 'Lo que te cuesta reponer una.'],
  ] },
  { titulo: 'Plata', campos: [
    ['precioRendicion', 'Precio de rendición ($ por unidad)', 'number'],
    ['anticipo', 'Anticipo ($)', 'number'],
    ['anticipoReembolsable', 'Anticipo reembolsable', 'bool', 'Sí: se devuelve el saldo a favor.'],
    ['precioSugeridoDesde', 'Precio sugerido desde ($)', 'number'],
    ['precioSugeridoHasta', 'Precio sugerido hasta ($)', 'number'],
    ['tasaMoraMensual', 'Interés por mora (% mensual simple)', 'number'],
  ] },
  { titulo: 'Fechas y plazos', campos: [
    ['fechaEntrega', 'Fecha de entrega prevista', 'date', 'Con ella el contrato dice el día exacto de cobro.'],
    ['plazoDias', 'Plazo de rendición (días)', 'number'],
    ['diasValidez', 'El link vence en (días)', 'number', '', { fuera: true, valor: 7 }],
    ['diasReclamoFabrica', 'Días para reclamar falla de fábrica', 'number'],
    ['preavisoDias', 'Preaviso para terminar (días)', 'number'],
  ] },
  { titulo: 'Protección de la idea', campos: [
    ['exclusividadVenta', 'No vender equivalentes de otras marcas', 'bool', 'Mientras dure el acuerdo.'],
    ['noCompetenciaMeses', 'No desarrollar producto equivalente (meses después)', 'number'],
    ['confidencialidadMeses', 'Confidencialidad (meses después)', 'number'],
    ['penalidad', 'Penalidad por copiar o competir ($, opcional)', 'number'],
    ['jurisdiccion', 'Jurisdicción', 'text'],
  ] },
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

const campoHtml = ([k, label, tipo, ayuda = '', extra = {}], defaults) => {
  const v = extra.valor ?? defaults[k];
  const control =
    tipo === 'bool'
      ? `<select data-param="${k}"><option value="true"${v !== false ? ' selected' : ''}>Sí</option><option value="false"${v === false ? ' selected' : ''}>No</option></select>`
      : `<input data-param="${k}" ${extra.fuera ? 'data-fuera="1"' : ''} type="${tipo}" value="${v === null || v === undefined ? '' : esc(v)}" ${tipo === 'number' ? 'inputmode="decimal" min="0" step="any"' : ''}>`;
  return `<label class="ac-ad-campo"><span>${esc(label)}</span>${control}${ayuda ? `<small>${esc(ayuda)}</small>` : ''}</label>`;
};

const fila = (dt, dd, fuerte = false) => (dd === null || dd === undefined || dd === '' ? '' : `<div><dt>${esc(dt)}</dt><dd${fuerte ? ' class="ac-fuerte"' : ''}>${dd}</dd></div>`);

export function initAcuerdosAdmin({ api }) {
  const raiz = document.getElementById('acuerdos-tab');
  let cargado = false;
  let defaults = {};
  let lista = [];
  let filtro = 'todos';
  const abiertas = new Set();

  raiz.innerHTML = `
    <div class="ac-ad-bloque">
      <details class="ac-ad-nuevo" id="ac-ad-nuevo">
        <summary>+ Nuevo acuerdo</summary>
        <div class="ac-ad-form">
          <p class="ac-ad-aviso">Los valores ya vienen cargados y los podés cambiar para este comercio. Los campos con * hay que completarlos. Al generar el link quedan congelados.</p>
          <div class="ac-ad-esenciales">
            <label class="ac-ad-campo"><span>Nombre del comercio</span><input id="ac-ad-comercio" maxlength="120" autocomplete="off"></label>
            <label class="ac-ad-campo"><span>Mail o WhatsApp del comercio</span><input id="ac-ad-email" maxlength="160" autocomplete="off" placeholder="mail@comercio.com  o  11 2263 6101"><small>Ahí le llega el código para firmar.</small></label>
            <label class="ac-ad-campo"><span>Teléfono (opcional)</span><input id="ac-ad-tel" maxlength="40" inputmode="tel" autocomplete="off"><small>Si el contacto es un mail, se usa para abrir su chat de WhatsApp.</small></label>
          </div>
          <div id="ac-ad-grupos"></div>
          <button type="button" class="ac-ad-btn ac-ad-btn--primario" id="ac-ad-generar">Generar link</button>
          <p class="ac-ad-estado" id="ac-ad-status" role="status"></p>
        </div>
        <div class="ac-ad-resultado" id="ac-ad-resultado" hidden>
          <b>Link generado</b>
          <p class="ac-ad-aviso">Lo mandás vos, no se envía solo.</p>
          <input id="ac-ad-link" readonly>
          <textarea id="ac-ad-mensaje" rows="4" readonly></textarea>
          <div class="ac-ad-acciones">
            <a class="ac-ad-btn ac-ad-btn--primario" id="ac-ad-wa" target="_blank" rel="noopener">Abrir en WhatsApp Web</a>
            <button type="button" class="ac-ad-btn" id="ac-ad-copiar-link">Copiar link</button>
            <button type="button" class="ac-ad-btn" id="ac-ad-copiar-msg">Copiar mensaje</button>
          </div>
        </div>
      </details>
    </div>
    <div class="ac-ad-bloque">
      <h3 class="ac-ad-titulo">Acuerdos</h3>
      <div class="ac-ad-filtros" id="ac-ad-filtros" role="tablist"></div>
      <div class="ac-ad-lista" id="ac-ad-lista"></div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const estado = (texto, error = false) => {
    const el = $('ac-ad-status');
    el.className = `ac-ad-estado${error ? ' is-error' : texto ? ' is-ok' : ''}`;
    el.textContent = texto;
  };

  function pintarFormulario() {
    $('ac-ad-grupos').innerHTML = GRUPOS.map(
      (g, i) => `<details class="ac-ad-grupo"${i === 0 ? ' open' : ''}><summary>${esc(g.titulo)}</summary><div class="ac-ad-grupo-campos">${g.campos.map((c) => campoHtml(c, defaults)).join('')}</div></details>`
    ).join('');
  }

  function pintarFiltros() {
    $('ac-ad-filtros').innerHTML = FILTROS.map(([id, label, fn]) => {
      const n = lista.filter(fn).length;
      return `<button type="button" class="ac-ad-chip${filtro === id ? ' is-activo' : ''}" data-filtro="${id}">${label} (${n})</button>`;
    }).join('');
  }

  function pintarLista() {
    pintarFiltros();
    const fn = FILTROS.find((f) => f[0] === filtro)[2];
    const items = lista.filter(fn);
    $('ac-ad-lista').innerHTML = items.length
      ? items.map(tarjeta).join('')
      : `<p class="ac-ad-vacio">${lista.length ? 'No hay acuerdos en este filtro.' : 'Todavía no hay acuerdos.'}</p>`;
    for (const id of abiertas) {
      const card = raiz.querySelector(`.ac-card[data-id="${id}"]`);
      if (card) abrirTarjeta(card, true);
    }
  }

  const tarjeta = (a) => {
    const sub = [`${a.unidades} u`, `${pesos(a.anticipo)} de anticipo`, a.diaCobro ? `Cobro: ${fmt(a.diaCobro)}` : `Creado ${fmt(a.creadoEn)}`];
    return `<article class="ac-card" data-id="${a.id}">
      <button type="button" class="ac-card-head" aria-expanded="false" data-toggle="${a.id}">
        <span class="ac-card-main"><b>${esc(a.comercio)}</b><small>${esc(sub.join(' · '))}</small></span>
        <span class="ac-badge ac-badge--${a.estado}">${esc(ESTADOS[a.estado] || a.estado)}</span>
        <span class="ac-chev" aria-hidden="true">›</span>
      </button>
      <div class="ac-card-body" hidden></div>
    </article>`;
  };

  async function abrirTarjeta(card, forzarAbierta = false) {
    const id = card.dataset.id;
    const head = card.querySelector('.ac-card-head');
    const body = card.querySelector('.ac-card-body');
    const abrir = forzarAbierta || head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(abrir));
    body.hidden = !abrir;
    if (!abrir) return abiertas.delete(id);
    abiertas.add(id);
    body.innerHTML = '<p class="ac-ad-vacio">Cargando…</p>';
    try {
      body.innerHTML = detalleHtml(await api(`/acuerdos/${id}`));
    } catch (err) {
      body.innerHTML = `<p class="ac-ad-estado is-error">${esc(err.message)}</p>`;
    }
  }

  function detalleHtml(d) {
    const a = d.acuerdo;
    const p = a.params;
    const f = d.firma;
    const contacto = a.canal === 'whatsapp' ? `WhatsApp ${a.contacto}` : a.contacto;
    const wa = d.whatsapp ? `phone=${d.whatsapp}&` : '';
    const acciones = [];
    if (d.link) {
      acciones.push(`<a class="ac-ad-btn ac-ad-btn--primario" target="_blank" rel="noopener" href="https://web.whatsapp.com/send?${wa}text=${encodeURIComponent(d.mensaje)}">Abrir en WhatsApp Web</a>`);
      acciones.push(`<button type="button" class="ac-ad-btn" data-copiar="${esc(d.link)}">Copiar link</button>`);
      acciones.push(`<button type="button" class="ac-ad-btn" data-copiar="${esc(d.mensaje)}">Copiar mensaje</button>`);
    }
    if (a.estado === 'firmado') acciones.push(`<button type="button" class="ac-ad-btn ac-ad-btn--primario" data-pagado="${a.id}">Anticipo recibido</button>`);
    if (a.estado === 'enviado' || a.estado === 'firmado')
      acciones.push(`<button type="button" class="ac-ad-btn ac-ad-btn--peligro" data-anular="${a.id}">Anular</button>`);

    return `
      <div class="ac-sec"><h4>Estado</h4><dl class="ac-dl">
        ${fila('Creado', fmt(a.creado_en, true))}
        ${a.estado === 'enviado' ? fila('El link vence', fmt(a.expira)) : ''}
        ${fila('Firmado', a.firmado_en ? fmt(a.firmado_en, true) : '')}
        ${fila('Anticipo recibido', a.anticipo_pagado_en ? `${fmt(a.anticipo_pagado_en, true)} (${esc(a.anticipo_via || '')})` : '')}
        ${fila('Contacto', esc(contacto))}
        ${fila('Teléfono', esc(a.telefono))}
      </dl></div>
      <div class="ac-sec"><h4>Qué se acordó</h4><dl class="ac-dl">
        ${fila('Lote', `${p.unidIg} de Instagram + ${p.unidWpp} de WhatsApp (${p.unidIg + p.unidWpp} u)`)}
        ${fila('Muestras', `${p.muestras}${p.muestrasDetalle ? ` — ${esc(p.muestrasDetalle)}` : ''}`)}
        ${fila('Precio de rendición', `${pesos(p.precioRendicion)} por unidad`, true)}
        ${fila('Anticipo', `${pesos(p.anticipo)} · ${p.anticipoReembolsable ? 'reembolsable' : 'no reembolsable'}`)}
        ${fila('Entrega prevista', p.fechaEntrega ? fmt(p.fechaEntrega) : 'Sin fecha: se fija en la entrega')}
        ${fila('Día de cobro', d.diaCobro ? fmt(d.diaCobro) : `Entrega + ${p.plazoDias} días`, true)}
        ${fila('Mora', `${p.tasaMoraMensual}% mensual simple`)}
        ${fila('Reposición', `stand ${pesos(p.valorReposicionStand)}${p.muestras ? ` · muestra ${pesos(p.valorReposicionMuestra)}` : ''}`)}
        ${fila('No copiar / competir', `${p.noCompetenciaMeses} meses${p.exclusividadVenta ? ' · exclusividad de venta' : ''}`)}
        ${fila('Penalidad', p.penalidad ? pesos(p.penalidad) : '')}
      </dl></div>
      ${f ? `<div class="ac-sec"><h4>Quién firmó</h4><dl class="ac-dl">
        ${fila('Nombre', esc(f.nombre), true)}
        ${fila('DNI / CUIT', esc(f.documento))}
        ${fila('Domicilio', esc(f.domicilio))}
        ${fila('Local', esc(f.local_nombre))}
        ${fila('Verificó con', esc(f.email_verificado))}
        ${fila('Nombre al pedir el código', esc(f.nombre_verificacion))}
        ${fila('Copia enviada a', esc(f.mail_copia))}
        ${fila('Firma escrita', esc(f.firma_nombre))}
        ${fila('Desde', esc(f.ip))}
        ${fila('Huella del texto', `<code>${esc(String(f.texto_hash).slice(0, 16))}…</code> (v${f.texto_version})`)}
      </dl>
      <details class="ac-contrato"><summary>Ver el contrato firmado</summary><pre>${esc(f.texto_firmado)}</pre></details></div>` : ''}
      ${acciones.length ? `<div class="ac-ad-acciones">${acciones.join('')}</div>` : ''}`;
  }

  async function generar() {
    estado('');
    const params = {};
    let diasValidez = 7;
    for (const el of raiz.querySelectorAll('[data-param]')) {
      const k = el.dataset.param;
      if (el.dataset.fuera) diasValidez = Number(el.value) || 7;
      else params[k] = el.tagName === 'SELECT' ? el.value === 'true' : el.value;
    }
    try {
      const r = await api('/acuerdos', {
        method: 'POST',
        body: JSON.stringify({ comercio: $('ac-ad-comercio').value, contacto: $('ac-ad-email').value, telefono: $('ac-ad-tel').value, diasValidez, params }),
      });
      $('ac-ad-link').value = r.link;
      $('ac-ad-mensaje').value = r.mensaje;
      // WhatsApp Web directo con el chat del comercio y el mensaje escrito (sin número abre el selector de chats).
      const wa = r.whatsapp ? `phone=${r.whatsapp}&` : '';
      $('ac-ad-wa').href = `https://web.whatsapp.com/send?${wa}text=${encodeURIComponent(r.mensaje)}`;
      $('ac-ad-resultado').hidden = false;
      $('ac-ad-resultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      estado('Listo: link generado.');
      await listar();
    } catch (err) {
      estado(err.message, true);
    }
  }

  async function listar() {
    lista = (await api('/acuerdos')).acuerdos;
    pintarLista();
  }

  raiz.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-filtro]');
    if (chip) {
      filtro = chip.dataset.filtro;
      return pintarLista();
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) return abrirTarjeta(toggle.closest('.ac-card'));
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
        pintarFormulario();
        cargado = true;
        await listar();
      } catch (err) {
        raiz.insertAdjacentHTML('afterbegin', `<p class="ac-ad-estado is-error">${esc(err.message)}</p>`);
      }
    },
  };
}
