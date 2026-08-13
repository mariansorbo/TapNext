# Contexto para continuar: flujo de personalización y compra — AltoqueTap

Estoy trabajando en **AltoqueTap**, un negocio de stickers NFC (con case 3D) que al tapear redirigen a un destino configurable (WhatsApp, Instagram, link de pago, menú, etc.). El proyecto vive en `C:\Users\Mariano\Documents\NextTap`, carpeta principal `landing/` (Vite vanilla multi-página + backend Express).

Necesito que entiendas el **flujo actual de personalización y compra** antes de seguir trabajando. Leé estos archivos para reconstruir el contexto:

## Arquitectura general
- Frontend: Vite vanilla, multi-página (`rollupOptions.input` en `landing/vite.config.js`): `index.html`, `pedido.html`, `comprar.html`, `mi-panel.html`, `faqs.html`, `admin.html`.
- Backend: Express (`landing/server/index.js`) + DB `@libsql/client` (SQLite-compatible, local por ahora vía `file:`, listo para Turso con env vars).
- Dev: `npm run dev:full` (concurrently) levanta API (Express) + Vite. Proxy `/api` → backend en dev; en prod, `VITE_API_BASE` apunta al backend en Render.

## Flujo de compra (hay DOS variantes que comparten un mismo módulo JS)
- **`comprar.html`** (flujo presencial: vendedor entrega el sticker en mano, sin envío) y **`pedido.html`** (flujo online regular, con envío) comparten `landing/src/comprar.js`.
- Se distinguen por `document.body.dataset.flow === 'presencial'` (NO por query param `?ref=`).
- `STEP_SEQUENCE` en `comprar.js` arma los pasos: función → modelo → destino + aceptación de TyC → confirmación WhatsApp/OTP → (paso de envío SOLO si no es presencial) → pago.
- El paso de OTP en el wizard de compra acepta cualquier valor no vacío (a pedido explícito, no valida longitud real).
- El precio/plazo de envío se simula a partir de la suma de dígitos del código postal (no hay integración real de correo).
- Pago: **totalmente simulado**, no hay Mercado Pago integrado todavía (decisión explícita: "mercadopago todavia no lo integres").
- Importante (RF-10/RF-11): **no se crea comprador ni venta persistente antes de confirmar el pago** — hoy el wizard de compra sigue sin pegarle al backend real (no genera venta real todavía). Esto es un pendiente conocido.

## Flujo de personalización / gestión post-compra (`mi-panel.html` + `src/mi-panel.js`)
- Login passwordless: WhatsApp + OTP (RF-12/13), sin contraseñas. Endpoints: `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`.
- En dev, el input de WhatsApp viene precargado con el número demo (`+5491122334455`, ver `landing/server/seed.js`) y el código OTP se autocompleta solo en el input (usa `data.debug_otp` que devuelve el backend en modo demo) — esto es solo para agilizar pruebas locales, no existe en producción real (ahí no hay WhatsApp Business API conectada todavía).
- Google Sign-In: preparado como login alternativo/vinculado (OAuth2 authorization-code flow), pero queda inactivo hasta cargar `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`.
- Dashboard del comprador (`dashboard-view` en `mi-panel.html`):
  - Título "Mis NFC's" + lista de stickers (`GET /api/me/stickers`), cada uno con estado (`activo`, `vendido_pendiente`, `en_stock`, `inactivo`).
  - Si el sticker está `activo`, se puede editar su destino inline (tipo + valor) vía `PATCH /api/stickers/:id/destino`.
  - Si está `vendido_pendiente` (recién comprado, primer tap todavía no hecho), no tiene destino y el panel lo marca como "sin activar" — **PERO no existe todavía una pantalla de activación real** (RF-08/09 pendiente): hoy tapear un sticker `vendido_pendiente` simplemente redirige a la landing (`GET /v/:codigo` en `server/index.js` cae a `FRONTEND_URL` si no hay destino activo). Falta construir el flujo de "primer tap": aceptar TyC + confirmar WhatsApp + elegir destino inicial para pasar el sticker a `activo`.
  - Debajo de la lista de stickers: sección opcional de mail de respaldo (`account-email`), para notificaciones si cambia un destino, por si el usuario pierde su WhatsApp. Guarda vía `PATCH /api/me`.

## Router público NFC (lo que apunta el chip físico)
- `GET /v/:codigo` en `landing/server/index.js`: busca el sticker por `codigo_publico`, si `estado==='activo'` y tiene destino, redirige (302) a `destino.valor`; si no, cae a la landing (`FRONTEND_URL`).
- Seguridad del chip (RS-01/RS-02): la contraseña de escritura NFC (`PWD_AUTH`) se deriva con `HMAC-SHA256(CHIP_MASTER_SECRET, uid_nfc)` — nunca se persiste, se muestra una sola vez en el panel Admin al dar de alta un chip real desde el taller.
- Códigos públicos no secuenciales (RS-03), rate limiting básico por IP (RS-05).

## Admin panel (`admin.html` + `src/admin.js`)
- Login por password compartida (env var `ADMIN_PASSWORD`), gate `requireAdmin`.
- Secciones: Vendedores (ABM completo con edición inline y borrado), Inventario de stickers (alta en lote + alta individual desde el taller con UID real), Ventas, Comisiones (cálculo/liquidación por vendedor).
- Separación estricta de permisos (RF-22): Admin no toca `destinos` de compradores.

## Pendientes conocidos (no resolver salvo que se pida)
1. Pantalla de activación real del sticker (primer tap, `vendido_pendiente` → `activo`).
2. Conectar el wizard de compra (`comprar.js`) al backend real (hoy todo simulado, no genera venta real).
3. Integración real de Mercado Pago, WhatsApp Business API, envío de mails, correo/envíos, y persistencia real en Turso (hoy DB local efímera en Render free tier).
4. Posible ampliación del panel de usuario: editar nombre, ver historial de cambios de destino, eliminar cuenta.

## Reglas de trabajo importantes (respetar sin excepción)
- **"El Obsidian no importa, la app"**: no tocar ni actualizar notas de Obsidian, todo el esfuerzo va al código de la app.
- Nunca correr `git config` ni crear cuentas de terceros (Vercel, Render, Google Cloud, Turso) en nombre del usuario — eso lo hace el usuario siempre.
- El identity de git quedó intencionalmente como `mariansorbo` / `mariansorbogmail.com` (sin @) — no "corregirlo", el usuario lo dejó así a propósito.
- Colores del logo: "Tap" va en badge/pill violeta (paleta existente), nunca naranja.
- Usar Git Bash para comandos npm/node (PowerShell tiene la execution policy restringida y no se debe tocar).

Con este contexto, quiero que sigamos trabajando sobre el flujo de compra/personalización. Confirmame que entendiste el estado actual antes de proponerme próximos pasos.
