// Puente con la APK "NextTap Chips" (WebView + NFC nativo).
//
// Dentro de la APK existe `window.NfcNativo` (addJavascriptInterface). Este
// módulo hace dos cosas:
//   1. Expone `esNativo`, `alLeer`, `procesar`… para lo que Web NFC no puede:
//      PWD_AUTH, escribir PWD / PACK / AUTH0 (el candado) en el chip.
//   2. Si el WebView no trae Web NFC, instala un `NDEFReader` de compatibilidad
//      encima del puente, así el resto del panel (asistente de grabado, consola,
//      entrega…) sigue funcionando igual sin saber en qué navegador corre.
//
// En Chrome de escritorio / Android común no hay `NfcNativo` y no se toca nada.

const puente = typeof window !== 'undefined' ? window.NfcNativo : null;
export const esNativo = Boolean(puente);

const oyentes = new Set();
const pendientes = new Map();
let seq = 0;

if (esNativo) {
  // La APK llama a estos dos ganchos con evaluateJavascript.
  window.__nfcNativo = {
    evento(e) {
      for (const f of [...oyentes]) {
        try { f(e); } catch { /* un oyente roto no frena a los demás */ }
      }
    },
    resolver(id, res) {
      const p = pendientes.get(id);
      if (p) { pendientes.delete(id); p(res); }
    },
  };
}

let escaneos = 0;

/** Suscribe a las lecturas de chips. Devuelve la función para desuscribir. */
export function alLeer(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/** Enciende el lector (queda escaneando hasta que se llame a `detener`). */
export function iniciar() {
  if (!esNativo) return;
  escaneos += 1;
  puente.iniciarEscaneo();
}

export function detener() {
  if (!esNativo) return;
  escaneos = Math.max(0, escaneos - 1);
  if (escaneos === 0) puente.detenerEscaneo();
}

/** 'ok' | 'sin_nfc' | 'apagado' */
export function estadoNfc() {
  return esNativo ? puente.disponible() : 'sin_nfc';
}

export function abrirAjustesNfc() {
  if (esNativo) puente.abrirAjustesNfc();
}

/** Aviso físico (vibración) para tandas sin mirar la pantalla. */
export function avisar(tipo) {
  if (esNativo) puente.avisar(tipo === 'ok' ? 'ok' : 'error');
}

/**
 * Trabaja sobre el chip que está apoyado (el último leído).
 *   job = { uid?, url?, pwd?, pack?, bloquear? }
 *   → { ok:true, chip, urlAntes, escribio, bloqueo:'aplicado'|'ya_estaba'|'no' }
 *   → { ok:false, error, detalle }
 * error: perdido | clave_distinta | sin_espacio | no_ntag | sin_chip | verificacion | io
 */
export function procesar(job, timeoutMs = 20000) {
  if (!esNativo) return Promise.resolve({ ok: false, error: 'sin_puente', detalle: 'Hace falta la APK NextTap Chips.' });
  return new Promise((resolve) => {
    const id = String(++seq);
    const timer = setTimeout(() => {
      pendientes.delete(id);
      resolve({ ok: false, error: 'io', detalle: 'La APK no respondió a tiempo.' });
    }, timeoutMs);
    pendientes.set(id, (res) => { clearTimeout(timer); resolve(res); });
    puente.procesar(JSON.stringify(job), id);
  });
}

// --- Compatibilidad: NDEFReader sobre el puente ---------------------------

const bytesAB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const aBytes = (d) => {
  if (typeof d === 'string') return new TextEncoder().encode(d);
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
};

// En la APK se pisa siempre: el WebView trae su propio NDEFReader pero rechaza el permiso
// (NotAllowedError) y no puede escribir ni bloquear.
if (esNativo) {
  class NDEFReaderNativo extends EventTarget {
    async scan({ signal } = {}) {
      const nfc = estadoNfc();
      if (nfc === 'sin_nfc') throw new DOMException('Este teléfono no tiene NFC.', 'NotSupportedError');
      if (nfc === 'apagado') throw new DOMException('El NFC está apagado. Activalo en los ajustes.', 'NotReadableError');
      const off = alLeer((e) => {
        if (e.tipo !== 'lectura') return;
        const ev = new Event('reading');
        ev.serialNumber = e.uid;
        const records = [];
        if (e.url) records.push({ recordType: 'url', data: new DataView(new TextEncoder().encode(e.url).buffer) });
        ev.message = { records };
        this.dispatchEvent(ev);
      });
      iniciar();
      const parar = () => { off(); detener(); };
      if (signal) {
        if (signal.aborted) { parar(); throw new DOMException('Abortado', 'AbortError'); }
        signal.addEventListener('abort', parar, { once: true });
      }
    }

    async write(message, { signal } = {}) {
      const rec = message?.records?.[0];
      if (!rec) throw new TypeError('Mensaje vacío.');
      const job = rec.recordType === 'url'
        ? { url: String(rec.data) }
        : { mimeTipo: rec.mediaType || 'application/octet-stream', mimeB64: bytesAB64(aBytes(rec.data)) };
      if (signal?.aborted) throw new DOMException('Abortado', 'AbortError');
      const res = await Promise.race([
        procesar(job),
        new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new DOMException('Abortado', 'AbortError')), { once: true })),
      ]);
      if (!res.ok) {
        if (res.error === 'perdido' || res.error === 'sin_chip') throw new DOMException('Se perdió el chip.', 'AbortError');
        throw new Error(res.detalle || res.error);
      }
    }
  }
  Object.defineProperty(window, 'NDEFReader', { value: NDEFReaderNativo, writable: true, configurable: true });
}
