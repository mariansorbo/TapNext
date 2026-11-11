// Modal "Editar sticker B2" — escritura de link + candado, todo en el tap.
//
// Queda escaneando de forma permanente. A cada chip que se apoya:
//   1. pide al servidor su estado y sus claves derivadas (GET /b2/chip)
//   2. si no está registrado (y el tilde lo permite) lo da de alta
//   3. la APK escribe el link, y lo bloquea con PWD/PACK/AUTH0 (nfc-nativo.js)
//   4. avisa al servidor qué quedó en el chip real (POST /b2/:id/resultado)
// El hardware lo toca solo la APK; acá no hay Web NFC. Backend: server/consola-b2.js.

import { esNativo, alLeer, iniciar, detener, estadoNfc, abrirAjustesNfc, procesar, avisar } from './nfc-nativo.js';

const esc = (t) =>
  String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ERRORES = {
  clave_distinta: 'El chip está bloqueado con otra clave: no se puede reescribir.',
  sin_espacio: 'El link no entra en este chip.',
  perdido: 'Se perdió el chip — apoyalo y no lo muevas hasta que vibre.',
  sin_chip: 'No hay chip apoyado.',
  no_ntag: 'No es una NTAG21x: no se puede bloquear.',
  verificacion: 'Se escribió, pero el candado no quedó verificado.',
};

