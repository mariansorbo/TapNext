// Post Affiliate Pro — tracking de clics de afiliados en las páginas públicas.
// El afiliado comparte un link con ?a_aid=<id>; trackjs.js registra el clic y
// deja la cookie PAPVisitorId en este dominio. La venta NO se manda desde acá:
// la manda el server cuando Mercado Pago confirma el pago (ver server/pap.js),
// así nunca se acredita una comisión por un pago que no entró.
//
// Sin VITE_PAP_URL no se carga nada (mismo criterio "integrador opcional" que
// el resto de las integraciones).
const PAP_URL = (import.meta.env.VITE_PAP_URL || '').replace(/\/+$/, '');
const PAP_ACCOUNT_ID = import.meta.env.VITE_PAP_ACCOUNT_ID || 'default1';

if (PAP_URL) {
  const s = document.createElement('script');
  s.id = 'pap_x2s6df8d';
  s.async = true;
  s.src = `${PAP_URL}/scripts/trackjs.js`;
  s.onload = () => {
    try {
      window.PostAffTracker.setAccountId(PAP_ACCOUNT_ID);
      window.PostAffTracker.track();
    } catch (err) {
      /* un tracker caído nunca puede romper la landing */
    }
  };
  document.head.appendChild(s);
}

// visitorId de PAP (32 caracteres) para que el server lo mande en sale.php.
// La cookie puede venir con el accountId adelante, por eso nos quedamos con
// los últimos 32.
export function obtenerPapVisitorId() {
  const match = document.cookie.match(/(?:^|; )PAPVisitorId=([^;]*)/);
  if (!match) return '';
  const valor = decodeURIComponent(match[1]).trim();
  return /^[A-Za-z0-9]{32,}$/.test(valor) ? valor.slice(-32) : '';
}
