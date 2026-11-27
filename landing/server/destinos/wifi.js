// Función "wifi": el tap NO redirige. Renderiza una página de NextTap con el
// nombre de la red y la contraseña (botón para copiarla). Modo 'landing', igual que 'alias' y 'custom'.
//
// Valor guardado en `destinos` (JSON string): { ssid, password }
// Sin contraseña = red abierta.
//
// OJO: acá NO se usa `limpiar` (de _comun.js): saca puntuación y comillas de las
// puntas, y una contraseña o un SSID las puede llevar de verdad.

function leerCrudo(crudo) {
  if (crudo && typeof crudo === 'object') return crudo;
  try {
    const o = JSON.parse(String(crudo ?? ''));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// Saltos de línea y caracteres invisibles que se cuelan al copiar de WhatsApp.
const sinBasura = (s) => String(s ?? '').replace(/[​-‍⁠﻿­]/g, '').replace(/[\r\n\t]+/g, '');

const meta = {
  label: 'Wi-Fi',
  campo: 'Datos del Wi-Fi',
  placeholder: 'MiRed',
  ayuda: 'Se muestran en una página de NextTap con un botón para copiar la contraseña.',
  campos: [
    { key: 'ssid', label: 'Nombre de la red (Wi-Fi)', placeholder: 'MiRed', requerido: true },
    {
      key: 'password',
      label: 'Contraseña',
      placeholder: 'Mínimo 8 caracteres',
      ayuda: 'Dejala vacía si la red es abierta, sin contraseña.',
      requerido: false,
    },
  ],
};

export default {
  id: 'wifi',
  meta,

  normalizar(crudo) {
    const obj = leerCrudo(crudo);
    if (!obj) return { error: 'Completá los datos del Wi-Fi.' };

    const ssid = sinBasura(obj.ssid).trim();
    const password = sinBasura(obj.password);

    if (!ssid) return { error: 'Falta el nombre de la red.' };
    if (Buffer.byteLength(ssid, 'utf8') > 32) return { error: 'El nombre de la red es muy largo (máximo 32 caracteres).' };
    if (password && (password.length < 8 || password.length > 63)) {
      return { error: 'La contraseña del Wi-Fi tiene entre 8 y 63 caracteres. Dejala vacía si la red es abierta.' };
    }
    return { valor: JSON.stringify({ ssid, password }) };
  },

  resolver(valor) {
    let d = null;
    try {
      d = JSON.parse(valor);
    } catch {
      /* fila rota: la página muestra el aviso de vacío */
    }
    return {
      modo: 'landing',
      funcion: 'wifi',
      datos: { ssid: String(d?.ssid ?? ''), password: String(d?.password ?? '') },
    };
  },

  preview(valor) {
    let d = null;
    try {
      d = JSON.parse(valor);
    } catch {
      /* noop */
    }
    return `Muestra el Wi-Fi${d?.ssid ? ` "${d.ssid}"` : ''} con la contraseña para copiar`;
  },
};
