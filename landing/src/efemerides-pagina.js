// Página /efemerides.html: muestra el calendario REAL de la pantalla del tap
// (server/efemerides.js), calculado al abrirla — nunca queda desactualizada.
// Misma lógica y mismos dibujos que el servidor.
import { efemerideDe, efemerideBloque } from '../server/efemerides.js';

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Hoy en Argentina (AAAA-MM-DD), igual que el servidor.
const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function casosDe(anio) {
  const out = [];
  for (let d = new Date(Date.UTC(anio, 0, 1, 15)); d.getUTCFullYear() === anio; d = new Date(d.getTime() + 864e5)) {
    const e = efemerideDe(d);
    if (!e) continue;
    const b = efemerideBloque(null, d);
    out.push({ fecha: d.toISOString().slice(0, 10), texto: e.texto, css: b.css, html: b.html });
  }
  return out;
}

let anio = +HOY.slice(0, 4), C = [], i = 0;
const scr = $('scr'), info = $('info'), dots = $('dots'), dyn = $('dyn'), grid = $('grid');

function corta(fecha) {
  const p = fecha.split('-');
  return `${+p[2]} ${MES[p[1] - 1]}`;
}

function estado() {
  const hoy = C.find((c) => c.fecha === HOY);
  const prox = C.find((c) => c.fecha > HOY);
  let t = hoy ? `<b>Hoy (${corta(HOY)}):</b> ${esc(hoy.texto)}` : `<b>Hoy (${corta(HOY)}):</b> sin efeméride`;
  if (!hoy && prox && anio === +HOY.slice(0, 4)) t += ` · próxima: ${corta(prox.fecha)}, ${esc(prox.texto)}`;
  $('estado').innerHTML = t;
}

function go(n) {
  i = (n + C.length) % C.length;
  const c = C[i];
  dyn.textContent = c.css;
  scr.innerHTML = c.html
    + '<div class="mark">Next<span class="tap">Tap</span></div><div class="bar"><i></i></div>'
    + '<div class="cta">Comprá el tuyo en <b>next-tap.tech</b></div>';
  info.innerHTML = `<b>${esc(c.texto)}</b><small>${corta(c.fecha)}${c.fecha === HOY ? ' · hoy' : ''} · ${i + 1} / ${C.length}</small>`;
  [].forEach.call(dots.children, (d, k) => { d.className = k === i ? 'on' : ''; });
}

function armar() {
  C = casosDe(anio);
  $('anio').textContent = anio;
  dots.innerHTML = '';
  C.forEach((_, k) => {
    const d = document.createElement('i');
    d.onclick = () => go(k);
    dots.appendChild(d);
  });
  let h = '', mes = -1;
  C.forEach((c) => {
    const p = c.fecha.split('-'), m = +p[1] - 1;
    if (m !== mes) { if (mes >= 0) h += '</div>'; mes = m; h += `<h2>${MESES[m]}</h2><div class="cards">`; }
    const t = /\.mark \.tap\{([^}]*)\}/.exec(c.css || '');
    const st = t ? t[1].replace(/"/g, '&quot;') : '';
    h += `<div class="card${c.fecha === HOY ? ' hoy' : ''}"><div class="cd">${corta(c.fecha)}${c.fecha === HOY ? ' · hoy' : ''}</div>${c.html}<div class="cmark">Next<span class="tap" style="${st}">Tap</span></div></div>`;
  });
  grid.innerHTML = h + '</div>';
  estado();
  // Arranca en la próxima efeméride (o en la de hoy); en otro año, en la primera.
  const k = anio === +HOY.slice(0, 4) ? C.findIndex((c) => c.fecha >= HOY) : 0;
  go(k < 0 ? 0 : k);
}

function vista(todo) {
  document.body.className = todo ? 'todo' : '';
  $('t1').className = todo ? '' : 'on';
  $('t2').className = todo ? 'on' : '';
}

$('prev').onclick = () => go(i - 1);
$('next').onclick = () => go(i + 1);
$('t1').onclick = () => vista(false);
$('t2').onclick = () => vista(true);
$('aprev').onclick = () => { anio--; armar(); };
$('anext').onclick = () => { anio++; armar(); };
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') go(i + 1);
  if (e.key === 'ArrowLeft') go(i - 1);
});
let x0 = null;
addEventListener('pointerdown', (e) => { x0 = e.clientX; });
addEventListener('pointerup', (e) => {
  if (x0 == null) return;
  const dx = e.clientX - x0;
  x0 = null;
  if (Math.abs(dx) > 40 && !document.body.classList.contains('todo')) go(dx < 0 ? i + 1 : i - 1);
});

armar();
