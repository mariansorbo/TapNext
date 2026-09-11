// Integración logística — Enviopack apuntando a Correo Argentino Clásico para la
// compra online (ver "Envio a domicilio - Correo Argentino via Enviopack" en el
// vault NextTap - Knowledge).
//
// Patrón "integrador opcional", igual que correo.js / modo-activacion.js: sin las
// env vars, `enviopackDisponible` es false y ninguna función pega a la red — el
// paso de envío del checkout queda oculto y el webhook no intenta crear nada.
//
// La API de Enviopack (https://developers.enviopack.com.ar):
//   - Auth: POST https://api.enviopack.com/auth  (form-urlencoded: api-key,
//     secret-key) -> { access_token, refresh_token }. Dura 4 h. El token va
//     como query param `?access_token=` en cada request.
//   - Cotizar a domicilio: GET /cotizar/precio/a-domicilio
//       ?provincia=AR-B&codigo_postal=1900&peso=0.3
//   - Crear envío: POST /envios  (JSON) — ver `crearEnvio`.
//   - Etiqueta: GET /envios/:id/etiqueta?formato=pdf  (devuelve el PDF binario).
//
// NOTA: escrito contra la doc pública, sin cuenta real todavía. Al dar de alta
// la cuenta (checklist en el vault) hay que validar en sandbox: el id exacto del
// `correo` de Correo Argentino, el id de `direccion_envio` (origen) y el shape
// fino de la respuesta de creación de envío. Los puntos frágiles están marcados
// con TODO.

const API_KEY = process.env.ENVIOPACK_API_KEY || '';
const SECRET_KEY = process.env.ENVIOPACK_SECRET_KEY || '';
const BASE = process.env.ENVIOPACK_BASE || 'https://api.enviopack.com';

// Datos de la cuenta, del panel de Enviopack:
//   ENVIOPACK_DIRECCION_ENVIO — id de la dirección de origen (desde dónde despachás).
//   ENVIOPACK_CORREO          — con la cuenta en "Red Envíopack Unificada"
//                               (ver Distribución en el panel) el valor tiene
//                               que ser literalmente 'enviopack' (probado
//                               contra la cuenta real, 11 sep 2026 — dejarlo
//                               vacío hace fallar la confirmación del envío
//                               con "No hay servicios de envio disponible").
//                               Cambiar sólo si el día de mañana se pasa a
//                               operar correos por separado (ahí sí el id de
//                               un correo puntual, ej. 'correo-argentino').
//   ENVIOPACK_SERVICIO        — 'N' clásico (default), 'P' prioritario.
//   ENVIOPACK_PESO_KG         — peso declarado por paquete (llavero: 0.3, siempre < 0.5).
//   ENVIOPACK_PAQUETE         — dimensiones "alto x ancho x largo" en cm.
const DIRECCION_ENVIO = process.env.ENVIOPACK_DIRECCION_ENVIO || '';
const CORREO = process.env.ENVIOPACK_CORREO || 'enviopack';
const SERVICIO = process.env.ENVIOPACK_SERVICIO || 'N';
const PESO_KG = Number(process.env.ENVIOPACK_PESO_KG) || 0.3;
const PAQUETE = process.env.ENVIOPACK_PAQUETE || '4x14x14'; // alto x ancho x largo (cm)

export const enviopackDisponible = Boolean(API_KEY && SECRET_KEY && DIRECCION_ENVIO);

