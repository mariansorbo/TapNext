import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pantallaCustom } from './pantalla-custom.js';

test('pantalla custom: escapa HTML, muestra los dos botones y el pie de venta', () => {
  const html = pantallaCustom({
    nombre: '<script>alert(1)</script>',
    bio: 'a & b',
    whatsapp: 'https://wa.me/541122334455',
    instagram: 'https://instagram.com/juan',
  });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('href="https://wa.me/541122334455"'));
  assert.ok(html.includes('@juan'));
  assert.ok(html.includes('Comprá el tuyo en <b>next-tap.tech</b>'));
});

test('pantalla custom: solo Instagram no dibuja el botón de WhatsApp; sin nada avisa', () => {
  const soloIg = pantallaCustom({ nombre: 'X', instagram: 'https://instagram.com/x' });
  assert.ok(!soloIg.includes('wa.me'));
  assert.ok(pantallaCustom({ nombre: 'X' }).includes('Todavía no hay datos'));
});
