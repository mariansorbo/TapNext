import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDestino, resolverDestino, aUrlAbsoluta } from './destinos/index.js';

const ok = (tipo, entrada, esperado) =>
  assert.equal(normalizarDestino(tipo, entrada).valor, esperado, `${tipo}: ${JSON.stringify(entrada)}`);
const err = (tipo, entrada) =>
  assert.ok(normalizarDestino(tipo, entrada).error, `${tipo}: ${JSON.stringify(entrada)} debería ser error`);
const errMatch = (tipo, entrada, re) => {
  const { error } = normalizarDestino(tipo, entrada);
  assert.ok(error && re.test(error), `${tipo}: ${JSON.stringify(entrada)} -> mensaje esperado ${re}, fue ${JSON.stringify(error)}`);
};

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

// --- Reseñas ---------------------------------------------------------------

test("reseña: g.page/r/CODIGO se deja en /review", () => {
  ok("review", "g.page/r/CAbc123/review", "https://g.page/r/CAbc123/review");
  ok("review", "https://g.page/r/CAbc123", "https://g.page/r/CAbc123/review");
  ok("review", "https://www.g.page/r/CAbc123/review/", "https://g.page/r/CAbc123/review");
});

test("reseña: acepta cualquier link válido, sin rechazar por dominio ni formato", () => {
  const links = [
    "https://g.page/minegocio/review?gm", // formato viejo con nombre propio
    "https://g.page/r/CAbc-_123/review?utm=x",
    "https://search.google.com/local/writereview?placeid=ChIJ_abc-123&hl=es",
    "https://g.co/kgs/AbC123",
    "https://share.google/AbC123",
    "https://goo.gl/maps/AbC123",
    "https://maps.app.goo.gl/XyZ123",
    "https://www.google.com/maps/place/Tu+Local/@-34.6,-58.4,17z",
    "https://www.google.com/search?q=mi+local#lrd=0x95bcca:0x1f,3",
    "https://www.tripadvisor.com.ar/UserReviewEdit-g1-d2-Local.html",
    "https://www.facebook.com/minegocio/reviews",
    "tunegocio.com/resenas",
  ];
  for (const l of links) {
    const r = normalizarDestino("review", l);
    assert.ok(r.valor && !r.error, "review: " + l + " debería aceptarse, fue " + JSON.stringify(r));
  }
  // el link del formato viejo se guarda tal cual, sin tocarlo
  ok("review", "https://g.page/minegocio/review?gm", "https://g.page/minegocio/review?gm");
  ok("review", "https://search.google.com/local/writereview?placeid=ChIJ_abc-123&hl=es", "https://search.google.com/local/writereview?placeid=ChIJ_abc-123&hl=es");
});

test("reseña: extrae el link de un texto pegado (Compartir de Maps, mensajes, envoltorios)", () => {
  // Compartir desde la app de Maps: nombre + dirección + link
  ok("review", "Café Ejemplo\nAv. Corrientes 1234, CABA\nhttps://maps.app.goo.gl/AbC123", "https://maps.app.goo.gl/AbC123");
  ok("review", "Café Ejemplo Av. Corrientes 1234, CABA https://maps.app.goo.gl/AbC123", "https://maps.app.goo.gl/AbC123");
  // mensaje con texto y punto final
  ok("review", "Dejanos tu reseña: https://g.page/r/CAbc123/review.", "https://g.page/r/CAbc123/review");
  ok("review", "(https://g.page/r/CAbc123/review)", "https://g.page/r/CAbc123/review");
  ok("review", "<https://g.page/minegocio/review?gm>", "https://g.page/minegocio/review?gm");
  // copiado de HTML y con invisibles / espacio duro
  ok("review", "https://search.google.com/local/writereview?placeid=ChIJabc&amp;hl=es", "https://search.google.com/local/writereview?placeid=ChIJabc&hl=es");
  ok("review", "​https://g.page/r/CAbc123/review ", "https://g.page/r/CAbc123/review");
  // sin esquema, dentro de una frase
  ok("review", "mi link es g.page/r/CAbc123", "https://g.page/r/CAbc123/review");
  // varios links: gana el de Google/Maps
  ok("review", "Web https://tunegocio.com y reseñas https://g.page/r/CAbc123/review", "https://g.page/r/CAbc123/review");
  // link largo de Maps con coordenadas, tildes codificadas y "!" internos
  const largo = "https://www.google.com/maps/place/Caf%C3%A9+Ejemplo/@-34.6037,-58.3816,17z/data=!3m1!4b1!4m6!3m5!1s0x95bcca:0x1f!8m2!3d-34.6!4d-58.38!16s%2Fg%2F11abc?entry=ttu";
  ok("review", largo, largo);
  ok("review", "Café Ejemplo " + largo, largo);
});