// Provincias de Argentina — el id es letra sola (B, C, K...), tal como las
// devuelve GET /provincias de Enviopack. La doc pública dice ISO 3166-2:AR
// ("AR-B") pero la API real NO lleva el prefijo "AR-" (validado contra la
// cuenta real, 11 sep 2026 — con el prefijo, cotizar devolvía [] siempre).
// El value es el id que se manda a la API; el label, para el <select> del checkout.
export const PROVINCIAS_AR = [
  { id: 'C', nombre: 'CABA' },
  { id: 'B', nombre: 'Buenos Aires' },
  { id: 'K', nombre: 'Catamarca' },
  { id: 'H', nombre: 'Chaco' },
  { id: 'U', nombre: 'Chubut' },
  { id: 'X', nombre: 'Córdoba' },
  { id: 'W', nombre: 'Corrientes' },
  { id: 'E', nombre: 'Entre Ríos' },
  { id: 'P', nombre: 'Formosa' },
  { id: 'Y', nombre: 'Jujuy' },
  { id: 'L', nombre: 'La Pampa' },
  { id: 'F', nombre: 'La Rioja' },
  { id: 'M', nombre: 'Mendoza' },
  { id: 'N', nombre: 'Misiones' },
  { id: 'Q', nombre: 'Neuquén' },
  { id: 'R', nombre: 'Río Negro' },
  { id: 'A', nombre: 'Salta' },
  { id: 'J', nombre: 'San Juan' },
  { id: 'D', nombre: 'San Luis' },
  { id: 'Z', nombre: 'Santa Cruz' },
  { id: 'S', nombre: 'Santa Fe' },
  { id: 'G', nombre: 'Santiago del Estero' },
  { id: 'V', nombre: 'Tierra del Fuego' },
  { id: 'T', nombre: 'Tucumán' },
];
const PROVINCIA_IDS = new Set(PROVINCIAS_AR.map((p) => p.id));
export const esProvinciaValida = (id) => PROVINCIA_IDS.has(String(id || ''));

// --- Access token con cache en memoria (dura 4 h; refrescamos 5 min antes) ---
let tokenCache = { value: '', expira: 0 };

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expira) return tokenCache.value;
  const body = new URLSearchParams({ 'api-key': API_KEY, 'secret-key': SECRET_KEY });
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Enviopack auth respondió ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // La doc pública lo llama "access_token" pero la API real devuelve el campo
  // como "token" (validado contra la cuenta real, 11 sep 2026).
  const token = data.token || data.access_token;
  if (!token) throw new Error('Enviopack auth no devolvió token.');
  tokenCache = { value: token, expira: Date.now() + 3.9 * 3600_000 };
  return tokenCache.value;
}

