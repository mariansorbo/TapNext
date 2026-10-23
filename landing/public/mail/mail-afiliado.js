// Arma el mail para pymes (/mail/empresas/mail.html) con el código de una
// agencia y lo copia con diseño, para pegarlo en un mail nuevo de Gmail u Outlook.
// Lo usan /mail/afiliados.html (lo copia el afiliado) y el botón "✉️ Bienvenida"
// del admin (src/pap-admin.js), que pega arriba el texto de bienvenida.
// Va en public/ para que la página estática pueda importarlo sin build.

// La campaña es siempre la del mail para pymes; el código va solo en los links
// al sitio (los lee GA), no en Instagram.
const UTM = { utm_source: 'afiliado', utm_medium: 'email', utm_campaign: 'mail_pymes' };

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Cartel con el código de descuento, para que quien recibe el mail lo vea escrito.
function cartelCodigo(doc, codigo) {
  const t = doc.createElement('table');
  t.setAttribute('role', 'presentation');
  t.setAttribute('cellpadding', '0');
  t.setAttribute('cellspacing', '0');
  t.setAttribute('border', '0');
  t.style.marginBottom = '14px';
  t.innerHTML = `<tr><td bgcolor="#14171A" style="background:#14171A; border:1px dashed #EDEFE9; border-radius:10px; padding:10px 14px; font-family:'JetBrains Mono',Consolas,monospace; font-size:12px; line-height:18px; color:#C9CDC4;">Código de descuento<br><span style="font-size:20px; line-height:28px; font-weight:700; letter-spacing:2px; color:#EDEFE9;">${esc(codigo)}</span></td></tr>`;
  return t;
}

function personalizar(doc, codigo, aid) {
  const raiz = doc.body;
  const asuntoVentas = `mailto:ventas@next-tap.tech?subject=${encodeURIComponent(`NextTap para mi empresa (código ${codigo})`)}`;
  // En la tarjeta del combo, arriba del botón; y en el cierre, una línea más.
  const botonCombo = [...raiz.querySelectorAll('a')].find((a) => a.textContent.includes('Quiero el combo'));
  if (botonCombo) botonCombo.before(cartelCodigo(doc, codigo));
  const cierre = [...raiz.querySelectorAll('p')].find((p) => p.textContent.includes('te armamos una propuesta'));
  if (cierre)
    cierre.innerHTML = `Contanos de tu equipo y te armamos una propuesta. Usá el código <strong style="color:#EDEFE9; font-family:'JetBrains Mono',Consolas,monospace; letter-spacing:1px;">${esc(codigo)}</strong> para tu descuento.`;

  raiz.querySelectorAll('a[href]').forEach((a) => {
    let url;
    try {
      url = new URL(a.getAttribute('href'));
    } catch {
      return;
    }
    if (url.hostname === 'wa.me') {
      const texto = url.searchParams.get('text');
      const mensaje = `${texto || 'Hola, quiero NextTap para mi empresa.'}${texto && !/[.!?]$/.test(texto) ? '.' : ''} Tengo el código de referido: ${codigo}`;
      // %20 y no "+": WhatsApp a veces deja los "+" tal cual en el mensaje.
      a.setAttribute('href', `https://wa.me${url.pathname}?text=${encodeURIComponent(mensaje)}`);
      return;
    }
    if (url.protocol === 'mailto:') {
      a.setAttribute('href', asuntoVentas);
      return;
    }
    if (url.hostname === 'next-tap.tech' || url.hostname.endsWith('instagram.com')) {
      for (const [k, v] of Object.entries(UTM)) url.searchParams.set(k, v);
      if (url.hostname === 'next-tap.tech') {
        url.searchParams.set('utm_content', codigo);
        if (aid) url.searchParams.set('a_aid', aid);
      }
      a.setAttribute('href', url.href);
    }
  });

  // Quien lo recibe le respondería al afiliado, no a nosotros.
  raiz.querySelectorAll('div').forEach((d) => {
    const primero = d.firstChild;
    if (primero?.nodeType === 3 && primero.textContent.includes('o respondé este mail')) {
      primero.textContent = 'o escribinos a ';
      const mail = doc.createElement('a');
      mail.href = asuntoVentas;
      mail.textContent = 'ventas@next-tap.tech';
      mail.setAttribute('style', 'color:#7B5CFF; text-decoration:none;');
      d.insertBefore(mail, primero.nextSibling);
      mail.after(doc.createTextNode(' · '));
    }
  });
}

// HTML del cuerpo del mail con el código de la agencia. codigo: el que se ve
// (en mayúsculas); aid: el referral_id tal como está en PAP, para el a_aid.
export async function armarMailAfiliado({ codigo, aid }) {
  const r = await fetch('/mail/empresas/mail.html', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`No se pudo cargar el mail (${r.status}).`);
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  // El texto oculto de la bandeja (preheader) aparecería al pegar: afuera.
  doc.body.querySelectorAll('div[style*="display:none"]').forEach((d) => d.remove());
  personalizar(doc, codigo, aid);
  return doc.body.innerHTML;
}

// Texto común (párrafos separados por línea en blanco) a HTML de mail.
export function textoAHtml(texto) {
  return String(texto || '')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px; font-family:Arial,sans-serif; font-size:14px; line-height:21px; color:#222;">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Copia HTML con diseño (y texto plano de respaldo). Devuelve si pudo.
export async function copiarHtml(html, textoPlano) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([textoPlano], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      /* sigue con el método viejo */
    }
  }
  // Navegadores sin ClipboardItem: seleccionar un bloque con el HTML y copiar.
  const temp = document.createElement('div');
  temp.innerHTML = html;
  temp.style.cssText = 'position:fixed; left:-9999px; top:0;';
  document.body.appendChild(temp);
  const rango = document.createRange();
  rango.selectNodeContents(temp);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(rango);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  sel.removeAllRanges();
  temp.remove();
  return ok;
}
