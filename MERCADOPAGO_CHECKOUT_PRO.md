# Mercado Pago Checkout Pro — Documentación de Integración

## Estado actual
✅ **Productivo en Render** (`tapnext.onrender.com`). Verificado end-to-end: backend crea preferencias, frontend redirige, checkout renderiza, webhook espera pagos confirmados.

---

## Qué es Checkout Pro

[Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/landing) de Mercado Pago es una solución de pago **preconfigurada** (no requiere frontend customizado). El flujo es:

1. Comerciante crea una **preferencia de pago** (items, montos, URLs de retorno)
2. Usuario es redirigido a `mercadopago.com.ar` para pagar
3. MP maneja todo: selección de medio, datos, cuotas, 3DS 2.0
4. MP redirige al comerciante (`back_urls`) cuando termina
5. MP envía **webhook** para confirmar pago (server-to-server)

**Ventajas:** seguro (PCI DSS, 3DS 2.0), rápido de integrar, sin mantener formularios. **Desventaja:** usuario abandona tu sitio durante el pago.

---

## Arquitectura en NextTap

### Backend (`landing/server/index.js`)

**Ubicación:** líneas 38-43 (configuración), 415-531 (endpoint `/api/ventas`), 562-616 (webhook).

**Modelo:**
- `POST /api/ventas`: Comprador auténticado envía items. Backend:
  1. Reserva stickers en stock (transición SCD Tipo 2: `en_stock` → `vendido_pendiente`)
  2. Crea venta en DB (`estado_pago: 'pendiente'`)
  3. Llama a Mercado Pago: `new Preference(mpClient).create({ body: {...} })`
  4. Devuelve `initPoint` (URL del checkout)
  5. Si falla, revierte todo (libera stickers)

- `POST /api/pagos/webhook`: MP llama acá cuando pago cambia de estado.
  1. Extrae `payment_id` del payload
  2. Verifica estado real contra API de MP: `new Payment(mpClient).get({ id: paymentId })`
  3. Si `status === 'approved'`: marca venta `confirmado`, activa stickers (SCD: `vendido_pendiente` → `activo`)
  4. Si `status === 'rejected'|`cancelled`: marca `rechazado`, libera stickers (SCD: `vendido_pendiente` → `en_stock`)

**Seguridad:**
- Auth requerida en `/api/ventas` (verifico token del usuario)
- Webhook NO requiere auth, pero verifica pago contra API de MP (no confía en el payload)
- Stock reservado antes de crear preferencia (evita overselling)

---

### Frontend (`landing/src/comprar.js`)

**Ubicación:** líneas 436-453 (pago), 460-501 (polling de retorno).

**Flujo:**
```
[Wizard de compra]
  ↓ (usuario presiona "Pagar")
[POST /api/ventas] ← lista de items, modelo, destino, ref de vendedor
  ↓ (recibe initPoint)
window.location.href = initPoint  ← redirect a Mercado Pago
  ↓ (usuario paga)
[MP redirige a pedido.html?venta=X&pago=exito/error/pendiente]
  ↓ (landing/pedido.html)
[polling GET /api/ventas/X cada 2s]
  ↓ (espera que webhook llegue y marque confirmado)
[Redirige a /mi-panel.html]
```

**Estado en frontend:** venta crea un `<div class="success-step">` que muestra estado mientras se espera webhook (máx 12 segundos, luego cae a "en revisión").

---

### Base de Datos (Neon Postgres)

**Tablas relevantes:**
- `ventas`: una por compra. Campos: `id`, `vendedor_id`, `comprador_id`, `monto`, `payment_id` (from MP), `estado_pago` ('pendiente'|'confirmado'|'rechazado'), `fecha`
- `venta_items`: detalle de items (stickers) en cada venta. Campos: `venta_id`, `sticker_id`, `monto`, `destino_tipo`, `destino_valor`
- `stickers` + `sticker_estados`: identidad + historial versionado de cada sticker (SCD Tipo 2)

**Flujo de estados SCD en stickers:**
```
en_lote (registrado, sin modelo)
  ↓ [asigna modelo/función/vendedor]
