// Modal "Editar sticker" — consola de edición en tanda.
//
// Cargás (o escaneás) un código, ves el estado vigente del chip y corregís
// vendedor / función / modelo sin apretar "siguiente": al guardar, el foco
// vuelve al campo de código y el cambio queda anotado en el log de la pasada.
// Backend: server/consola-sticker.js. Módulo aparte para no entreverar admin.js.

const FUNCION_LABELS = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  pago: 'Pago',
  menu: 'Menú',
  review: 'Reseña',
  web: 'Web propia',
  agenda: 'Agenda',
  linktree: 'LinkTree',
};
const MODELOS = ['llavero', 'tarjeta', 'placa'];

export function initConsolaSticker({ api, getVendedores, onChange }) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('consola-modal-overlay');
  if (!overlay) return;

  const q = $('consola-q');
  const status = $('consola-status');
  const panel = $('consola-panel');
  const estadoBox = $('consola-estado');
  const selVendedor = $('consola-vendedor');
  const selFuncion = $('consola-funcion');
  const selModelo = $('consola-modelo');
  const motivo = $('consola-motivo');
  const btnGuardar = $('consola-guardar');
  const log = $('consola-log');

  let cargado = null; // snapshot del sticker cargado
  let sesion = []; // líneas del log de esta pasada
  let ndefAbort = null;

  const setStatus = (msg, kind) => {
    status.className = 'modal-status' + (kind ? ' is-' + kind : '');
    status.textContent = msg || '';
  };

  const opts = (pairs, actual) =>
    ['<option value="">Sin asignar</option>']
      .concat(
        pairs.map(
          ([v, l]) =>
            `<option value="${v}"${String(v) === String(actual ?? '') ? ' selected' : ''}>${l}</option>`
        )
      )
      .join('');

  function pintarEstado(s) {
    const fila = (k, v) => `<div><b>${k}:</b> ${v ?? '<span class="admin-muted">—</span>'}</div>`;
    estadoBox.innerHTML =
      fila('Código', s.codigoPublico) +
      fila('Estado', s.estado) +
      fila('Etapa', s.etapa) +
      fila(
        'Vendedor',
        s.vendedor ? `${s.vendedor.nombre}${s.vendedor.codigoRef ? ` (${s.vendedor.codigoRef})` : ''}` : null
      ) +
      fila('Función', s.funcion ? FUNCION_LABELS[s.funcion] || s.funcion : null) +
      fila('Modelo', s.modelo) +
      (s.comprador ? fila('Comprador', `${s.comprador.nombre || ''} ${s.comprador.whatsapp}`) : '') +
      (s.bloqueos.length
        ? `<div class="admin-muted" style="margin-top:6px;">⚠️ ${s.bloqueos.join(' ')}</div>`
        : '');
  }

  function pintarLog() {
    if (!sesion.length) {
      log.innerHTML = '';
      return;
    }
    const n = sesion.filter((l) => l.cambio).length;
    log.innerHTML =
      `<p class="section-lead" style="margin:16px 0 6px;">${sesion.length} chip${
        sesion.length === 1 ? '' : 's'
      } en esta pasada · ${n} con cambios</p>` +
      '<table><tbody>' +
      sesion.map((l) => `<tr><td><b>${l.codigo}</b></td><td>${l.texto}</td></tr>`).join('') +
      '</tbody></table>';
  }

  async function cargar() {
    const val = q.value.trim();
    if (!val) return;
    setStatus('Buscando…');
    btnGuardar.disabled = true;
    try {
      const s = await api(`/consola/sticker?q=${encodeURIComponent(val)}`);
      cargado = s;

      const vendPairs = (getVendedores() || []).map((v) => [v.id, `${v.nombre} (${v.codigoRef})`]);
      selVendedor.innerHTML = opts(vendPairs, s.vendedor?.id || '');
      selFuncion.innerHTML = opts(Object.entries(FUNCION_LABELS), s.funcion || '');
      selModelo.innerHTML = opts(
        MODELOS.map((m) => [m, m[0].toUpperCase() + m.slice(1)]),
        s.modelo || ''
      );

      const fijo = (campo) => !s.editable || s.camposFijos.includes(campo);
      selVendedor.disabled = !s.editable;
      selFuncion.disabled = fijo('funcion');
      selModelo.disabled = fijo('modelo');
      motivo.value = '';
      motivo.disabled = !s.editable;
      btnGuardar.disabled = !s.editable;

      pintarEstado(s);
      panel.hidden = false;
      setStatus(s.editable ? 'Cargado.' : 'Cargado — solo lectura.', s.editable ? 'success' : 'error');
      if (s.editable) motivo.focus();
    } catch (err) {
      panel.hidden = true;
      cargado = null;
      setStatus(err.message, 'error');
    }
  }

  function anotar(codigo, cambio, texto) {
    sesion.unshift({ codigo, cambio, texto });
    pintarLog();
  }

  function reset() {
    cargado = null;
    panel.hidden = true;
    q.value = '';
    setStatus('');
    q.focus();
  }

  async function guardar() {
    if (!cargado) return;
    const cambios = {};
    if (!selVendedor.disabled) {
      const vSel = selVendedor.value ? Number(selVendedor.value) : null;
      if (vSel !== (cargado.vendedor?.id || null)) cambios.vendedorId = vSel;
    }
    if (!selFuncion.disabled && (selFuncion.value || null) !== (cargado.funcion || null)) {
      cambios.funcion = selFuncion.value || null;
    }
    if (!selModelo.disabled && (selModelo.value || null) !== (cargado.modelo || null)) {
      cambios.modelo = selModelo.value || null;
    }

    if (!Object.keys(cambios).length) {
      anotar(cargado.codigoPublico, false, 'sin cambios');
      reset();
      return;
    }
    if (!motivo.value.trim()) {
      setStatus('Poné un motivo del cambio.', 'error');
      motivo.focus();
      return;
    }

    setStatus('Guardando…');
    btnGuardar.disabled = true;
    try {
      const r = await api(`/consola/sticker/${cargado.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cambios, motivo: motivo.value }),
      });
      if (r.sinCambios) {
        anotar(cargado.codigoPublico, false, 'sin cambios');
      } else {
        const txt = r.diff
          .map((d) => `${d.campo}: ${d.antes || '—'} → <b>${d.despues || '—'}</b>`)
          .join(' · ');
        anotar(cargado.codigoPublico, true, txt);
      }
      onChange?.();
      reset();
    } catch (err) {
      setStatus(err.message, 'error');
      btnGuardar.disabled = false;
    }
  }

  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      cargar();
    }
  });
  motivo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      guardar();
    }
  });
  btnGuardar.addEventListener('click', guardar);

  $('consola-scan').addEventListener('click', async () => {
    if (!('NDEFReader' in window)) {
      setStatus('Este navegador no soporta Web NFC. Usá Chrome en Android.', 'error');
      return;
    }
    setStatus('Acercá el chip al teléfono…');
    try {
      const ndef = new NDEFReader();
      ndefAbort = new AbortController();
      await ndef.scan({ signal: ndefAbort.signal });
      ndef.addEventListener('reading', ({ message, serialNumber }) => {
        let codigo = '';
        for (const rec of message?.records || []) {
          try {
            const m = new TextDecoder()
              .decode(rec.data)
              .match(/(?:[?&]c=|\/(?:v|activacion)\/)([^/?#&\s]+)/i);
            if (m) codigo = decodeURIComponent(m[1]).trim();
          } catch {
            /* record no decodificable */
          }
          if (codigo) break;
        }
        const uid = String(serialNumber || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        q.value = codigo || uid;
        if (q.value) cargar();
      });
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  $('toggle-consola-sticker').addEventListener('click', () => {
    overlay.classList.add('is-open');
    sesion = [];
    pintarLog();
    reset();
    setTimeout(() => q.focus(), 50);
  });
  const cerrar = () => {
    overlay.classList.remove('is-open');
    ndefAbort?.abort();
    ndefAbort = null;
  };
  $('consola-modal-close').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
}
