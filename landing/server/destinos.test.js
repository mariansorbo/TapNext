import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDestino, resolverDestino, aUrlAbsoluta } from './destinos/index.js';

const ok = (tipo, entrada, esperado) =>
  assert.equal(normalizarDestino(tipo, entrada).valor, esperado, `${tipo}: ${JSON.stringify(entrada)}`);
const err = (tipo, entrada) =>
  assert.ok(normalizarDestino(tipo, entrada).error, `${tipo}: ${JSON.stringify(entrada)} debería ser error`);

// --- Instagram ----------------------------------------------------------

test('instagram: handle pelado, @handle y URL de perfil', () => {
  ok('instagram', 'tunegocio', 'https://instagram.com/tunegocio');
  ok('instagram', '@tunegocio', 'https://instagram.com/tunegocio');
  ok('instagram', 'instagram.com/tunegocio', 'https://instagram.com/tunegocio');
  ok('instagram', 'https://www.instagram.com/tunegocio/', 'https://instagram.com/tunegocio');
});

test('instagram: "instagram.com" sin usuario es error', () => {
  err('instagram', 'instagram.com');
  err('instagram', 'https://instagram.com');
  err('instagram', 'www.instagram.com/');
});

test('instagram: guion bajo / punto en el handle', () => {
  ok('instagram', '_juan', 'https://instagram.com/_juan');
  ok('instagram', '@_.juan', 'https://instagram.com/_.juan');
  ok('instagram', 'juan.perez', 'https://instagram.com/juan.perez');
  ok('instagram', 'https://instagram.com/_.juan/', 'https://instagram.com/_.juan');
  // Instagram no permite arrancar/terminar en punto: lo sacamos.
  ok('instagram', '._juan', 'https://instagram.com/_juan');
  ok('instagram', 'tunegocio.', 'https://instagram.com/tunegocio');
});

test('instagram: basura del portapapeles (invisibles, comillas, mayúsculas, ancho completo)', () => {
  ok('instagram', '  @Tunegocio  ', 'https://instagram.com/tunegocio');
  ok('instagram', '"tunegocio"', 'https://instagram.com/tunegocio');
  ok('instagram', '“tunegocio”', 'https://instagram.com/tunegocio'); // comillas tipográficas
  ok('instagram', '@tunegocio​', 'https://instagram.com/tunegocio'); // zero-width al final
  ok('instagram', '＠ｔｕｎｅｇｏｃｉｏ', 'https://instagram.com/tunegocio'); // ＠ｔｕｎｅｇｏｃｉｏ
  ok('instagram', '(instagram.com/tunegocio)', 'https://instagram.com/tunegocio');
});

test('instagram: URLs con tracking, deep links y "abrir en la app"', () => {
  ok('instagram', 'https://www.instagram.com/tunegocio?igsh=abc123==', 'https://instagram.com/tunegocio');
  ok('instagram', 'instagram.com/tunegocio/reel/CxYz123/', 'https://instagram.com/tunegocio');
  ok('instagram', 'https://instagram.com/_u/tunegocio', 'https://instagram.com/tunegocio');
  ok('instagram', 'https://instagram.com/stories/tunegocio/34567', 'https://instagram.com/tunegocio');
  ok('instagram', 'https://instagr.am/tunegocio', 'https://instagram.com/tunegocio');
});

test('instagram: rescate del arranque válido y errores honestos', () => {
  ok('instagram', 'tunegocio (mi tienda)', 'https://instagram.com/tunegocio');
  ok('instagram', 'tunegocio!', 'https://instagram.com/tunegocio');
  err('instagram', 'instagram.com/p/CxYz123'); // es un post, no un perfil
  err('instagram', '   ');
  err('instagram', '@@@');
});

test('instagram: un caracter inválido en el MEDIO es error, no un destino equivocado', () => {
  // El rescate NUNCA debe convertir "juán.pérez" en "ju" y mandar a un perfil
  // que no es. Basura solo en las puntas sí se poda.
  err('instagram', 'juán.pérez');
  err('instagram', 'josé_gonzalez');
  err('instagram', '@tu-negocio'); // Instagram no permite guiones
  err('instagram', 'tu..negocio'); // ni puntos seguidos
  ok('instagram', '...tunegocio...', 'https://instagram.com/tunegocio'); // puntas: sí
  ok('instagram', '_juan_', 'https://instagram.com/_juan_'); // guión bajo en punta: válido
});

// --- WhatsApp ----------------------------------------------------------

test('whatsapp: AR -> wa.me con 54 sin el 9', () => {
  ok('whatsapp', '11 2233 4455', 'https://wa.me/541122334455');
  ok('whatsapp', '+54 9 11 2233 4455', 'https://wa.me/541122334455');
  ok('whatsapp', '+54 11 2233 4455', 'https://wa.me/541122334455');
  ok('whatsapp', 'wa.me/5491122334455', 'https://wa.me/541122334455');
  err('whatsapp', '123');
});