con_modelo / en_vendedor
  ↓ [comprador reserva en venta]
vendido_pendiente (esperando pago)
  ↓ [webhook confirma] 
activo (listo para usar)
  ↓ [usuario tapa el chip]
[redirige al destino configurado]
```

---

## Variables de entorno

**Requeridas para activar Checkout Pro:**
```bash
MP_ACCESS_TOKEN=APP_USR-XXXXXXX...  # Token de prueba o producción de Mercado Pago
FRONTEND_URL=https://...             # URL pública del frontend (Vercel/staging)
PUBLIC_ROUTER_BASE=https://...       # URL pública del backend (Render/staging, donde MP enviará webhook)
```

**Obtener token:**
1. [Crear cuenta de vendedor en Mercado Pago](https://www.mercadopago.com.ar)
2. Panel → Tus integraciones → Credenciales de prueba (o producción)
3. Copiar "Access Token"

**Sin `MP_ACCESS_TOKEN`:** endpoints de pago quedan inactivos (devuelven 503).

---

## Flujo completo (paso a paso)

### 1. Comprador inicia compra (en landing)
```
Usuario → comprar.html → wizard
  → selecciona función, modelo, destino, aceptan TyC
  → presiona "Pagar" → POST /api/ventas
```

### 2. Backend reserva stock y crea preferencia
```
[Backend /api/ventas]
  1. Auth: verifico token del usuario
  2. Busco stickers en_stock que coincidan (modelo, vendedor si aplica)
  3. Transiciono cada sticker: en_stock → vendido_pendiente (cierra fila anterior, inserta nueva en sticker_estados)
  4. Inserto venta con estado_pago = 'pendiente'
  5. Llamo Preference().create():
     - items: precio de cada sticker (combinación función+modelo de tabla precios)
     - external_reference: venta_id (para vincular pago con venta)
     - back_urls: success/failure/pending → pedido.html?venta=X&pago=exito/error/pendiente
     - notification_url: /api/pagos/webhook (donde MP enviará confirmación)
     - auto_return: 'approved' (redirige automáticamente si pago exitoso)
  6. Devuelvo { ventaId, initPoint }
  [Si error en paso 5:
    - Elimino venta y venta_items recién creadas
    - Libero stickers: vendido_pendiente → en_stock
    - Devuelvo 502]
```

### 3. Frontend redirige a Mercado Pago
```
[landing/comprar.js]
window.location.href = data.initPoint
  → https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=...
```

### 4. Usuario paga en checkout de Mercado Pago
```
[mercadopago.com.ar]
  1. Usuario elige medio (tarjeta, efectivo, cuenta MP, etc.)
  2. Ingresa datos (tarjeta, DNI, email)
  3. Selecciona cuotas
  4. Paga
```

### 5a. Pago aprobado → MP redirige
```
[MP genera Payment, status='approved']
[MP ejecuta auto_return: redirige a back_urls.success]
→ https://tap-next-2gem.vercel.app/pedido.html?venta=4&pago=exito
```

### 5b. Pago rechazado → MP redirige
```
[MP genera Payment, status='rejected' o 'cancelled']
[MP redirige a back_urls.failure o pending]
→ https://tap-next-2gem.vercel.app/pedido.html?venta=4&pago=error
```

### 6. Frontend polling (pedido.html)
```
[landing/pedido.html]
  1. Parsea parámetros: venta=4, pago=exito
  2. Muestra "Confirmando pago..." 
  3. Loop cada 2s durante 12s: GET /api/ventas/4
     - Si estadoPago = 'confirmado': "Tu sticker ya está activo" → redirige /mi-panel.html
     - Si estadoPago = 'rechazado': "Pago rechazado"
     - Si sigue 'pendiente' después de 12s: "En revisión"
