# Contexto para continuar: verificación de WhatsApp Business API — AltoqueTap (NextTap)

Estoy trabajando en **AltoqueTap** (repo internamente llamado NextTap), un negocio de stickers NFC. El código vive en `C:\Users\Mariano\Documents\NextTap`, app en `landing/` (Vite vanilla + backend Express, ahora en producción real con Postgres/Neon, desplegado en Vercel + Render).

## Lo que necesito en este chat

Hoy el login de compradores es passwordless por WhatsApp: se manda un código OTP de 4 dígitos. **Pero no hay integración real con WhatsApp Business API todavía** — el código se simula:

```js
// landing/server/index.js, POST /api/auth/otp/request
console.log(`[OTP demo] Código para ${whatsapp}: ${code} (expira en ${OTP_TTL_MINUTES} min)`);
res.json({ ok: true, debug_otp: code }); // el código se devuelve en la respuesta, en vez de mandarse por WhatsApp real
```

Necesito conectar esto a la **API real de WhatsApp Business** (Meta) para que el código de verificación llegue de verdad por WhatsApp al comprador, en vez de mostrarse en la demo.

## Contexto técnico relevante

- Backend: Express, en `landing/server/index.js`. El endpoint que hay que tocar es `POST /api/auth/otp/request` (arriba del archivo, cerca del inicio, sección `--- Auth: WhatsApp + OTP ---`).
- El OTP en sí ya se genera y se hashea correctamente (`generateOtp()`, `hashValue()` en `landing/server/otp.js`) — lo único que falta es el **envío real**, no la lógica de verificación.
- Mismo patrón que ya usamos para otras integraciones opcionales (Google Sign-In, Mercado Pago): queda **inactivo hasta que se carguen variables de entorno**, sin romper nada si no están. Seguí ese mismo patrón para WhatsApp: si no hay credenciales, que caiga al modo demo actual (mostrar el código, no fallar).
- Variables de entorno ya usadas en el proyecto (ver `landing/.env.example`): `DATABASE_URL`, `FRONTEND_URL`, `PUBLIC_ROUTER_BASE`, `ADMIN_PASSWORD`, `CHIP_MASTER_SECRET`, `MP_ACCESS_TOKEN`. Sumá ahí las que hagan falta para WhatsApp (algo como `WHATSAPP_BUSINESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, etc., según la API que uses).

## Decisiones ya tomadas (no las reabras salvo que el usuario lo pida)

- **No uses Twilio ni otro intermediario** salvo que el usuario lo pida explícitamente — la idea es la API oficial de Meta (WhatsApp Business Platform / Cloud API), que es gratis hasta cierto volumen de conversaciones.
- El comprador **no tiene contraseña, nunca** — el WhatsApp+OTP es el único mecanismo de login de compradores (no lo reemplaces por otra cosa).
- El admin del negocio (vos) tiene que crear la cuenta de Meta Business / WhatsApp Business Platform vos mismo — el asistente no puede crear cuentas de terceros en tu nombre. Pedile los pasos si no sabés por dónde empezar (Meta Business Manager → WhatsApp → Cloud API → número de prueba).

## Estado de producción (para que tengas contexto de qué NO romper)

- Backend ya migrado de SQLite a **Postgres real (Neon)** — funciona en producción.
- Pagos con Mercado Pago Checkout Pro ya conectados con token real.
- El flujo de compra (`comprar.html` / `pedido.html`) ya depende de este mismo OTP para loguear al comprador antes de pagar — no toques esa parte del flujo, solo el mecanismo de ENVÍO del código.

Con este contexto, ayudame a conectar el envío real de OTP por WhatsApp Business API. Preguntame lo que necesites antes de tocar código (ej. si ya tenés cuenta de Meta creada, qué tier de la API vas a usar, etc.) — no asumas que ya está todo listo del lado de Meta.
