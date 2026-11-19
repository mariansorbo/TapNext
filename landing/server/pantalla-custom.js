// Página pública de la función 'custom': nombre + botones de WhatsApp e
// Instagram, con la estética de next-tap.tech (fondo tinta, Space Grotesk,
// etiquetas mono, líneas punteadas, violeta de acento). HTML autónomo, un solo
// request, sin bundle (mismo criterio que pantallaAlias). noindex.

const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Mismos íconos de marca que usa el wizard de compra (src/brand-icons.js).
const ICO_WA = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#25D366"/><path d="M16.02 7c-4.98 0-9.02 4.04-9.02 9.02 0 1.59.42 3.14 1.21 4.5L7 25l4.6-1.2a9 9 0 0 0 4.42 1.13h.01c4.98 0 9.02-4.04 9.02-9.02S21 7 16.02 7Zm5.3 12.77c-.22.63-1.28 1.2-1.77 1.27-.45.06-1.02.09-1.65-.1a15.4 15.4 0 0 1-1.5-.55 12.3 12.3 0 0 1-4.7-4.15c-.35-.47-1.17-1.56-1.17-2.98s.75-2.12 1.02-2.41c.27-.29.6-.36.8-.36l.57.01c.18.01.43-.07.67.51.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.32-.29.49-.15.18-.31.4-.44.53-.15.15-.3.31-.13.6.17.29.75 1.24 1.61 2 1.1.98 2.03 1.29 2.32 1.44.29.15.46.13.63-.06.17-.19.72-.84.91-1.13.19-.29.38-.24.63-.14.26.09 1.63.77 1.91.91.28.14.47.21.53.33.07.13.07.72-.15 1.35Z" fill="#fff"/></svg>`;
const ICO_IG = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><defs><linearGradient id="ig" x1="0" y1="32" x2="32" y2="0"><stop offset="0" stop-color="#FFDD55"/><stop offset=".5" stop-color="#E1306C"/><stop offset="1" stop-color="#5851DB"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#ig)"/><rect x="9" y="9" width="14" height="14" rx="4" stroke="#fff" stroke-width="1.7"/><circle cx="16" cy="16" r="3.6" stroke="#fff" stroke-width="1.7"/><circle cx="21" cy="11" r="1" fill="#fff"/></svg>`;
const FLECHA = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>`;

function inicial(nombre) {
  const m = String(nombre || '').trim().match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : 'N';
}

// "https://instagram.com/juan" -> "@juan"
function handleIg(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean)[0];
    return p ? `@${p}` : 'Instagram';
  } catch {
    return 'Instagram';
  }
}

export function pantallaCustom(datos = {}) {
  const nombre = String(datos.nombre ?? '');
  const bio = String(datos.bio ?? '');
  const wa = datos.whatsapp ? String(datos.whatsapp) : '';
  const ig = datos.instagram ? String(datos.instagram) : '';

  const boton = (href, icono, eyebrow, texto) => `
    <a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
      <span class="ico">${icono}</span>
      <span class="txt"><span class="eyebrow">${esc(eyebrow)}</span><span class="main">${esc(texto)}</span></span>
      <span class="go">${FLECHA}</span>
    </a>`;

  const botones = [
    wa ? boton(wa, ICO_WA, 'Escribime', 'WhatsApp') : '',
    ig ? boton(ig, ICO_IG, 'Seguime', handleIg(ig)) : '',
  ].join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(nombre || 'NextTap')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{--ink:#14171A;--surface:#1B1F23;--surface-2:#22272C;--paper:#EDEFE9;--paper-dim:#C9CDC4;
    --violet:#7B5CFF;--line:rgba(237,239,233,.12);
    --display:'Space Grotesk',ui-sans-serif,system-ui,sans-serif;--body:'Inter',ui-sans-serif,system-ui,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{min-height:100%}
  body{background:var(--ink);color:var(--paper);font-family:var(--body);
    display:flex;flex-direction:column;align-items:center;min-height:100svh;
    padding:max(36px,env(safe-area-inset-top)) 18px max(28px,env(safe-area-inset-bottom));-webkit-font-smoothing:antialiased}
  main{width:min(420px,100%);flex:1;display:flex;flex-direction:column}
  .avatar{width:76px;height:76px;border-radius:18px;background:var(--violet);color:var(--ink);
    display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:2.3rem;font-weight:700}
  h1{margin-top:18px;font-family:var(--display);font-size:clamp(1.8rem,8vw,2.2rem);font-weight:600;letter-spacing:-.03em;line-height:1.1;word-break:break-word}
  .bio{margin-top:10px;color:var(--paper-dim);font-size:1rem;line-height:1.5}
  .stack{margin:24px 0 44px;border-top:1px dashed var(--line);display:flex;flex-direction:column}
  .btn{display:flex;align-items:center;gap:14px;padding:16px 4px;border-bottom:1px dashed var(--line);
    color:inherit;text-decoration:none;transition:background .15s}
  .btn:hover,.btn:active{background:rgba(123,92,255,.08)}
  .ico{flex:none;width:46px;height:46px}
  .ico svg{width:100%;height:100%;display:block}
  .txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
  .eyebrow{font-family:var(--mono);font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--violet)}
  .main{font-family:var(--display);font-size:1.35rem;font-weight:600;letter-spacing:-.02em;word-break:break-word}
  .go{flex:none;color:var(--paper-dim)}
  .vacio{margin-top:24px;color:var(--paper-dim)}
  footer{margin-top:auto;padding-top:16px;border-top:1px dashed var(--line);text-align:center}
  .cta{font-family:var(--mono);font-size:.8rem;letter-spacing:.03em;color:var(--paper-dim);text-decoration:none}
  .cta b{font-weight:500;color:var(--paper)}
  @media (prefers-reduced-motion:reduce){.btn{transition:none}}
</style>
</head>
<body>
  <main>
    <div class="avatar" aria-hidden="true">${esc(inicial(nombre))}</div>
    <h1>${esc(nombre)}</h1>
    ${bio ? `<p class="bio">${esc(bio)}</p>` : ''}
    ${botones ? `<nav class="stack" aria-label="Contacto">${botones}\n    </nav>` : '<p class="vacio">Todavía no hay datos cargados.</p>'}
    <footer>
      <a class="cta" href="https://next-tap.tech">Comprá el tuyo en <b>next-tap.tech</b></a>
    </footer>
  </main>
</body>
</html>`;
}
