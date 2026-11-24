import { destinoLink } from './_comun.js';

// Reseñas: el comprador pega el link de reseñas de su local. Regla del proyecto:
// "mejor un destino raro que ninguno" — se acepta CUALQUIER link válido (Google en
// cualquiera de sus formatos, TripAdvisor, Facebook, etc.). Una validación estricta
// le costó una venta a un comprador con un link válido, así que no se rechaza por
// dominio ni por formato.
//
// Única normalización: el link corto `g.page/r/CODIGO` (sin `/review`) abre la
// ficha; con `/review` abre directo el formulario. Si vino sin el sufijo, se lo
// agregamos. Todo lo demás se guarda tal cual lo pegó (con https:// si faltaba).

const base = destinoLink({
  id: 'review',
  meta: {
    label: 'Reseñas',
    campo: 'Link para dejar reseña',
    placeholder: 'g.page/r/.../review',
    ayuda:
      'Pegá el link de reseñas de tu local. En Google lo sacás desde tu Perfil de Negocio, en la opción de pedir o compartir reseñas.',
  },
});

export default {
  ...base,
  normalizar(crudo) {
    const r = base.normalizar(crudo);
    if (r.error) return r;
    try {
      const u = new URL(r.valor);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'g.page') {
        const m = u.pathname.match(/^\/r\/([^/]+)(?:\/review)?\/?$/i);
        if (m) return { valor: `https://g.page/r/${m[1]}/review` };
      }
    } catch {
      // ya validado por destinoLink; si algo raro pasa, queda el valor tal cual
    }
    return r;
  },
};