export function initConsolaB2({ api, onChange }) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('b2-modal-overlay');
  if (!overlay) return;

  const aviso = $('b2-aviso');
  const urlInput = $('b2-url');
  const chkBloquear = $('b2-bloquear');
  const chkRegistrar = $('b2-registrar');
  const chkVendidos = $('b2-vendidos');
  const motivoInput = $('b2-motivo');
  const toggleBtn = $('b2-toggle');
  const stage = $('b2-stage');
  const status = $('b2-status');
  const log = $('b2-log');

  let escaneando = false;
  let ocupado = false;
  let off = null;
  let filas = [];

  const setStatus = (msg, kind) => {
    status.className = 'modal-status' + (kind ? ' is-' + kind : '');
    status.textContent = msg || '';
  };

  function pintarEscena(html) {
    stage.innerHTML = `<div class="grabar-big">${html}</div>`;
  }

  function pintarLog() {
    if (!filas.length) { log.innerHTML = ''; return; }
    const ok = filas.filter((f) => f.ok).length;
    log.innerHTML =
      `<p class="section-lead" style="margin:16px 0 6px;">${filas.length} chip${filas.length === 1 ? '' : 's'} · ${ok} bien</p>` +
      '<table><tbody>' +
      filas.map((f) => `<tr><td>${f.ok ? '✅' : '❌'}</td><td><b>${esc(f.codigo)}</b></td><td>${f.texto}</td></tr>`).join('') +
      '</tbody></table>';
  }

  function anotar(ok, codigo, texto) {
    filas.unshift({ ok, codigo, texto });
    pintarLog();
  }

  // ¿Qué link va a llevar este chip?
  const linkPara = (info) => urlInput.value.trim() || info.urlSistema;

  function validarLink() {
    const v = urlInput.value.trim();
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch { return false; }
  }

  async function alChip(e) {
    if (e.tipo !== 'lectura' || !escaneando) return;
    if (ocupado) return;
    ocupado = true;
    const uid = String(e.uid || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    try {
      pintarEscena(`<div class="nfc-pulse">⚙️</div><p>Chip <b>${esc(uid)}</b> — <b>no lo muevas</b> hasta que vibre.</p>`);
      setStatus('Consultando el sistema…');

      let info = await api(`/b2/chip?uid=${encodeURIComponent(uid)}`);
      if (!info.registrado) {
        if (!chkRegistrar.checked) {
          anotar(false, uid, 'No está registrado en el sistema (tildá “Registrar…” para darlo de alta).');
          avisar('error');
          return;
        }
        setStatus('Registrando el chip nuevo…');
        const alta = await api('/stickers/individual', { method: 'POST', body: JSON.stringify({ uidNfc: uid }) });
        info = { ...info, registrado: true, id: alta.id, codigoPublico: alta.codigoPublico, urlSistema: alta.url, estado: 'en_stock', nuevo: true };
      }

      if (info.estado !== 'en_stock' && !chkVendidos.checked) {
        anotar(false, info.codigoPublico, `Chip ya ${esc(info.estado)} — tildá “Permitir editar chips ya vendidos / activos” si es a propósito.`);
        avisar('error');
        return;
      }

      const url = linkPara(info);
      const bloquear = chkBloquear.checked;
      setStatus(bloquear ? 'Escribiendo el link y bloqueando…' : 'Escribiendo el link…');
      const r = await procesar({ uid, url, pwd: info.pwd, pack: info.pack, bloquear });

      if (!r.ok) {
        anotar(false, info.codigoPublico, esc(ERRORES[r.error] || r.detalle || r.error));
        avisar('error');
        setStatus(ERRORES[r.error] || r.detalle || 'Falló.', 'error');
        return;
      }

      await api(`/b2/${info.id}/resultado`, {
        method: 'POST',
        body: JSON.stringify({
          url, urlAntes: r.urlAntes || null, bloqueo: r.bloqueo, chip: r.chip, motivo: motivoInput.value,
        }),
      }).catch(() => { /* el chip ya quedó bien; si falla la bitácora se ve en el log */ });

      const candado = r.bloqueo === 'aplicado' ? '🔒 bloqueado ahora' : r.bloqueo === 'ya_estaba' ? '🔒 ya estaba bloqueado' : '🔓 sin candado';
      anotar(true, info.codigoPublico, `${esc(url)} · ${candado}${info.nuevo ? ' · alta nueva' : ''}${r.chip ? ` · ${esc(r.chip)}` : ''}`);
      avisar('ok');
      onChange?.();
      setStatus('Listo. Apoyá el siguiente chip.', 'success');
    } catch (err) {
      anotar(false, uid, esc(err.message));
      avisar('error');
      setStatus(err.message, 'error');
    } finally {
      ocupado = false;
      if (escaneando) pintarEscena('<div class="nfc-pulse">📡</div><p>Escaneando… apoyá el próximo chip.</p>');
    }
  }

  function empezar() {
    if (!validarLink()) { setStatus('El link tiene que empezar con https:// o http://', 'error'); urlInput.focus(); return; }
    const nfc = estadoNfc();
    if (nfc === 'apagado') {
      setStatus('El NFC está apagado — te llevo a los ajustes.', 'error');
      abrirAjustesNfc();
      return;
    }
    if (nfc !== 'ok') { setStatus('Este teléfono no tiene NFC.', 'error'); return; }
    escaneando = true;
    off = alLeer(alChip);
    iniciar();
    toggleBtn.textContent = '⏹ Dejar de escanear';
    urlInput.disabled = true;
    pintarEscena('<div class="nfc-pulse">📡</div><p>Escaneando… apoyá el próximo chip.</p>');
    setStatus('Escaneo permanente activo.', 'success');
  }

  function parar() {
    if (!escaneando) return;
    escaneando = false;
    off?.(); off = null;
    detener();
    toggleBtn.textContent = '📡 Empezar a escanear';
    urlInput.disabled = false;
    stage.innerHTML = '';
    setStatus('Escaneo detenido.');
  }

  toggleBtn.addEventListener('click', () => (escaneando ? parar() : empezar()));

  $('toggle-consola-b2').addEventListener('click', () => {
    overlay.classList.add('is-open');
    document.body.classList.add('modal-open');
    filas = [];
    pintarLog();
    setStatus('');
    if (!esNativo) {
      aviso.hidden = false;
      aviso.textContent = 'Esto necesita la APK NextTap Chips: el navegador no puede bloquear chips (Web NFC no manda PWD_AUTH). Abrí el panel desde la app.';
      toggleBtn.disabled = true;
    } else {
      aviso.hidden = true;
      toggleBtn.disabled = false;
    }
  });
  const cerrar = () => {
    parar();
    overlay.classList.remove('is-open');
    document.body.classList.remove('modal-open');
  };
  $('b2-modal-close').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
}
