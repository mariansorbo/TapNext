// Panel "Entrega" — despacho de venta presencial con late binding.
// Ver "Cola de entrega y botón de despacho" en el vault NextTap - Knowledge.
//
// El vendedor abre este panel en un Android dedicado (Web NFC), lo deja
// escaneando en loop, tapea cualquier llavero del combo, y el panel le muestra
// el #1 de la cola (mail + código de retiro + cuántos esperan). Grita el código,
// el comprador se lo confirma, y toca "Entregar".
//
// Offline: al abrir cachea la cola (localStorage). Si un tap o una entrega
// fallan por red, resuelve/encola contra el cache y reintenta al volver online.
// El endpoint de entrega es idempotente, así que el replay no duplica.

// Namespaced por panel (admin / vendedor) para no pisarse en el mismo browser.

const readJson = (k, def) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? def;
  } catch {
    return def;
  }
};
const writeJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export function initDespacho({ api, colaPath = '/despacho/cola', ns = 'admin' }) {
  const OUTBOX_KEY = `tap_despacho_outbox_${ns}`;
  const CACHE_KEY = `tap_despacho_cola_${ns}`;
  const openBtn = document.getElementById('open-despacho-button');
  const overlay = document.getElementById('despacho-modal-overlay');
  if (!openBtn || !overlay) return;

  const closeBtn = document.getElementById('despacho-modal-close');
  const statusEl = document.getElementById('despacho-status');
  const cardEl = document.getElementById('despacho-card');
  const outboxEl = document.getElementById('despacho-outbox');
  const startBtn = document.getElementById('despacho-start');
  const manualInput = document.getElementById('despacho-manual-codigo');
  const manualBtn = document.getElementById('despacho-manual-btn');

  let ndef = null;
  let scanAbort = null;
  let ultimo = null; // { sticker, siguiente, combo, esperando } del último tap
  let ocupado = false;

  const setStatus = (msg, tone = '') => {
    statusEl.textContent = msg;
    statusEl.className = `modal-status${tone ? ` is-${tone}` : ''}`;
  };

  function renderOutbox() {
    const pend = readJson(OUTBOX_KEY, []);
    if (!pend.length) {
      outboxEl.hidden = true;
      return;
    }
    outboxEl.hidden = false;
    outboxEl.textContent = `${pend.length} entrega(s) sin sincronizar${navigator.onLine ? ' — reintentando…' : ' — sin conexión'}`;
  }

  function renderCard() {
    if (!ultimo) {
      cardEl.hidden = true;
      return;
    }
    cardEl.hidden = false;
    if (ultimo.yaEntregado) {
      cardEl.innerHTML = `
        <div class="despacho-chip">chip ${ultimo.sticker.codigoPublico}</div>
        <div class="despacho-ya">Ya entregado${ultimo.a?.mail ? ` a <b>${ultimo.a.mail}</b>` : ''}.</div>
        <div class="despacho-sub">No se re-asigna.</div>`;
      return;
    }
    if (ultimo.sinCola) {
      cardEl.innerHTML = `
        <div class="despacho-chip">chip ${ultimo.sticker.codigoPublico}</div>
        <div class="despacho-ya">Este chip no está en stock de un vendedor (${ultimo.estado}).</div>`;
      return;
    }
    if (ultimo.ajeno) {
      cardEl.innerHTML = `
        <div class="despacho-chip">chip ${ultimo.sticker.codigoPublico}</div>
        <div class="despacho-ya">Este llavero no es de tu stock.</div>`;
      return;
    }
    const s = ultimo.siguiente;
    const comboTxt = `${ultimo.combo.funcion || 'sin función'} · ${ultimo.combo.modelo || 'suelto'}`;
    if (!s) {
      cardEl.innerHTML = `
        <div class="despacho-chip">chip ${ultimo.sticker.codigoPublico} · ${comboTxt}</div>
        <div class="despacho-ya">No hay nadie esperando este combo.</div>`;
      return;
    }
    cardEl.innerHTML = `
      <div class="despacho-chip">chip ${ultimo.sticker.codigoPublico} · ${comboTxt}</div>
      <div class="despacho-codigo">${s.codigoRetiro || '----'}</div>
      <div class="despacho-mail">${s.mail || 'sin mail'}</div>
      <div class="despacho-sub">${ultimo.esperando} esperando este combo${s.restantesItems > 1 ? ` · le faltan ${s.restantesItems} unidades` : ''}</div>
      <div class="despacho-acciones">
        <button type="button" class="btn-primary" id="despacho-entregar">Entregar</button>
        <button type="button" class="btn-ghost" id="despacho-siguiente">Siguiente</button>
      </div>`;
    cardEl.querySelector('#despacho-entregar').addEventListener('click', () => entregar(s.ventaId, ultimo.sticker.id));
    cardEl.querySelector('#despacho-siguiente').addEventListener('click', () => siguiente(s.ventaId));
  }

  async function refrescarCache() {
    try {
      const cola = await api(colaPath);
      writeJson(CACHE_KEY, cola);
    } catch {
      /* offline — usamos lo que haya */
    }
  }

  // Cola cacheada → #1 de un combo, para resolver un tap sin conexión.
  function headDelComboLocal(combo) {
    const cola = readJson(CACHE_KEY, { combos: [] });
    const g = (cola.combos || []).find(
      (c) => (c.modelo || 'suelto') === (combo.modelo || 'suelto') && (c.funcion || null) === (combo.funcion || null)
    );
    return g?.pedidos?.[0] || null;
  }

  async function procesarTap(codigo, uid) {
    if (ocupado) return;
    ocupado = true;
    try {
      setStatus('Leyendo…');
      const r = await api('/despacho/tap', {
        method: 'POST',
        body: JSON.stringify({ codigo, uid }),
      });
      ultimo = r;
      const tone = r.yaEntregado || r.ajeno ? 'error' : '';
      setStatus(r.siguiente ? `Código ${r.siguiente.codigoRetiro}` : r.ajeno ? 'Llavero ajeno' : 'Sin cola', tone);
    } catch (err) {
      // Sin conexión: no sabemos el combo del chip, sólo podemos avisar.
      setStatus(`Sin conexión — no puedo consultar la cola (${err.message}).`, 'error');
    } finally {
      ocupado = false;
      renderCard();
    }
  }

  async function entregar(ventaId, stickerId) {
    setStatus('Entregando…');
    try {
      const r = await api('/despacho/entregar', {
        method: 'POST',
        body: JSON.stringify({ ventaId, stickerId }),
      });
      setStatus(r.restantes ? `Entregado — le faltan ${r.restantes}` : 'Entregado ✓', 'success');
      ultimo = null;
      renderCard();
      refrescarCache();
    } catch (err) {
      // Encolar para reintentar.
      const pend = readJson(OUTBOX_KEY, []);
      pend.push({ ventaId, stickerId, ts: Date.now() });
      writeJson(OUTBOX_KEY, pend);
      setStatus(`Guardado sin conexión (${err.message}). Se sincroniza al volver la señal.`, 'error');
      ultimo = null;
      renderCard();
      renderOutbox();
    }
  }

  async function siguiente(ventaId) {
    setStatus('Salteando…');
    try {
      const r = await api('/despacho/siguiente', {
        method: 'POST',
        body: JSON.stringify({ ventaId }),
      });
      if (ultimo) {
        ultimo.siguiente = r.siguiente
          ? { ...ultimo.siguiente, ventaId: r.siguiente.ventaId, mail: r.siguiente.mail, codigoRetiro: r.siguiente.codigoRetiro }
          : null;
      }
      setStatus(r.siguiente ? `Código ${r.siguiente.codigoRetiro}` : 'Sin cola');
      renderCard();
      refrescarCache();
    } catch (err) {
      setStatus(`No se pudo saltear: ${err.message}`, 'error');
    }
  }

  async function drenarOutbox() {
    if (!navigator.onLine) return;
    let pend = readJson(OUTBOX_KEY, []);
    if (!pend.length) return;
    const quedan = [];
    for (const e of pend) {
      try {
        await api('/despacho/entregar', {
          method: 'POST',
          body: JSON.stringify({ ventaId: e.ventaId, stickerId: e.stickerId }),
        });
      } catch {
        quedan.push(e);
      }
    }
    writeJson(OUTBOX_KEY, quedan);
    renderOutbox();
    if (!quedan.length) refrescarCache();
  }

  async function startScan() {
    if (!('NDEFReader' in window)) {
      setStatus('Este dispositivo no soporta Web NFC. Usá Chrome en Android, o ingresá el código a mano.', 'error');
      return;
    }
    try {
      ndef = new NDEFReader();
      scanAbort = new AbortController();
      await ndef.scan({ signal: scanAbort.signal });
    } catch (err) {
      setStatus(
        err?.name === 'NotAllowedError'
          ? 'Permiso de NFC denegado. Activá NFC y permití el acceso.'
          : `No se pudo iniciar el lector: ${err.message}`,
        'error'
      );
      return;
    }
    startBtn.hidden = true;
    setStatus('Escaneando — acercá un llavero.');
    ndef.addEventListener('readingerror', () => setStatus('Lectura fallida — acercá bien el chip.', 'error'));
    ndef.addEventListener('reading', (event) => {
      let url = '';
      for (const rec of event.message?.records || []) {
        if (rec.recordType === 'url') {
          try {
            url = new TextDecoder().decode(rec.data);
          } catch {}
        }
      }
      procesarTap(url || event.serialNumber, event.serialNumber);
    });
  }

  function stopScan() {
    try {
      scanAbort?.abort();
    } catch {}
    ndef = null;
    scanAbort = null;
  }

  function open() {
    overlay.classList.add('is-open');
    document.body.classList.add('modal-open');
    ultimo = null;
    renderCard();
    renderOutbox();
    setStatus('Tocá "Empezar a escanear".');
    startBtn.hidden = false;
    refrescarCache();
    drenarOutbox();
  }
  function close() {
    stopScan();
    overlay.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  startBtn.addEventListener('click', startScan);
  manualBtn?.addEventListener('click', () => {
    const v = manualInput.value.trim();
    if (v) procesarTap(v, null);
  });
  window.addEventListener('online', () => {
    renderOutbox();
    drenarOutbox();
  });
  window.addEventListener('offline', renderOutbox);
}
