# NextTap (AltoqueTap)

Stickers NFC con impresión 3D propia: un toque conecta a los clientes de un negocio con su WhatsApp, Instagram, menú, pagos o reseñas — sin apps, sin QR.

- **Producción**: [next-tap.tech](https://next-tap.tech) (frontend, Vercel) + `https://tapnext.onrender.com` (backend, Render)
- **Repo**: `github.com/mariansorbo/TapNext`, rama `master` (auto-deploy en push, tanto Vercel como Render)

## Stack

- **Frontend**: Vite vanilla (sin framework), multi-página — cada `.html` en `landing/` tiene su `.js` en `landing/src/`.
- **Backend**: Express (`landing/server/index.js`).
- **Base de datos**: Postgres real (Neon en producción). Cliente `pg` con un shim propio (`landing/server/db.js`) que traduce placeholders `?` a `$1, $2...` y autoinyecta `RETURNING id` en los `INSERT`.
- **Pagos**: Mercado Pago Checkout Pro (ver [MERCADOPAGO_CHECKOUT_PRO.md](MERCADOPAGO_CHECKOUT_PRO.md)).
- **Auth**: passwordless por WhatsApp+OTP para compradores, password compartida por env var para admin, email **o** WhatsApp + password para vendedores. Sin JWT — sesiones en tablas propias + cookie httpOnly.
- **Comisiones**: por defecto un `comision_pct` fijo por vendedor sobre `ventas.monto`. Existe un modelo alternativo de **comisión variable por tramos** (escala marginal por unidad/día + deuda por faltas + bono de sábado), inerte hasta que el admin lo activa desde su panel (`comision_modelo.activo`). Motor en `server/comision.js` / `server/comision-core.js` (con tests: `npm test`). Ver `NextTap - Knowledge/Knowledge/Comisiones variables - politica.md`.

## Estructura

```
landing/
  index.html          landing pública
  comprar.html         wizard de compra presencial (una tarjeta-combo por función+modelo, stepper por combo)
  pedido.html           wizard de compra online (mismo wizard, sin vendedor)
  mi-panel.html          panel del comprador (configurar destino del sticker)
  admin.html              panel de administración (stock, vendedores, precios, ventas)
  vendedor.html             panel de vendedor (pendientes de entrega)
  faqs.html
  src/                       JS de cada página + módulos compartidos (brand.js, brand-icons.js, faq.js)
  server/
    index.js                   API Express (todos los endpoints)
    db.js                        conexión Postgres + schema DDL + shim de queries + backfills
    comision.js / comision-core.js   motor de la comisión variable por tramos
    comision.test.js               tests del motor (node --test)
    seed.js                       datos dummy para desarrollo
    otp.js / correo.js              generación de OTP, envío de mails
    verificacion/                   canales de verificación del comprador (email / whatsapp)
```

## Modelo de datos: stickers (SCD tipo 2)

La tabla `stickers` solo guarda identidad inmutable (`id`, `codigo_publico`, `uid_nfc`, `lote_id`). Todo lo que cambia con el tiempo (modelo, función, vendedor, comprador, estado, etapa) vive versionado en `sticker_estados` (`vigente_desde`/`vigente_hasta`, `vigente_hasta IS NULL` = fila vigente). La vista `stickers_actual` expone el join resuelto — es lo que casi todo el código lee. Helpers en `server/index.js`: `derivarEtapa()`, `crearEstadoInicial()`, `transicionarSticker()`.

## Desarrollo local

Requiere Node 18+ y acceso a un Postgres (local o una instancia de desarrollo hosteada).

```bash
cd landing
npm install
cp .env.example .env      # completá al menos DATABASE_URL
npm run seed               # datos dummy
npm run dev:full            # API (puerto 3001) + Vite (puerto 5173) en paralelo
```

Sin las demás variables de entorno (Mercado Pago, WhatsApp, Google, admin), esas features quedan simplemente inactivas — no rompen nada.

## Variables de entorno

Ver [landing/.env.example](landing/.env.example) para el detalle completo. Resumen:

| Variable | Obligatoria | Qué habilita |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a Postgres |
| `FRONTEND_URL` | No (default localhost) | Redirects de OAuth y Mercado Pago |
| `PUBLIC_ROUTER_BASE` | No | URL grabada en los chips NFC reales |
| `ADMIN_PASSWORD` | No | Acceso al panel de admin |
| `CHIP_MASTER_SECRET` | No | Programación de chips NFC reales (RS-01/RS-02) |
| `MP_ACCESS_TOKEN` | No | Pagos reales con Mercado Pago |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | No | Login alternativo por Google |
| `WHATSAPP_BUSINESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TEMPLATE_NAME` | No | Envío real de OTP por WhatsApp (si faltan, modo demo) |

## Deploy

Push a `master` dispara auto-deploy en ambos servicios:

- **Vercel** sirve `landing/` como sitio estático (build de Vite).
- **Render** corre `landing/server/index.js` como servicio Node, contra el mismo Postgres (Neon) que producción.

Las variables de entorno de producción se cargan directo en el dashboard de cada proveedor — nunca se commitean.

## Docs de contexto para trabajo futuro

- [CONTEXTO_WHATSAPP_VERIFICACION.md](CONTEXTO_WHATSAPP_VERIFICACION.md) — conectar el envío real de OTP por WhatsApp Business API (hoy en modo demo).
- [CONTEXTO_PANEL_VENDEDOR.md](CONTEXTO_PANEL_VENDEDOR.md) — contexto original del panel de vendedor (ya implementado).
- [CONTEXTO_FLUJO_COMPRA.md](CONTEXTO_FLUJO_COMPRA.md) — contexto del flujo de compra/carrito.
- [MERCADOPAGO_CHECKOUT_PRO.md](MERCADOPAGO_CHECKOUT_PRO.md) — integración de pagos.