async function apiGet(path, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${BASE}${path}?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Enviopack GET ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function apiPost(path, payload) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enviopack POST ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Cotiza un envío a domicilio. Devuelve el costo del servicio configurado
 * (Correo Argentino Clásico por defecto) o el más barato si ese no aparece.
 * @param {{ provincia: string, cp: string }} dest
 * @returns {Promise<{ costo: number, servicio: string, horasEntrega: number|null }>}
 */
export async function cotizarDomicilio({ provincia, cp }) {
  if (!enviopackDisponible) throw new Error('Enviopack no está configurado.');
  const opciones = await apiGet('/cotizar/precio/a-domicilio', {
    provincia,
    codigo_postal: String(cp),
    peso: PESO_KG.toFixed(2),
    paquetes: PAQUETE.replace(/\s/g, ''),
  });
  const lista = Array.isArray(opciones) ? opciones : [];
  if (!lista.length) throw new Error('Enviopack no devolvió cotizaciones para ese código postal.');

  const preferida = lista.find((o) => o.servicio === SERVICIO) || null;
  const elegida =
    preferida ||
    lista.reduce((min, o) => (Number(o.valor) < Number(min.valor) ? o : min), lista[0]);

  return {
    costo: Math.ceil(Number(elegida.valor)),
    servicio: elegida.servicio || SERVICIO,
    horasEntrega: elegida.horas_entrega ?? null,
  };
}

// Crea el `pedido` (orden) que un envío tiene que referenciar — POST /envios
// SIEMPRE pide un `pedido` ya existente (probado contra la cuenta real, 11 sep
// 2026: pasar un id libre como decía la doc pública tira "No existe un pedido
// con el id informado"). No hay endpoint para crear pedido + envío en un solo
// paso. `id_externo` queda como referencia (el id de la venta) para poder
// buscarlo después desde el panel de Enviopack si hace falta.
async function crearPedido(e, ventaId, montoOrden, emailComprador) {
  const [nombre, ...resto] = String(e.dest_nombre).trim().split(/\s+/);
  const payload = {
    id_externo: String(ventaId),
    nombre: nombre || e.dest_nombre,
    apellido: resto.join(' ') || '-',
    // `email` es obligatorio para Enviopack aunque la doc no lo marque así
    // (probado contra la cuenta real, 11 sep 2026: sin email o con uno
    // inválido, POST /pedidos rechaza el request). Si no tenemos el mail del
    // comprador a mano, usamos uno propio antes que fallar la venta entera.
    email: emailComprador || 'pedidos@next-tap.tech',
    telefono: e.dest_telefono || undefined,
    monto: Number(montoOrden) || 0,
    fecha_alta: new Date().toISOString().slice(0, 19).replace('T', ' '),
    pagado: true, // el pedido en NextTap ya está pago cuando se llega acá (webhook approved)
    provincia: e.provincia,
    localidad: String(e.localidad).slice(0, 50),
  };
  const data = await apiPost('/pedidos', payload);
  return data.id;
}

/**
 * Crea el envío en Enviopack. Se llama desde el webhook de Mercado Pago cuando
 * el pago se aprueba: primero crea el `pedido`, después el envío sobre ese pedido.
 * @param {object} e  fila de venta_envios ya persistida
 * @param {number|string} ventaId  id de la venta — se usa como id_externo del pedido
 * @param {number} [montoOrden]  monto de la venta (informativo para Enviopack)
 * @param {string} [emailComprador]  mail del comprador (Enviopack lo pide sí o sí)
 * @returns {Promise<{ enviopackId: string, tracking: string|null, confirmado: boolean }>}
 */
export async function crearEnvio(e, ventaId, montoOrden, emailComprador) {
  if (!enviopackDisponible) throw new Error('Enviopack no está configurado.');
  const [alto, ancho, largo] = PAQUETE.replace(/\s/g, '').split('x').map((n) => parseInt(n, 10));

  const pedidoId = await crearPedido(e, ventaId, montoOrden, emailComprador);

  const payload = {
    pedido: pedidoId,
    confirmado: true,
    modalidad: 'D',
    direccion_envio: Number(DIRECCION_ENVIO),
    destinatario: String(e.dest_nombre).slice(0, 50),
    observaciones: e.referencia || undefined,
    // Con la cuenta en "Red Envíopack Unificada", `correo` tiene que ser
    // literalmente 'enviopack' (ver CORREO arriba) — con eso Enviopack asigna
    // el carrier real solo, sin elegir Correo Argentino a mano.
    correo: CORREO || undefined,
    servicio: e.servicio || SERVICIO,
    provincia: e.provincia,
    localidad: String(e.localidad).slice(0, 50),
    codigo_postal: String(e.cp),
    calle: String(e.calle).slice(0, 50),
    numero: String(e.numero).slice(0, 5),
    piso: e.piso || undefined,
    depto: e.depto || undefined,
    paquetes: [{ alto, ancho, largo, peso: PESO_KG }],
  };

  const data = await apiPost('/envios', payload);
  return {
    enviopackId: String(data?.id ?? ''),
    tracking: data?.tracking_number || null,
    confirmado: Boolean(data?.confirmado),
  };
}

/**
 * Trae la etiqueta de un envío como PDF (Buffer). El backend la sirve al panel
 * de admin — el token nunca sale al frontend.
 * @param {string} enviopackId
 * @returns {Promise<Buffer>}
 */
export async function etiquetaPdf(enviopackId) {
  if (!enviopackDisponible) throw new Error('Enviopack no está configurado.');
  const token = await getToken();
  const res = await fetch(
    `${BASE}/envios/${encodeURIComponent(enviopackId)}/etiqueta?formato=pdf&access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) throw new Error(`Enviopack etiqueta -> ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
