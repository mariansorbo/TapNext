// Página pública de la función 'wifi': misma estética que la de datos de
// transferencia (pantallaAlias): marca NextTap, ficha con filas, la contraseña
// es la fila principal con botón para copiar, y una guía abajo. Sin nombre ni
// logo del lugar. HTML autónomo, un solo request, noindex.

const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICO_COPIAR =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

export function pantallaWifi(datos = {}) {
  const ssid = String(datos.ssid ?? '');
  const password = String(datos.password ?? '');

  const fila = (label, mostrar, copiar, principal) => {
    const cuerpo = `<span class="fila-t"><span class="lb">${esc(label)}</span><span class="val${principal ? ' alias' : ''}"${principal ? ' id="alias"' : ''}>${esc(mostrar)}</span></span>`;
    return copiar
      ? `<button type="button" class="fila${principal ? ' prin' : ''}" data-copy="${esc(copiar)}" aria-label="Copiar ${esc(label)}">${cuerpo}<span class="ico">${ICO_COPIAR}</span></button>`
      : `<div class="fila">${cuerpo}</div>`;
  };

  const guia = password
    ? `Copiá la contraseña, abrí Ajustes → Wi-Fi, elegí la red <b>${esc(ssid)}</b> y pegala.`
    : `Esta red es abierta, no tiene contraseña. Abrí Ajustes → Wi-Fi y elegí la red <b>${esc(ssid)}</b>.`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>NextTap — Wi-Fi</title>
<style>
  :root{--ink:#14171A;--paper:#EDEFE9;--violet:#7B5CFF;--line:#3a3f45;--mut:#9a9d9a}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{min-height:100%}
  body{background:var(--ink);color:var(--paper);
    font-family:'Space Grotesk',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
    min-height:100svh;padding:max(28px,env(safe-area-inset-top)) 18px 40px;-webkit-font-smoothing:antialiased}
  .mark{display:inline-flex;align-items:center;gap:.1em;font-weight:700;font-size:clamp(2.6rem,14vw,3.3rem);line-height:1;letter-spacing:-.03em}
  .mark .tap{background:var(--violet);color:var(--ink);padding:.07em .24em .1em;border-radius:.18em;line-height:1}
  h1{width:min(420px,100%);margin-top:24px;padding-bottom:12px;border-bottom:1px dashed var(--line);
    font-size:clamp(1.4rem,6.5vw,1.6rem);font-weight:600;letter-spacing:-.02em;text-align:left}
  .ficha{width:min(420px,100%)}
  .fila{display:flex;align-items:center;gap:12px;width:100%;padding:13px 0;border:0;border-bottom:1px dashed var(--line);
    background:transparent;color:inherit;font-family:inherit;text-align:left}
  button.fila{cursor:pointer}
  .fila-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
  .lb{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
  .val{font-size:1.4rem;line-height:1.2;word-break:break-word}
  button.fila .val{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.1rem;word-break:break-all}
  button.fila .val.alias{font-size:clamp(1.5rem,8vw,1.9rem);user-select:all;-webkit-user-select:all}
  .prin .lb{color:#9d86ff}
  .ico{flex:none;width:48px;height:48px;border-radius:12px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center}
  .prin .ico{background:var(--violet);border-color:var(--violet);color:var(--ink)}
  .fila.done .ico{background:var(--paper);border-color:var(--paper);color:var(--ink)}
  .guia{width:min(420px,100%);margin-top:20px;background:#1f2328;border:1px solid var(--line);border-radius:16px;padding:16px;text-align:left}
  .guia p{font-size:1.05rem;line-height:1.45;color:rgba(237,239,233,.85)}
  .guia b{font-weight:600;color:var(--paper)}
  a.link{margin-top:22px;color:rgba(237,239,233,.45);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;letter-spacing:.03em;text-decoration:none}
  .vacio{width:min(420px,100%);margin-top:20px;color:rgba(237,239,233,.7)}
  .toast{position:fixed;left:50%;transform:translateX(-50%) translateY(20px);
    bottom:calc(env(safe-area-inset-bottom) + 24px);background:var(--paper);color:var(--ink);
    font-weight:600;font-size:1rem;padding:11px 22px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
  .toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
  @media (prefers-reduced-motion:reduce){.toast{transition:none}}
</style>
</head>
<body>
  <div class="mark">Next<span class="tap">Tap</span></div>
  <h1>Wi-Fi</h1>
  ${
    ssid
      ? `<div class="ficha">
    ${fila('Red', ssid)}
    ${password ? fila('Contraseña', password, password, true) : ''}
  </div>
  <section class="guia"><p>${guia}</p></section>`
      : '<p class="vacio">Todavía no hay datos cargados.</p>'
  }
  <a class="link" href="https://next-tap.tech">next-tap.tech</a>
  <div class="toast" id="toast">Copiado</div>
  <script>
  (function(){
    function copiar(text, done){
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).then(function(){done(true)}, fallback);
          return;
        }
      }catch(e){}
      fallback();
      function fallback(){
        try{
          var ta=document.createElement('textarea');
          ta.value=text; ta.setAttribute('readonly','');
          ta.style.position='fixed'; ta.style.left='-9999px';
          document.body.appendChild(ta);
          ta.select(); ta.setSelectionRange(0, text.length);
          var ok=document.execCommand('copy');
          document.body.removeChild(ta);
          done(!!ok);
        }catch(e){ done(false); }
      }
    }
    var toast=document.getElementById('toast'), tt;
    function flash(msg){
      toast.textContent=msg; toast.classList.add('on');
      clearTimeout(tt); tt=setTimeout(function(){toast.classList.remove('on')},1600);
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function(btn){
      btn.addEventListener('click', function(){
        var text=btn.getAttribute('data-copy')||'';
        copiar(text, function(ok){
          if(ok){
            flash('Copiado');
            btn.classList.add('done');
            setTimeout(function(){ btn.classList.remove('done'); },1600);
          }else{
            flash('Copiala a mano');
            try{
              var sel=window.getSelection(), rng=document.createRange();
              rng.selectNodeContents(document.getElementById('alias'));
              sel.removeAllRanges(); sel.addRange(rng);
            }catch(e){}
          }
        });
      });
    });
  })();
  </script>
</body>
</html>`;
}
