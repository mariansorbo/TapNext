// Modal "Edición forzada" — para pruebas.
//
// Cargás un código, elegís la función y el valor del destino, y se fuerza sobre
// el chip sea cual sea su estado. Backend: server/edicion-forzada.js.

const esc = (t) =>
  String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initEdicionForzada({ api, onChange }) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('forzada-modal-overlay');
  if (!overlay) return;

  const q = $('forzada-q');
  const status = $('forzada-status');
  const panel = $('forzada-panel');
  const estadoBox = $('forzada-estado');
  const selFuncion = $('forzada-funcion');
  const valor = $('forzada-valor');
  const valorLabel = $('forzada-valor-label');
  const valorAyuda = $('forzada-valor-ayuda');
  const sinValidar = $('forzada-sin-validar');
  const forzarActivo = $('forzada-activo');
  const forzarActivoRow = $('forzada-activo-row');
  const motivo = $('forzada-motivo');
  const btnGuardar = $('forzada-guardar');

  let cargado = null;

  const setStatus = (msg, kind) => {
    status.className = 'modal-status' + (kind ? ' is-' + kind : '');
    status.textContent = msg || '';
  };

  const metaDe = (id) => cargado?.destinos.find((d) => d.id === id) || {};

  function pintarMeta() {
    const m = metaDe(selFuncion.value);
    valorLabel.textContent = m.campo || 'Valor';
    valor.placeholder = m.campos ? '{"alias":"…","titular":"…","banco":"…"}' : m.placeholder || '';
    valorAyuda.textContent = m.campos ? 'Función multi-campo: pegá el JSON.' : m.ayuda || '';
  }

  function pintar(s) {
    const fila = (k, v) => `<div><b>${k}:</b> ${v ? esc(v) : '<span class="admin-muted">—</span>'}</div>`;
    estadoBox.innerHTML =
      fila('Código', s.codigoPublico) +
      fila('Estado', s.estado) +
      fila('Modelo', s.modelo) +
      fila('Función', s.funcion) +
      fila('Destino', s.destino ? `${s.destino.tipo}: ${s.destino.valor}` : null) +
      `<div><b>Tap:</b> <a href="${esc(s.linkTap)}" target="_blank" rel="noopener">${esc(s.linkTap)}</a></div>` +
      (s.avisos.length ? `<div class="admin-muted" style="margin-top:6px;">⚠️ ${esc(s.avisos.join(' '))}</div>` : '');

    selFuncion.innerHTML = s.destinos
      .map((d) => `<option value="${d.id}"${d.id === s.funcion ? ' selected' : ''}>${esc(d.label || d.id)}</option>`)
      .join('');
    if (!s.funcion) selFuncion.value = s.destino?.tipo || s.destinos[0]?.id || '';
    valor.value = s.destino && s.destino.tipo === selFuncion.value ? s.destino.valor : '';
    forzarActivo.checked = false;
    forzarActivoRow.style.display = s.estado === 'activo' ? 'none' : '';
    pintarMeta();
  }

  async function cargar() {
    const val = q.value.trim();
    if (!val) return;
    setStatus('Buscando…');
    try {
      cargado = await api(`/edicion-forzada?q=${encodeURIComponent(val)}`);
      pintar(cargado);
      sinValidar.checked = false;
      motivo.value = '';
      panel.hidden = false;
      btnGuardar.disabled = false;
      setStatus('Cargado.', 'success');
      valor.focus();
    } catch (err) {
      cargado = null;
      panel.hidden = true;
      setStatus(err.message, 'error');
    }
  }

  async function guardar() {
    if (!cargado) return;
    setStatus('Guardando…');
    btnGuardar.disabled = true;
    try {
      const r = await api(`/edicion-forzada/${cargado.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          funcion: selFuncion.value,
          valor: valor.value,
          sinValidar: sinValidar.checked,
          forzarActivo: forzarActivo.checked,
          motivo: motivo.value,
        }),
      });
      cargado = r.sticker;
      pintar(cargado);
      if (r.sinCambios) {
        setStatus('Sin cambios.');
      } else {
        const d = (k) => `${r.antes[k] || '—'} → ${r.despues[k] || '—'}`;
        const partes = [`Función: ${d('funcion')}`, `Destino: ${d('destino')}`];
        if (r.antes.estado !== r.despues.estado) partes.unshift(`Estado: ${d('estado')}`);
        setStatus(`Guardado. ${partes.join(' · ')}`, 'success');
        onChange?.();
      }
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      btnGuardar.disabled = false;
    }
  }

  selFuncion.addEventListener('change', () => {
    valor.value = cargado?.destino && cargado.destino.tipo === selFuncion.value ? cargado.destino.valor : '';
    pintarMeta();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      cargar();
    }
  });
  valor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      guardar();
    }
  });
  btnGuardar.addEventListener('click', guardar);

  $('toggle-edicion-forzada').addEventListener('click', () => {
    overlay.classList.add('is-open');
    cargado = null;
    panel.hidden = true;
    q.value = '';
    setStatus('');
    setTimeout(() => q.focus(), 50);
  });
  const cerrar = () => overlay.classList.remove('is-open');
  $('forzada-modal-close').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrar();
  });
}