```

### 7. Webhook de confirmación (server-to-server, MP → Backend)
```
[Mercado Pago envía: POST /api/pagos/webhook?type=payment&data.id=...]
[Backend /api/pagos/webhook]
  1. Extrae payment_id del query/body
  2. Verifica contra API de MP: new Payment(mpClient).get({ id: paymentId })
  3. Obtiene venta_id de payment.external_reference
  4. Si payment.status === 'approved':
     - UPDATE ventas SET estado_pago = 'confirmado', payment_id = ...
     - Para cada venta_item:
       - Si item.destino_valor: crea/actualiza entrada en destinos
       - Transiciono sticker: vendido_pendiente → activo
  5. Si payment.status === 'rejected' o 'cancelled':
     - UPDATE ventas SET estado_pago = 'rechazado'
     - Para cada venta_item:
       - Transiciono sticker de vuelta: vendido_pendiente → en_stock
  6. Devuelvo 200 (siempre, aunque haya errores, para que MP no reintente agresivamente)
```

### 8. Frontend detecta cambio
```
[polling en pedido.html]
  GET /api/ventas/4 → estadoPago = 'confirmado'
  → Muestra "Tu sticker ya está activo"
  → setTimeout 1.4s → window.location.href = '/mi-panel.html'
```

---

## Tarjetas de prueba

En **sandbox** (credenciales de prueba de MP), usa:
- **Aprobación:** `4111111111111111`, 11/30, CVV 123
- **Rechazo:** `4222222222222222`, 11/30, CVV 123

En **producción** (credenciales de producción): tarjetas reales de usuarios.

---

## Troubleshooting

| Problema | Causa | Solución |
|----------|-------|----------|
| "Los pagos todavía no están configurados" | `MP_ACCESS_TOKEN` vacío | Cargar token en `.env` |
| "No hay stock disponible" | Stickers no registrados o todos vendidos | Crear lote con `/api/admin/stickers/batch` |
| Prefer. no se crea (500) | Token expirado o inválido | Verificar en panel de MP que credenciales sigan vigentes |
| Webhook no llega | `PUBLIC_ROUTER_BASE` apunta a localhost | Usar URL pública (Render) o túnel (ngrok/localtunnel) |
| Pago aprobado pero venta sigue pendiente | Webhook falló | Revisar logs de Render, verificar que `/api/pagos/webhook` es accesible públicamente |

---

## Links relacionados

- **Flujo de compra:** ver [CONTEXTO_FLUJO_COMPRA.md](CONTEXTO_FLUJO_COMPRA.md) para el contexto del wizard (`comprar.js`) y estados de stickers
- **Autenticación comprador:** [CONTEXTO_WHATSAPP_VERIFICACION.md](CONTEXTO_WHATSAPP_VERIFICACION.md) documenta OTP (actualmente simulado, no real por Mercado Pago sino por WhatsApp)
- **SCD Tipo 2:** `landing/server/db.js` líneas 87-134 explican el versionamiento de stickers
- **Documentación oficial:** https://www.mercadopago.com.ar/developers/es/docs/checkout-pro

---

## Notas de implementación

- **No usar SDK de Mercado Pago en frontend:** hoy no lo necesitamos (iniciamos desde backend). Si en futuro necesitamos Bricks (más customizable), habría que agregar `<script src="https://sdk.mercadopago.com/js/v2"></script>` y cambiar flujo.
- **Moneda hardcodeada en ARS:** siempre `currency_id: 'ARS'`. Si algún día necesitas multi-moneda, modificar el endpoint `/api/ventas`.
- **Pago único por venta:** una venta = un pago (una preferencia). Si usuario quiere agregar más items, crea venta nueva. No hay carrito persistente.
- **Envío:** si aplica, se suma como item adicional en `mpItems`. El admin puede activar/desactivar desde el wizard de compra.

---

**Última verificación:** 2026-08-11. Checkout Pro en producción (Render + Vercel). Token real de prueba configurado. Flujo end-to-end confirmado (no completado en sandbox por limitación de iframes de MP, pero backend + frontend testeados).