test("reseña: texto suelto o mails no se toman por link", () => {
  err("review", "Av.Corrientes 1234 CABA");
  err("review", "escribime a info@tunegocio.com");
  err("review", "Café Ejemplo");
});

test("reseña: solo falla lo que no es un link", () => {
  err("review", "");
  err("review", "no-es-un-dominio");
  err("review", "@minegocio");
  err("review", "11 5555 4444");
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

// --- Mensajes de error indicativos (dicen QUÉ pasó) --------------------

test('whatsapp: prueba cada número cuando hay varios', () => {
  ok('whatsapp', '+54 9 11 2233 4455 / 11 5555 6666', 'https://wa.me/541122334455');
  ok('whatsapp', '11 2233 4455 o 11 5555 6666', 'https://wa.me/541122334455');
  ok('whatsapp', '11 2233 4455, escribime ahí', 'https://wa.me/541122334455');
});

test('whatsapp: el error dice el motivo', () => {
  errMatch('whatsapp', '11 LLAMAME ya', /letras/i);
  errMatch('whatsapp', '+54 11 223', /corto/i);
  errMatch('whatsapp', '112233445511223399', /d[ií]gitos|uno solo/i);
});

test('instagram: el error dice el motivo', () => {
  errMatch('instagram', 'juán.pérez', /acento|ñ/i);
  errMatch('instagram', 'mi tienda de ropa', /una?\s+(sola\s+)?palabra|solo tu usuario|frase/i);
  errMatch('instagram', 'instagram.com', /usuario después|falt/i);
  errMatch('instagram', 'instagram.com/reel/Cx123', /publicaci[oó]n|perfil/i);
});

test('links: rechaza un @usuario o un teléfono con mensaje claro', () => {
  errMatch('pago', '@tunegocio', /usuario.*no.*link|link/i);
  errMatch('web', '11 2233 4455', /tel[eé]fono/i);
  ok('pago', 'link.mercadopago.com.ar/tunegocio', 'https://link.mercadopago.com.ar/tunegocio');
});

// --- Alias (datos de transferencia, modo landing) ----------------------

const CBU_OK = '2850590940904130000126';
const CUIT_OK = '20312345677';
const aliasCrudo = (o) => JSON.stringify(o);

test('alias: normaliza y guarda JSON con los campos limpios', () => {
  const { valor } = normalizarDestino(
    'alias',
    aliasCrudo({ alias: '  Mariano.MP ', titular: 'Mariano   Pastore', banco: 'Banco Galicia', cbu: `${CBU_OK}`, cuit: '20-31234567-7' })
  );
  const d = JSON.parse(valor);
  assert.equal(d.alias, 'mariano.mp');
  assert.equal(d.titular, 'Mariano Pastore');
  assert.equal(d.banco, 'Banco Galicia');
  assert.equal(d.cbu, CBU_OK);
  assert.equal(d.cuit, CUIT_OK);
});

test('alias: titular y banco son opcionales', () => {
  const { valor, error } = normalizarDestino('alias', aliasCrudo({ alias: 'tienda.ok', titular: '', banco: '' }));
  assert.equal(error, undefined);
  const d = JSON.parse(valor);
  assert.equal(d.alias, 'tienda.ok');
  assert.equal(d.titular, '');
  assert.equal(d.banco, '');
});

test('alias: CBU y CUIT son opcionales', () => {
  const { valor, error } = normalizarDestino('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'Juana Perez', banco: 'Naranja X' }));
  assert.equal(error, undefined);
  const d = JSON.parse(valor);
  assert.equal(d.cbu, undefined);
  assert.equal(d.cuit, undefined);
});

test('alias: errores con motivo', () => {
  errMatch('alias', aliasCrudo({ alias: 'ab', titular: 'x', banco: 'y' }), /6 a 20/);
  errMatch('alias', aliasCrudo({ alias: 'tienda_ok', titular: 'Juana', banco: 'y' }), /6 a 20/);
  errMatch('alias', aliasCrudo({ alias: 'a'.repeat(25), titular: 'Juana', banco: 'y' }), /6 a 20/);
  // Titular y banco son opcionales (f885f9b), pero si vienen se validan.
  errMatch('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'J', banco: 'y' }), /titular/i);
  errMatch('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'Juana', banco: 'b'.repeat(41) }), /banco/i);
  errMatch('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'Juana', banco: 'MP', cbu: '123' }), /22 d[ií]gitos/);
  errMatch('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'Juana', banco: 'MP', cbu: CBU_OK.slice(0, -1) + '0' }), /no es v[aá]lido/);
  errMatch('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'Juana', banco: 'MP', cuit: '11112222333' }), /CUIT|CUIL/);
  errMatch('alias', 'no es json', /datos de transferencia/i);
});

test('alias: resolver devuelve modo landing con los datos', () => {
  const { valor } = normalizarDestino('alias', aliasCrudo({ alias: 'tienda.ok', titular: 'Juana Perez', banco: 'Galicia', cbu: CBU_OK }));
  const r = resolverDestino('alias', valor);
  assert.equal(r.modo, 'landing');
  assert.equal(r.datos.alias, 'tienda.ok');
  assert.equal(r.datos.cbu, CBU_OK);
  assert.equal(r.datos.cuit, null);
});

test('alias: resolver tolera una fila vieja / rota', () => {
  const r = resolverDestino('alias', 'algo viejo sin json');
  assert.equal(r.modo, 'landing');
  assert.equal(typeof r.datos.alias, 'string');
});

// --- Custom (página con WhatsApp + Instagram) ---------------------------

// El registry recibe siempre string (como llega del front).
const J = JSON.stringify;

test('custom: normaliza WhatsApp e Instagram con los parsers de cada función', () => {
  const r = normalizarDestino('custom', J({ nombre: '  Juan  Pérez ', bio: 'Plomero', whatsapp: '11 2233 4455', instagram: '@juan.plomero' }));
  assert.ok(r.valor, r.error);
  assert.deepEqual(JSON.parse(r.valor), {
    nombre: 'Juan Pérez',
    bio: 'Plomero',
    whatsapp: 'https://wa.me/541122334455',
    instagram: 'https://instagram.com/juan.plomero',
  });
});

test('custom: alcanza con uno de los dos', () => {
  assert.ok(normalizarDestino('custom', J({ nombre: 'X', whatsapp: '11 2233 4455' })).valor);
  assert.ok(normalizarDestino('custom', J({ nombre: 'X', instagram: 'juan' })).valor);
});

test('custom: errores (sin nombre, sin redes, número o usuario inválido, no-JSON)', () => {
  err('custom', J({ nombre: '', whatsapp: '11 2233 4455' }));
  err('custom', J({ nombre: 'X' }));
  err('custom', J({ nombre: 'X', whatsapp: '123' }));
  err('custom', J({ nombre: 'X', instagram: 'instagram.com' }));
  err('custom', 'no es json');
});

test('custom: resolver devuelve landing con los datos', () => {
  const { valor } = normalizarDestino('custom', J({ nombre: 'X', instagram: 'juan' }));
  const r = resolverDestino('custom', valor);
  assert.equal(r.modo, 'landing');
  assert.equal(r.funcion, 'custom');
  assert.equal(r.datos.instagram, 'https://instagram.com/juan');
  assert.equal(r.datos.whatsapp, null);
});

// --- wifi ---
test('wifi: normaliza SSID y contraseña sin tocar la puntuación', () => {
  const r = normalizarDestino('wifi', JSON.stringify({ ssid: 'Bar "Pepe".', password: 'clave;123,ok.' }));
  assert.deepEqual(JSON.parse(r.valor), { ssid: 'Bar "Pepe".', password: 'clave;123,ok.' });
});
test('wifi: red abierta (sin contraseña) y errores', () => {
  assert.ok(normalizarDestino('wifi', JSON.stringify({ ssid: 'Libre', password: '' })).valor);
  assert.ok(normalizarDestino('wifi', JSON.stringify({ ssid: '', password: '12345678' })).error);
  assert.ok(normalizarDestino('wifi', JSON.stringify({ ssid: 'X', password: '123' })).error);
  assert.ok(normalizarDestino('wifi', JSON.stringify({ ssid: 'x'.repeat(33) })).error);
});
test('wifi: resolver es landing', () => {
  const r = resolverDestino('wifi', JSON.stringify({ ssid: 'A', password: '12345678' }));
  assert.equal(r.modo, 'landing');
  assert.equal(r.funcion, 'wifi');
});
