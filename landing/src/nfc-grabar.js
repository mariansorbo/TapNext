// Asistente "Grabar chips NFC" — pestaña del panel de admin para programar
// chips en tanda desde el celular: tap → lee UID → POST /stickers/individual →
// escribe la URL en el chip → "Siguiente". El candado (AUTH0/PWD) NO se hace
// acá: Web NFC no expone los comandos de bajo nivel de la NTAG, así que se
// deja para una segunda pasada con NFC Tools usando PWD_AUTH/PACK que este
// asistente muestra y deja copiado.
//
// Requisitos del navegador: Chrome en Android (único con Web NFC), contexto
// seguro (HTTPS o localhost) y NFC activado en el sistema.

const FUNCION_OPTS = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', pago: 'Pago', menu: 'Menú',
  review: 'Reseña', web: 'Web propia', agenda: 'Agenda', linktree: 'LinkTree',
};
const MODELO_OPTS = { llavero: 'Llavero', tarjeta: 'Tarjeta', placa: 'Placa' };

// serialNumber de Web NFC viene "04:d1:3a:..." — el resto del sistema guarda
// el UID como hex plano en minúscula (ver generateUidNfc en server/index.js).
const normalizeUid = (serial) => String(serial || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export function initNfcGrabar({ api, getVendedores, onSaved }) {
  const overlay = document.getElementById('grabar-modal-overlay');
  if (!overlay) return;

  const $ = (id) => document.getElementById(id);
  const supported = 'NDEFReader' in window;

  const stepConfig = $('grabar-config');
  const stepRun = $('grabar-run');
  const configStatus = $('grabar-config-status');
  const objetivoInput = $('grabar-objetivo');
  const funcionSel = $('grabar-funcion');
  const modeloSel = $('grabar-modelo');
  const vendedorSel = $('grabar-vendedor');
  const startBtn = $('grabar-start');

  const progressEl = $('grabar-progress');
  const countEl = $('grabar-count');
  const stageEl = $('grabar-stage');
  const runStatus = $('grabar-status');
  const nextBtn = $('grabar-next');
  const skipBtn = $('grabar-skip');
  const finishBtn = $('grabar-finish');

  funcionSel.innerHTML = '<option value="">Sin asignar</option>' +
    Object.entries(FUNCION_OPTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  modeloSel.innerHTML = '<option value="">Sin asignar</option>' +
    Object.entries(MODELO_OPTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  let ndef = null;
  let abort = null;
  let objetivo = 10;
  let grabados = 0;
  // Estado del chip actual. phase: 'esperando' | 'grabando-listo' | 'reintento' | 'hecho'
  let cur = null;
  let phase = 'esperando';
  let lastUidHandled = null;

  function open() {
    resetConfig();
    document.body.classList.add('modal-open');
    overlay.classList.add('is-open');
  }
  function close() {
    stopScan();
    overlay.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  }
  function stopScan() {
    if (abort) { try { abort.abort(); } catch {} }
    abort = null;
    ndef = null;
  }

  function resetConfig() {
    stopScan();
    stepRun.hidden = true;
    stepConfig.hidden = false;
    configStatus.textContent = '';
    configStatus.className = 'modal-status';
    grabados = 0;
    cur = null;
    phase = 'esperando';
    lastUidHandled = null;

    const vendedores = (getVendedores && getVendedores()) || [];
    vendedorSel.innerHTML = '<option value="">Sin asignar</option>' +
      vendedores.map((v) => `<option value="${v.id}">${v.nombre} (${v.codigoRef})</option>`).join('');

    if (!supported) {
      configStatus.className = 'modal-status is-error';
      configStatus.textContent = 'Este navegador no soporta Web NFC. Abrí el panel con Chrome en un teléfono Android.';
      startBtn.disabled = true;
    } else {
      startBtn.disabled = false;
    }
  }

  function renderProgress() {
    countEl.textContent = `${grabados} / ${objetivo}`;
    let dots = '';
    for (let i = 0; i < objetivo; i++) {
      const cls = i < grabados ? 'is-done' : (i === grabados ? 'is-active' : '');
      dots += `<span class="wizard-dot ${cls}"></span>`;
    }
    progressEl.innerHTML = dots;
  }

  function setStatus(msg, kind = '') {
    runStatus.textContent = msg || '';
    runStatus.className = 'modal-status' + (kind ? ` is-${kind}` : '');
  }

  // Pantalla "acercá el chip" para el próximo
  function armForNextChip() {
    cur = null;
    phase = 'esperando';
    lastUidHandled = null;
    nextBtn.disabled = true;
    skipBtn.disabled = false;
    stageEl.innerHTML = `
      <div class="grabar-big">
        <div class="nfc-pulse">📡</div>
        <p>Acercá el chip <b>#${grabados + 1}</b> a la parte de atrás del teléfono.</p>
      </div>`;
    setStatus('Esperando chip…');
  }

  function renderDone() {
    phase = 'hecho';
    nextBtn.disabled = false;
    skipBtn.disabled = true;
    stageEl.innerHTML = `
      <div class="wizard-summary">
        <div>✅ <b>Grabado</b> — código <b>${cur.codigoPublico}</b></div>
        <div><b>URL en el chip:</b><br>${cur.url}</div>
        <div><b>PWD_AUTH:</b> <span class="grabar-key">${cur.writePassword}</span>
          <button type="button" class="row-btn" data-copy="${cur.writePassword}">copiar</button></div>
        <div><b>PACK:</b> <span class="grabar-key">${cur.writePack}</span>
          <button type="button" class="row-btn" data-copy="${cur.writePack}">copiar</button></div>
        <div style="margin-top:8px">
          <button type="button" class="row-btn" id="grabar-candado">Marcar candado (ya escribí AUTH0)</button>
        </div>
        <p class="grabar-hint">El candado se hace después con NFC Tools usando estas claves. "Siguiente chip" para seguir.</p>
      </div>`;
    stageEl.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copiado ✓'; }
        catch { window.prompt('Copiá:', b.dataset.copy); }
      });
    });
    const candadoBtn = document.getElementById('grabar-candado');
    if (candadoBtn) {
      candadoBtn.addEventListener('click', async () => {
        candadoBtn.disabled = true;
        try {
          await api(`/stickers/${cur.id}/candado`, { method: 'PATCH' });
          candadoBtn.textContent = '🔒 candado marcado';
        } catch (err) {
          candadoBtn.disabled = false;
          setStatus(err.message, 'error');
        }
      });
    }
    setStatus(`Chip ${grabados} de ${objetivo} listo.`, 'success');
  }

  async function writeUrlToChip(url) {
    // AbortSignal para que el write no quede colgado si el chip ya se fue.
    await ndef.write(
      { records: [{ recordType: 'url', data: url }] },
      { overwrite: true },
    );
  }

  async function handleReading(serialNumber) {
    const uid = normalizeUid(serialNumber);
    if (!uid) { setStatus('No pude leer el UID del chip. Probá de nuevo.', 'error'); return; }

    // Reintento de grabación sobre el MISMO chip ya registrado.
    if (phase === 'reintento' && cur && cur.uidNfc === uid) {
      setStatus('Grabando la URL…');
      try {
        await writeUrlToChip(cur.url);
        grabados += 1;
        renderProgress();
        if (onSaved) onSaved();
        renderDone();
      } catch (err) {
        setStatus(`No se pudo grabar: ${err.message}. Mantené el chip pegado y probá de nuevo.`, 'error');
      }
      return;
    }

    if (phase !== 'esperando') return;      // ya estamos procesando/hecho
    if (uid === lastUidHandled) return;      // mismo tap repetido
    lastUidHandled = uid;
    phase = 'procesando';
    skipBtn.disabled = true;
    setStatus('Registrando el chip…');

    let data;
    try {
      data = await api('/stickers/individual', {
        method: 'POST',
        body: JSON.stringify({
          uidNfc: uid,
          funcion: funcionSel.value || '',
          modelo: modeloSel.value || '',
          vendedorId: vendedorSel.value || null,
        }),
      });
    } catch (err) {
      phase = 'esperando';
      lastUidHandled = null;
      skipBtn.disabled = false;
      setStatus(err.message + ' — acercá otro chip o salteá.', 'error');
      return;
    }

    cur = {
      id: data.id, uidNfc: uid, codigoPublico: data.codigoPublico,
      url: data.url, writePassword: data.writePassword, writePack: data.writePack,
    };

    setStatus('Registrado. Grabando la URL en el chip…');
    try {
      await writeUrlToChip(cur.url);
      grabados += 1;
      renderProgress();
      if (onSaved) onSaved();
      renderDone();
    } catch (err) {
      phase = 'reintento';
      stageEl.innerHTML = `
        <div class="grabar-big">
          <div class="nfc-pulse">📡</div>
          <p>Chip registrado como <b>${cur.codigoPublico}</b>, pero faltó grabar la URL.<br>
          Volvé a acercar <b>el mismo chip</b> para grabarla.</p>
        </div>`;
      setStatus(`Grabación pendiente: ${err.message}`, 'error');
    }
  }

  async function startRun() {
    objetivo = Math.min(Math.max(Number(objetivoInput.value) || 1, 1), 200);
    configStatus.textContent = '';
    try {
      ndef = new NDEFReader();
      abort = new AbortController();
      await ndef.scan({ signal: abort.signal });
    } catch (err) {
      configStatus.className = 'modal-status is-error';
      configStatus.textContent =
        err && err.name === 'NotAllowedError'
          ? 'Permiso de NFC denegado. Activá NFC y permití el acceso al sitio.'
          : `No se pudo iniciar el lector NFC: ${err.message}`;
      stopScan();
      return;
    }

    ndef.addEventListener('readingerror', () => {
      setStatus('Lectura fallida — acercá bien el chip al centro de la parte de atrás.', 'error');
    });
    ndef.addEventListener('reading', (event) => {
      handleReading(event.serialNumber);
    });

    stepConfig.hidden = true;
    stepRun.hidden = false;
    grabados = 0;
    renderProgress();
    armForNextChip();
  }

  startBtn.addEventListener('click', startRun);
  nextBtn.addEventListener('click', () => {
    if (grabados >= objetivo) {
      setStatus(`¡Listo! Grabaste los ${objetivo} chips.`, 'success');
      nextBtn.disabled = true;
      return;
    }
    renderProgress();
    armForNextChip();
  });
  skipBtn.addEventListener('click', () => {
    armForNextChip();
    setStatus('Chip salteado.');
  });
  finishBtn.addEventListener('click', close);

  $('grabar-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('open-grabar-button').addEventListener('click', open);
}
