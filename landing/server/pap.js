// Post Affiliate Pro — registra la venta server-to-server (scripts/sale.php)
// cuando el webhook de Mercado Pago confirma el pago. El visitorId lo captura
// el front (cookie PAPVisitorId que deja src/pap.js) al crear la venta.
//
// La URL de la cuenta es pública: va por defecto (PAP_URL la pisa, PAP_URL=off
// lo apaga). Solo se manda una venta si vino de un clic de afiliado.
// Debug del lado de PAP: Tools > Sale requests log.

const PAP_URL =
  process.env.PAP_URL === 'off'
    ? ''
    : (process.env.PAP_URL || 'https://next-tap.postaffiliatepro.com').replace(/\/+$/, '');
const PAP_ACCOUNT_ID = process.env.PAP_ACCOUNT_ID || 'default1';

export const papDisponible = Boolean(PAP_URL);

export const esPapVisitorId = (v) => typeof v === 'string' && /^[A-Za-z0-9]{32}$/.test(v);

/**
 * Manda una venta a PAP. Best-effort: quien la llama la envuelve en try/catch.
 * @param {{
 *   orderId: string|number, totalCost: number, visitorId?: string|null,
 *   productId?: string, ip?: string|null, userAgent?: string|null,
 *   data1?: string,
 * }} datos
 */
export async function enviarVentaPap({ orderId, totalCost, visitorId, productId, ip, userAgent, data1 }) {
  if (!papDisponible) return;
  const params = new URLSearchParams({
    AccountId: PAP_ACCOUNT_ID,
    TotalCost: Number(totalCost).toFixed(2),
    OrderID: String(orderId),
  });
  if (visitorId) params.set('visitorId', visitorId);
  if (productId) params.set('ProductID', productId);
  if (ip) params.set('ip', ip);
  if (userAgent) params.set('useragent', userAgent);
  if (data1) params.set('data1', data1);

  const res = await fetch(`${PAP_URL}/scripts/sale.php?${params}`);
  if (!res.ok) {
    throw new Error(`PAP respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
