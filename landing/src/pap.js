// Post Affiliate Pro — tracking de clics de afiliados en las páginas públicas.
// El afiliado comparte un link con ?a_aid=<id>; trackjs.js registra el clic y
// deja la cookie PAPVisitorId en este dominio. La venta NO se manda desde acá:
// la manda el server cuando Mercado Pago confirma el pago (ver server/pap.js),
// así nunca se acredita una comisión por un pago que no entró.
//
// Solo se carga cuando la visita entra con un link de afiliado (a_aid en la
// URL): cada llamada a PAP cuenta como "registro" del plan, y el tráfico de
// Meta Ads llenaría el cupo sin traer comisiones. La cookie de esa primera
// visita alcanza para atribuir la compra aunque vuelva días después.
// La URL de la cuenta es pública (como el ID del pixel); VITE_PAP_URL la pisa
// y VITE_PAP_URL=off lo apaga.
const PAP_URL_ENV = import.meta.env.VITE_PAP_URL;
const PAP_URL =
  PAP_URL_ENV === 'off' ? '' : (PAP_URL_ENV || 'https://next-tap.postaffiliatepro.com').replace(/\/+$/, '');
const PAP_ACCOUNT_ID = import.meta.env.VITE_PAP_ACCOUNT_ID || 'default1';

const vieneDeAfiliado = /[?&#]a_aid=/.test(location.search + location.hash);

if (PAP_URL && vieneDeAfiliado) {
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
