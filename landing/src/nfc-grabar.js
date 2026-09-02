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

// Cuánto esperamos a que ndef.write() termine antes de darlo por fallido. Si el
// chip se despega del teléfono, la promesa de write() nunca resuelve sola —
// sin este corte el asistente queda colgado en "Grabando…".
const WRITE_TIMEOUT_MS = 6000;

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
  const loteSel = $('grabar-lote');
  const loteTipoInput = $('grabar-lote-tipo');
  const loteTipoLabel = $('grabar-lote-tipo-label');
  const funcionSel = $('grabar-funcion');
  const modeloSel = $('grabar-modelo');
  const vendedorSel = $('grabar-vendedor');
  const startBtn = $('grabar-start');

  const progressEl = $('grabar-progress');
  const loteLabelEl = $('grabar-lote-label');
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
  let scanAbort = null;
  let objetivo = 10;
  let grabados = 0;
  let loteActual = null;   // { id, nombre } — el lote de esta tanda

  // phase:
  //   'esperando'   — sin chip todavía, listo para leer el próximo
  //   'registrando' — POST /stickers/individual en curso
  //   'por-grabar'  — chip registrado, falta escribirle la URL (botón Grabar)
  //   'grabando'    — ndef.write() en curso
  //   'hecho'       — chip terminado, esperando "Siguiente chip"
  let phase = 'esperando';
  let cur = null;            // { id, uidNfc, codigoPublico, url, writePassword, writePack }
  let lastUidRead = null;    // dedupe de taps repetidos del mismo chip

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
    if (scanAbort) { try { scanAbort.abort(); } catch {} }
    scanAbort = null;
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
    loteActual = null;
    phase = 'esperando';
    lastUidRead = null;

    const vendedores = (getVendedores && getVendedores()) || [];
    vendedorSel.innerHTML = '<option value="">Sin asignar</option>' +
      vendedores.map((v) => `<option value="${v.id}">${v.nombre} (${v.codigoRef})</option>`).join('');

    // Lista de lotes existentes + opción de crear uno nuevo (default).
    loteSel.innerHTML = '<option value="new">Lote nuevo</option>';
    loteTipoInput.value = '';
    api('/lotes').then((lotes) => {
      for (const l of lotes) {
        const opt = document.createElement('option');
        opt.value = String(l.id);
        opt.textContent = `#${l.id} · ${l.nombre}${l.tipo ? ` [${l.tipo}]` : ''}${l.chips ? ` (${l.chips})` : ''}`;
        loteSel.appendChild(opt);
      }
    }).catch(() => { /* si falla, queda solo "Lote nuevo" */ });

    // El campo "tipo de lote" solo aplica al crear uno nuevo.
    const syncTipoVisible = () => { loteTipoLabel.hidden = loteSel.value !== 'new'; };
    loteSel.onchange = syncTipoVisible;
    syncTipoVisible();

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

  // "Saltear" está disponible en cualquier momento salvo mientras hay una
  // operación en vuelo (registrando/grabando) — así el usuario nunca queda
  // trabado. "Siguiente chip" solo se habilita con un chip terminado.
  function syncNav() {
    const busy = phase === 'registrando' || phase === 'grabando';
    skipBtn.disabled = busy;
    nextBtn.disabled = phase !== 'hecho';
  }

  // Pantalla "acercá el chip" para el próximo
  function armForNextChip() {
    cur = null;
    phase = 'esperando';
    lastUidRead = null;
    syncNav();
    stageEl.innerHTML = `
      <div class="grabar-big">
        <div class="nfc-pulse">📡</div>
        <p>Acercá el chip <b>#${grabados + 1}</b> a la parte de atrás del teléfono.</p>
      </div>`;
    setStatus('Esperando chip…');
  }

  // Chip registrado pero sin URL grabada todavía — botón explícito para grabar
  // (más confiable en Android que reintentar en un segundo tap automático).
  function renderPorGrabar(errMsg) {
    phase = 'por-grabar';
    syncNav();
    stageEl.innerHTML = `
      <div class="grabar-big">
        <div class="nfc-pulse">📡</div>
        <p>Chip <b>${cur.codigoPublico}</b> registrado.<br>
        Mantené el chip pegado al teléfono y tocá <b>Grabar URL</b>.</p>
        <button type="button" class="btn-primary" id="grabar-write" style="width:100%; margin-top:14px;">Grabar URL</button>
      </div>`;
    document.getElementById('grabar-write').addEventListener('click', () => writeUrl());
    setStatus(errMsg || 'Registrado. Falta grabar la URL en el chip.', errMsg ? 'error' : '');
  }

  function renderDone() {
    phase = 'hecho';
    syncNav();
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

  async function writeUrl() {
    if (!ndef || !cur) return;
    phase = 'grabando';
    syncNav();
    setStatus('Grabando la URL… mantené el chip pegado.');

    // Corte por timeout: si el chip se fue, write() no resuelve nunca.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), WRITE_TIMEOUT_MS);
    try {
      await ndef.write(
        { records: [{ recordType: 'url', data: cur.url }] },
        { overwrite: true, signal: ac.signal },
      );
      clearTimeout(timer);
      grabados += 1;
      renderProgress();
      if (onSaved) onSaved();
      renderDone();
    } catch (err) {
      clearTimeout(timer);
      const msg = err && err.name === 'AbortError'
        ? 'No detecté el chip a tiempo. Acercalo bien al centro del dorso y tocá Grabar URL de nuevo.'
        : `No se pudo grabar: ${err.message}. Probá de nuevo con el chip pegado.`;
      renderPorGrabar(msg);
    }
  }

  async function onReading(serialNumber) {
    const uid = normalizeUid(serialNumber);
    if (!uid) { setStatus('No pude leer el UID del chip. Probá de nuevo.', 'error'); return; }

    // Si estamos esperando para grabar y vuelven a acercar el mismo chip,
    // disparamos la grabación (equivale a tocar "Grabar URL").
    if (phase === 'por-grabar' && cur && cur.uidNfc === uid) {
      writeUrl();
      return;
    }
    if (phase !== 'esperando') return;   // ocupado o chip ya terminado
    if (uid === lastUidRead) return;     // mismo tap repetido
    lastUidRead = uid;

    phase = 'registrando';
    syncNav();
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
          loteId: loteActual ? loteActual.id : null,
        }),
      });
    } catch (err) {
      phase = 'esperando';
      lastUidRead = null;
      syncNav();
      setStatus(err.message + ' — acercá otro chip o tocá Saltear.', 'error');
      return;
    }

    cur = {
      id: data.id, uidNfc: uid, codigoPublico: data.codigoPublico,
      url: data.url, writePassword: data.writePassword, writePack: data.writePack,
    };
    // Intento de grabación automático (chip todavía pegado). Si falla, cae al
    // botón manual — no queda trabado.
    await writeUrl();
  }

  async function startRun() {
    objetivo = Math.min(Math.max(Number(objetivoInput.value) || 1, 1), 200);
    configStatus.textContent = '';

    // Resolver el lote de la tanda antes de arrancar el lector.
    startBtn.disabled = true;
    try {
      if (loteSel.value === 'new') {
        configStatus.className = 'modal-status';
        configStatus.textContent = 'Creando el lote…';
        loteActual = await api('/lotes', {
          method: 'POST',
          body: JSON.stringify({ tipo: loteTipoInput.value.trim() || undefined }),
        });
      } else {
        const txt = loteSel.options[loteSel.selectedIndex].textContent;
        loteActual = { id: Number(loteSel.value), nombre: txt.replace(/^#\d+ · /, '').replace(/ \(\d+\)$/, '') };
      }
    } catch (err) {
      startBtn.disabled = false;
      configStatus.className = 'modal-status is-error';
      configStatus.textContent = `No se pudo preparar el lote: ${err.message}`;
      return;
    }
    configStatus.textContent = '';
    startBtn.disabled = false;

    try {
      ndef = new NDEFReader();
      scanAbort = new AbortController();
      await ndef.scan({ signal: scanAbort.signal });
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
    ndef.addEventListener('reading', (event) => { onReading(event.serialNumber); });

    stepConfig.hidden = true;
    stepRun.hidden = false;
    grabados = 0;
    if (loteActual) {
      loteLabelEl.textContent = `Lote #${loteActual.id} · ${loteActual.nombre}` +
        (loteActual.tipo ? ` · ${loteActual.tipo}` : '');
    }
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
    // Si el chip ya se registró pero no se grabó, avisamos: queda en la base
    // sin URL, se le puede grabar después con "Ver clave" desde el inventario.
    if (phase === 'por-grabar') {
      setStatus(`Chip ${cur.codigoPublico} registrado sin URL — grabala después desde el inventario.`, 'error');
    } else {
      setStatus('Chip salteado.');
    }
    armForNextChip();
  });

  finishBtn.addEventListener('click', close);

  $('grabar-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('open-grabar-button').addEventListener('click', open);
}
