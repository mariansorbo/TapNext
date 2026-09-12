import { limpiar } from './_comun.js';

// Función "alias": el tap NO redirige a ningún lado. Renderiza una página propia
// de NextTap con los datos de transferencia que cargó el dueño (alias, titular,
// banco y, opcional, CBU/CVU y CUIT) y un botón para copiar el alias al
// portapapeles. La idea: pasar el alias sin dictarlo — el otro tapea, copia y
// pega en su app del banco.
//
// Es el primer destino con `resolver()` en modo 'landing'. El valor guardado en
// la tabla `destinos` es un JSON (string): { alias, titular, banco, cbu?, cuit? }.
// `meta.campos` le dice al front que dibuje un form multi-campo en vez de un
// único input.

// --- Validación de alias --------------------------------------------------

// 6 a 20 caracteres: letras, números, punto y guión. No arranca ni termina en
// punto/guión y no lleva puntos seguidos (reglas del alias CBU en Argentina).
const RE_ALIAS = /^[a-z0-9][a-z0-9.-]{4,18}[a-z0-9]$/;

// --- Dígitos verificadores ----------------------------------------------

// DV de un bloque: suma ponderada de los dígitos, complemento a 10 del módulo.
function dvBloque(digitos, pesos) {
  const suma = digitos.reduce((acc, d, i) => acc + d * pesos[i], 0);
  return (10 - (suma % 10)) % 10;
}

// CBU/CVU: 22 dígitos en dos bloques con DV propio.
//   bloque 1 (8):  7 dígitos + DV,  pesos 7 1 3 9 7 1 3
//   bloque 2 (14): 13 dígitos + DV, pesos 3 9 7 1 3 9 7 1 3 9 7 1 3
function cbuValido(s) {
  if (!/^\d{22}$/.test(s)) return false;
  const n = s.split('').map(Number);
  const dv1 = dvBloque(n.slice(0, 7), [7, 1, 3, 9, 7, 1, 3]);
  const dv2 = dvBloque(n.slice(8, 21), [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]);
  return dv1 === n[7] && dv2 === n[21];
}

// CUIT/CUIL: 11 dígitos, DV módulo 11 con pesos 5 4 3 2 7 6 5 4 3 2.
function cuitValido(s) {
  if (!/^\d{11}$/.test(s)) return false;
  const n = s.split('').map(Number);
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * n[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === n[10];
}

// --- Contrato -----------------------------------------------------------

// Acepta el JSON que manda el front, o directamente un objeto (tests / uso
// interno). Devuelve null si no se puede leer nada.
function leerCrudo(crudo) {
  if (crudo && typeof crudo === 'object') return crudo;
  try {
    const o = JSON.parse(String(crudo ?? ''));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

const meta = {
  label: 'Datos de transferencia',
  campo: 'Datos de transferencia',
  placeholder: 'tu.alias.mp',
  ayuda: 'Se muestran en una página de NextTap con un botón para copiar el alias.',
  // El front dibuja un input por cada campo (en vez del único `campo`).
  campos: [
    { key: 'alias', label: 'Alias', placeholder: 'tu.alias.mp', ayuda: 'El alias de tu CBU o CVU.', requerido: true },
    { key: 'titular', label: 'Titular de la cuenta', placeholder: 'Nombre y apellido', requerido: false },
    { key: 'banco', label: 'Banco o billetera', placeholder: 'Mercado Pago, Galicia, Naranja X…', requerido: false },
    { key: 'cbu', label: 'CBU / CVU (opcional)', placeholder: '22 dígitos', requerido: false },
    { key: 'cuit', label: 'CUIT / CUIL (opcional)', placeholder: '11 dígitos', requerido: false },
  ],
};

export default {
  id: 'alias',
  meta,

  normalizar(crudo) {
    const obj = leerCrudo(crudo);
    if (!obj) return { error: 'Completá tus datos de transferencia.' };

    const alias = limpiar(obj.alias).replace(/\s+/g, '').toLowerCase();
    const titular = limpiar(obj.titular).replace(/\s+/g, ' ');
    const banco = limpiar(obj.banco).replace(/\s+/g, ' ');
    const cbu = String(obj.cbu ?? '').replace(/\D/g, '');
    const cuit = String(obj.cuit ?? '').replace(/\D/g, '');

    if (!alias) return { error: 'Falta el alias.' };
    if (/\.\./.test(alias) || !RE_ALIAS.test(alias)) {
      return { error: 'El alias va de 6 a 20 caracteres: letras, números, puntos o guiones, sin espacios.' };
    }
    if (titular && (titular.length < 2 || titular.length > 60)) return { error: 'Revisá el nombre del titular.' };
    if (banco.length > 40) return { error: 'El nombre del banco es muy largo.' };
    if (cbu && !cbuValido(cbu)) {
      return { error: 'Ese CBU/CVU no es válido (son 22 dígitos). Dejalo vacío si no lo tenés a mano.' };
    }
    if (cuit && !cuitValido(cuit)) return { error: 'Ese CUIT/CUIL no es válido (son 11 dígitos).' };

    const valor = { alias, titular, banco };
    if (cbu) valor.cbu = cbu;
    if (cuit) valor.cuit = cuit;
    return { valor: JSON.stringify(valor) };
  },

  resolver(valor) {
    let d = null;
    try {
      d = JSON.parse(valor);
    } catch {
      /* fila vieja / rota: abajo se maneja */
    }
    if (!d || typeof d !== 'object' || !d.alias) {
      // Lo mínimo para que la página muestre algo aunque el valor esté raro.
      return { modo: 'landing', datos: { alias: String(valor ?? ''), titular: '', banco: '' } };
    }
    return {
      modo: 'landing',
      datos: {
        alias: d.alias,
        titular: d.titular || '',
        banco: d.banco || '',
        cbu: d.cbu || null,
        cuit: d.cuit || null,
      },
    };
  },

  preview(valor) {
    let d = null;
    try {
      d = JSON.parse(valor);
    } catch {
      /* noop */
    }
    const a = d && d.alias ? d.alias : valor;
    return `Muestra tus datos para transferir (alias ${a})`;
  },
};
