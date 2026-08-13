# Contexto para continuar: Panel de Vendedor — AltoqueTap (NextTap)

Estoy trabajando en **AltoqueTap** (repo internamente llamado NextTap), un negocio de stickers NFC. El código vive en `C:\Users\Mariano\Documents\NextTap`, app en `landing/` (Vite vanilla + backend Express, en producción real con Postgres/Neon, desplegado en Vercel + Render).

## Lo que necesito en este chat

Hoy **no existe ningún login ni panel para vendedores**. Los vendedores son puramente una entidad administrada desde el panel de Admin (`vendedores` tabla: `id, nombre, codigo_ref, comision_pct, telegram_chat_id`) — no tienen forma de autenticarse ni de ver nada del sistema.

Necesito que crees un **panel de vendedor** (login + vista) para resolver esto, en el marco de un mecanismo de verificación de entrega física que ya está parcialmente implementado:

### El mecanismo de entrega verificable (ya definido, no lo rediscutas)

1. Comprador elige un producto (ej. "llavero") y paga/confirma la compra.
2. El sistema ya toma automáticamente un sticker disponible del stock asignado a ese vendedor (`SELECT ... LIMIT 1` filtrado por vendedor+modelo — esto **ya está hecho**, no es al azar).
3. Ese `codigo_publico` del sticker se muestra en la pantalla de éxito del comprador ("tu ID es `WA-0042`") — **esto ya está implementado** en `landing/src/comprar.js`, función `checkReturnFromMercadoPago()`, y estilizado con `.pickup-id` en `landing/src/styles.css`.
4. **Lo que falta**: ese mismo ID tiene que verse también del lado del vendedor, en tiempo real o casi, para que cuando busque el imprimible físico sepa cuál entregar. Hoy no hay ninguna pantalla para eso.
5. El vendedor busca el imprimible con ese ID, se lo da al comprador. El comprador coteja el ID impreso contra el que le llegó por mensaje/pantalla — si no coincide, se dio cuenta de que le dieron el equivocado.

### Lo que tenés que construir

- **Login de vendedor**: no tiene contraseña hoy (la tabla `vendedores` no tiene columna de password/whatsapp/PIN). Necesitás decidir/proponer un mecanismo simple — lo más consistente con el resto del sistema sería un código simple ya existente (`codigo_ref`, que ya es UNIQUE) + quizás un PIN nuevo, o reusar el patrón WhatsApp+OTP que ya usan los compradores (ver `POST /api/auth/otp/request` en `landing/server/index.js`, sección `--- Auth: WhatsApp + OTP ---`) si el vendedor tiene un teléfono cargado. Preguntame cuál preferís antes de implementar.
- **Panel de vendedor** (nueva página, ej. `landing/vendedor.html` + `landing/src/vendedor.js`, siguiendo el mismo patrón de `mi-panel.html`/`mi-panel.js`): debe mostrar, para el vendedor logueado, sus ventas pendientes de entrega — el `codigo_publico` de cada sticker vendido que aún no fue marcado como entregado, para que sepa qué imprimible buscar.
- **Endpoint(s) nuevos** en `landing/server/index.js`: algo como `GET /api/vendedor/pendientes` (requiere auth de vendedor) que liste stickers en etapa `vendido` asociados a ese `vendedor_id` vía la vista `stickers_actual`.
- **Opcional/deseable**: un paso de confirmación de entrega (el vendedor marca "entregado" o el comprador confirma recepción con un tap) — hoy no existe ningún estado de "entregado", solo `vendido`. Si lo agregás, tiene que integrarse con el patrón SCD2 existente vía la función `transicionarSticker(stickerId, patch)` en `index.js` (cierra la fila vigente en `sticker_estados` e inserta una nueva) — no inventes un mecanismo de update paralelo.

## Contexto técnico relevante

- Backend: Express (`landing/server/index.js`), Postgres real vía `landing/server/db.js` (Neon en producción).
- **Schema SCD tipo 2**: la tabla `stickers` solo tiene identidad inmutable (`id, codigo_publico, uid_nfc, lote_id`). Todo el estado mutable (modelo, función, vendedor_id, comprador_id, estado, etapa) vive versionado en `sticker_estados` (`vigente_desde`/`vigente_hasta`, con `vigente_hasta IS NULL` = fila actual). La vista `stickers_actual` expone el join ya resuelto — **leé de ahí, no de `stickers` directo**. Helpers ya existentes: `derivarEtapa()`, `crearEstadoInicial()`, `transicionarSticker()` en `index.js`.
- Tabla `vendedores`: `id SERIAL, nombre TEXT, codigo_ref TEXT UNIQUE NOT NULL, comision_pct REAL DEFAULT 50, telegram_chat_id TEXT, creado_en`.
- Patrones de auth ya existentes en el proyecto (seguí el mismo estilo — sesiones en tabla, cookie httpOnly, no JWT):
  - Comprador: WhatsApp + OTP → tabla `sesiones` (ver `requireAuth` middleware).
  - Admin: password compartida (`ADMIN_PASSWORD` env var) → tabla `admin_sesiones` (ver `requireAdmin` middleware).
  - Para vendedor, definí un middleware `requireVendedor` análogo, con su propia tabla de sesión si hace falta (ej. `vendedor_sesiones`) o reusando el patrón de cookie+token que ya usan los otros dos.
- Frontend: Vite vanilla, sin framework — cada página es un `.html` + `.js` standalone (ver `mi-panel.html`/`mi-panel.js` o `admin.html`/`admin.js` como referencia de estructura).
- Deployment: Vercel (frontend) + Render (backend), ambos auto-deploy desde `github.com/mariansorbo/TapNext` rama `master` al hacer push.

## Restricciones (no las reabras salvo que el usuario lo pida)

- No soy el asistente quien crea cuentas de terceros — no aplica acá, esto es 100% interno.
- No uses `git config`, no toques la identidad de git configurada (`mariansorbo` / `mariansorbogmail.com`, sin `@` — es intencional, déjala así).
- No hardcodees ninguna credencial nueva directo en el código — cualquier secreto nuevo (ej. un `VENDEDOR_SESSION_SECRET` si hiciera falta) va en `landing/.env` (gitignored) y se documenta en `landing/.env.example`.
- Seguí el patrón de "inactivo hasta que se configure" que ya usa el resto del proyecto (Google Sign-In, Mercado Pago, WhatsApp real) si el mecanismo de login que elijas depende de una integración externa opcional.

Con este contexto, ayudame a diseñar e implementar el panel de vendedor. Preguntame qué mecanismo de login preferís antes de tocar código — no asumas WhatsApp+OTP ni PIN sin confirmar.