test('whatsapp: saca 0 nacional y 15 viejo', () => {
  ok('whatsapp', '011 15 2233 4455', 'https://wa.me/541122334455');
  ok('whatsapp', '9 11 2233 4455', 'https://wa.me/541122334455');
  ok('whatsapp', 'https://wa.me/541122334455?text=hola', 'https://wa.me/541122334455');
});

test('whatsapp: 15 pegado a la característica y 15 sin característica (porteño)', () => {
  ok('whatsapp', '11 15 6179 1902', 'https://wa.me/541161791902');
  ok('whatsapp', '+54 11 15 6179 1902', 'https://wa.me/541161791902');
  ok('whatsapp', '15 6179 1902', 'https://wa.me/541161791902');
  ok('whatsapp', 'https://wa.me/541561791902', 'https://wa.me/541161791902');
  ok('whatsapp', '351 15 123 4567', 'https://wa.me/543511234567');
  ok('whatsapp', '11 1512 3456', 'https://wa.me/541115123456');
});

test('whatsapp: texto alrededor, etiquetas y separadores raros', () => {
  ok('whatsapp', 'mi whatsapp: 11 2233 4455', 'https://wa.me/541122334455');
  ok('whatsapp', 'Cel 11-2233-4455 (mensajes)', 'https://wa.me/541122334455');
  ok('whatsapp', 'tel:+5491122334455', 'https://wa.me/541122334455');
  ok('whatsapp', '11.2233.4455', 'https://wa.me/541122334455');
  ok('whatsapp', '​+54 9 11 2233 4455​', 'https://wa.me/541122334455');
  ok('whatsapp', '0054 9 11 2233 4455', 'https://wa.me/541122334455');
});

test('whatsapp: links wa.me/message y wa.me/qr se guardan tal cual', () => {
  ok('whatsapp', 'https://wa.me/message/ABC123XYZ', 'https://wa.me/message/ABC123XYZ');
  ok('whatsapp', 'wa.me/qr/ABC123XYZ', 'https://wa.me/qr/ABC123XYZ');
  const r = resolverDestino('whatsapp', 'https://wa.me/message/ABC123XYZ');
  assert.equal(r.modo, 'redirect');
  assert.equal(r.url, 'https://wa.me/message/ABC123XYZ');
});

test('whatsapp: internacional plausible se deja como vino', () => {
  ok('whatsapp', '+1 415 555 2671', 'https://wa.me/14155552671');
  ok('whatsapp', '+55 11 91234 5678', 'https://wa.me/5511912345678');
});

// --- Links (web / pago / menú / reseña / agenda) ----------------------

test('links: agrega https:// , valida el dominio y tolera typos', () => {
  ok('web', 'tunegocio.com', 'https://tunegocio.com/');
  ok('pago', 'https://link.mercadopago.com.ar/x', 'https://link.mercadopago.com.ar/x');
  ok('web', 'https:/tunegocio.com', 'https://tunegocio.com/'); // una sola barra
  ok('web', 'https//tunegocio.com', 'https://tunegocio.com/'); // sin los dos puntos
  ok('web', 'tunegocio,com', 'https://tunegocio.com/'); // coma por punto
  ok('web', '  <https://tunegocio.com>  ', 'https://tunegocio.com/'); // envuelto en < >
  ok('menu', 'www.tunegocio.com/carta', 'https://www.tunegocio.com/carta');
  err('web', 'no-es-un-dominio');
  err('web', '');
});

// --- resolver ---------------------------------------------------------

test('resolverDestino: whatsapp -> modo app (intent Android + fallback web)', () => {
  const r = resolverDestino('whatsapp', 'https://wa.me/5491122334455');
  assert.equal(r.modo, 'app');
  assert.equal(r.web, 'https://api.whatsapp.com/send?phone=541122334455');
  assert.match(r.intent, /^intent:\/\/send\?phone=541122334455#Intent;.*package=com\.whatsapp/);
  assert.match(r.intent, /browser_fallback_url=/);
});

test('resolverDestino: el resto da un redirect a URL absoluta', () => {
  assert.equal(resolverDestino('instagram', 'instagram.com/x').url, 'https://instagram.com/x');
  assert.equal(resolverDestino('web', 'tunegocio.com/menu').url, 'https://tunegocio.com/menu');
});

test('aUrlAbsoluta: no toca URLs ya absolutas, completa las relativas', () => {
  assert.equal(aUrlAbsoluta('https://instagram.com/x'), 'https://instagram.com/x');
  assert.equal(aUrlAbsoluta('instagram.com/x'), 'https://instagram.com/x');
  assert.equal(aUrlAbsoluta(''), null);
});

test('tipo inválido / valor vacío', () => {
  err('no-existe', 'x');
  err('instagram', '   ');
});
