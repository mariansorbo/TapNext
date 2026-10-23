// Solapa "Post Affiliate Pro" del admin: guía del proceso, plantillas de mail,
// alta de agencias (con su link), ventas por transferencia y comisiones del mes
// con el pago mensual. Backend en server/pap-admin.js.

import {
  plantillaPropuesta,
  plantillaBienvenida,
  plantillaResumen,
  comoTexto,
  nombreMes,
} from './pap-plantillas.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pesos = (n) => `$${Math.round(Number(n)).toLocaleString('es-AR')}`;
const fecha = (v) => (v ? new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const ESTADOS = { approved: 'Aprobada', pending: 'Pendiente', declined: 'Rechazada' };
const ESTADOS_AF = { approved: 'Aprobada', pending: 'Pendiente', declined: 'Rechazada' };

function mesAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function copiar(texto, btn) {
  try {
    await navigator.clipboard.writeText(texto);
    const original = btn.innerHTML;
    btn.textContent = 'Copiado ✓';
    setTimeout(() => (btn.innerHTML = original), 1500);
  } catch {
    window.prompt('Copiá esto:', texto);
  }
}

export function initPapAdmin({ api }) {
  const raiz = document.getElementById('pap-tab');
  const $ = (id) => document.getElementById(id);

  let estado = null;
  let afiliados = [];
  let comisiones = null;
  let cargado = false;

  const setStatus = (el, texto, error = false) => {
    el.className = `modal-status${error ? ' is-error' : texto ? ' is-success' : ''}`;
    el.textContent = texto;
  };

  // --- Estado / configuración ---
  function renderEstado() {
    const banner = $('pap-estado');
    if (!estado) return;
    $('pap-link-panel').href = estado.panelMerchant || '#';
    if (estado.configurado) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `<b>Falta conectar Post Affiliate Pro.</b> La guía y la plantilla de propuesta funcionan igual, pero
      para crear agencias, cargar ventas y ver comisiones el servidor necesita la clave de API (<code>PAP_API_KEY</code>).
      Se crea en PAP → Configuration → Tools → Integration → API v3.`;
  }

  // --- Agencias ---
  function renderAfiliados() {
    const cont = $('pap-afiliados-table');
    const select = $('pap-venta-afiliado');
    const opciones = afiliados
      .filter((a) => a.estado === 'approved')
      .map((a) => `<option value="${esc(a.id)}">${esc(a.agencia || a.contacto)} — ${esc(a.codigo)}</option>`)
      .join('');
    select.innerHTML = `<option value="">Elegí la agencia…</option>${opciones}`;

    if (!estado?.configurado) {
      cont.innerHTML = '<p class="admin-empty">Conectá la clave de API para ver las agencias.</p>';
      return;
    }
    if (!afiliados.length) {
      cont.innerHTML = '<p class="admin-empty">Todavía no hay agencias. Creá la primera con el botón de arriba.</p>';
      return;
    }
    const filas = afiliados
      .map(
        (a) => `<tr>
          <td><b>${esc(a.agencia || '—')}</b><br><span class="admin-muted">${esc(a.contacto)} · ${esc(a.email)}</span></td>
          <td><b>${esc(a.codigo)}</b></td>
          <td>${esc(ESTADOS_AF[a.estado] || a.estado)}</td>
          <td><input class="precio-input pap-alias" data-id="${esc(a.id)}" value="${esc(a.alias || '')}" placeholder="alias o CBU" style="width:150px"></td>
          <td class="pap-acciones">
            <button type="button" class="row-btn" data-copiar-link="${esc(a.id)}">🔗 Link</button>
            <button type="button" class="row-btn" data-copiar-bienvenida="${esc(a.id)}">✉️ Bienvenida</button>
          </td>
        </tr>`
      )
      .join('');
    cont.innerHTML = `<table><thead><tr><th>Agencia</th><th>Código</th><th>Estado</th><th>Alias para pagarle</th><th></th></tr></thead><tbody>${filas}</tbody></table>`;
  }

  async function cargarAfiliados() {
    if (!estado?.configurado) return renderAfiliados();
    try {
      ({ afiliados } = await api('/pap/afiliados'));
    } catch (err) {
      $('pap-afiliados-table').innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
      return;
    }
    renderAfiliados();
  }

  $('pap-afiliados-table').addEventListener('click', (e) => {
    const link = e.target.closest('[data-copiar-link]');
    const bienv = e.target.closest('[data-copiar-bienvenida]');
    const id = link?.dataset.copiarLink || bienv?.dataset.copiarBienvenida;
    const a = afiliados.find((x) => x.id === id);
    if (!a) return;
    if (link) copiar(a.link, link);
    else copiarBienvenida(a, bienv);
  });

  // Bienvenida: el texto (con su link y su código) y, abajo, el mail para pymes
  // ya armado con su código, con diseño, para pegar todo junto en Gmail.
  // El armado del mail vive en public/mail/mail-afiliado.js (lo comparte con
  // /mail/afiliados.html). Si algo falla, copia solo el texto como antes.
  async function copiarBienvenida(a, btn) {
    const plantilla = plantillaBienvenida({ afiliado: a, ...estado });
    const texto = comoTexto(plantilla);
    const original = btn.innerHTML;
    btn.textContent = 'Armando…';
    try {
      const { armarMailAfiliado, textoAHtml, copiarHtml } = await import(/* @vite-ignore */ `${location.origin}/mail/mail-afiliado.js`);
      const mail = await armarMailAfiliado({ codigo: String(a.codigo).toUpperCase(), aid: a.codigo });
      const html = `${textoAHtml(plantilla.cuerpo)}<p style="margin:18px 0 14px; font-family:Arial,sans-serif; font-size:14px; line-height:21px; color:#222;"><b>Así se ve el mail que podés mandarles a tus contactos:</b></p>${mail}`;
      if (!(await copiarHtml(html, texto))) throw new Error('sin portapapeles');
      btn.textContent = 'Copiado ✓';
      setTimeout(() => (btn.innerHTML = original), 2500);
      avisoAsunto(`Bienvenida de ${a.agencia || a.contacto} copiada. Asunto: ${plantilla.asunto}`);
    } catch {
      btn.innerHTML = original;
      copiar(texto, btn);
    }
  }
  // El HTML copiado no lleva el asunto: queda escrito arriba de la tabla.
  function avisoAsunto(msg) {
    const tabla = $('pap-afiliados-table');
    let p = tabla.parentElement.querySelector('.pap-bienvenida-asunto');
    if (!p) {
      p = document.createElement('p');
      p.className = 'section-lead pap-nota pap-bienvenida-asunto';
      tabla.before(p);
    }
    p.textContent = msg;
  }

  $('pap-afiliados-table').addEventListener('change', async (e) => {
    const input = e.target.closest('.pap-alias');
    if (!input) return;
    try {
      await api(`/pap/afiliados/${encodeURIComponent(input.dataset.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ alias: input.value }),
      });
      const a = afiliados.find((x) => x.id === input.dataset.id);
      if (a) a.alias = input.value.trim() || null;
      input.style.borderColor = 'var(--violet)';
      setTimeout(() => (input.style.borderColor = ''), 1200);
    } catch (err) {
      alert(err.message);
    }
  });

  // Código sugerido a partir del nombre de la agencia: LOPEZ, RRHHSUR…
  $('pap-nuevo-agencia').addEventListener('input', (e) => {
    const codigo = $('pap-nuevo-codigo');
    if (codigo.dataset.tocado) return;
    codigo.value = e.target.value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\b(AGENCIA|CONSULTORA|RRHH|RECURSOS|HUMANOS|SRL|SA|SAS|DE|LA|EL|Y)\b/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
  });
  $('pap-nuevo-codigo').addEventListener('input', (e) => {
    e.target.dataset.tocado = '1';
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('pap-nuevo-btn').addEventListener('click', async () => {
    const status = $('pap-nuevo-status');
    const btn = $('pap-nuevo-btn');
    btn.disabled = true;
    setStatus(status, 'Creando en Post Affiliate Pro…');
    try {
      const { afiliado } = await api('/pap/afiliados', {
        method: 'POST',
        body: JSON.stringify({
          agencia: $('pap-nuevo-agencia').value,
          contacto: $('pap-nuevo-contacto').value,
          email: $('pap-nuevo-email').value,
          codigo: $('pap-nuevo-codigo').value,
          alias: $('pap-nuevo-alias').value,
        }),
      });
      setStatus(status, `Listo: ${afiliado.agencia} quedó aprobada con el código ${afiliado.codigo}. Ahora copiale la bienvenida desde la tabla.`);
      for (const id of ['pap-nuevo-agencia', 'pap-nuevo-contacto', 'pap-nuevo-email', 'pap-nuevo-codigo', 'pap-nuevo-alias']) $(id).value = '';
      delete $('pap-nuevo-codigo').dataset.tocado;
      await cargarAfiliados();
    } catch (err) {
      setStatus(status, err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // --- Venta por transferencia: combos + sueltas, cada uno con su precio ---
  const num = (id) => Math.max(0, Number($(id).value) || 0);
  function leerVenta() {
    const combos = Math.floor(num('pap-venta-combos'));
    const sueltas = Math.floor(num('pap-venta-sueltas'));
    const precioCombo = num('pap-venta-precio-combo');
    const precioSuelta = num('pap-venta-precio-suelta');
    const sueltasConComision = $('pap-venta-sueltas-comision').checked;
    const subCombos = combos * precioCombo;
    const subSueltas = sueltas * precioSuelta;
    const base = subCombos + (sueltasConComision ? subSueltas : 0);
    const comision = (base * (estado?.comisionPct || 0)) / 100;
    const partes = [combos && `${combos} ${combos === 1 ? 'combo' : 'combos'}`, sueltas && `${sueltas} ${sueltas === 1 ? 'suelta' : 'sueltas'}`].filter(Boolean);
    return { combos, sueltas, precioCombo, precioSuelta, sueltasConComision, total: subCombos + subSueltas, comision, descripcion: partes.join(' + ') };
  }
  function actualizarPreview() {
    const v = leerVenta();
    $('pap-venta-sueltas-comision').closest('label').hidden = !v.sueltas;
    $('pap-venta-preview').innerHTML = v.total
      ? `<b>${esc(v.descripcion)}</b> · venta ${pesos(v.total)} · comisión para la agencia <b>${pesos(v.comision)}</b>${
          v.sueltas && !v.sueltasConComision ? ' (solo sobre los combos)' : ''
        }`
      : '';
  }
  function precargarPrecios() {
    if (!$('pap-venta-precio-combo').value) $('pap-venta-precio-combo').value = estado?.precioCombo || '';
    if (!$('pap-venta-precio-suelta').value) $('pap-venta-precio-suelta').value = estado?.precioSuelta || '';
    actualizarPreview();
  }
  actualizarPreview();
  for (const id of ['pap-venta-combos', 'pap-venta-sueltas', 'pap-venta-precio-combo', 'pap-venta-precio-suelta', 'pap-venta-sueltas-comision'])
    $(id).addEventListener('input', actualizarPreview);

  $('pap-venta-btn').addEventListener('click', async () => {
    const status = $('pap-venta-status');
    const btn = $('pap-venta-btn');
    const sel = $('pap-venta-afiliado');
    const agencia = sel.options[sel.selectedIndex]?.textContent || '';
    const v = leerVenta();
    if (!sel.value) return setStatus(status, 'Elegí la agencia.', true);
    if (!v.total) return setStatus(status, 'Cargá al menos un combo o una unidad suelta, con su precio.', true);
    if (!window.confirm(`¿Cargar ${v.descripcion} (${pesos(v.total)}) a ${agencia}?
Comisión: ${pesos(v.comision)}. Queda aprobada para pagarle.`)) return;
    btn.disabled = true;
    setStatus(status, 'Cargando…');
    try {
      const r = await api('/pap/ventas-transferencia', {
        method: 'POST',
        body: JSON.stringify({
          afiliadoId: sel.value,
          empresa: $('pap-venta-empresa').value,
          pedido: $('pap-venta-pedido').value,
          nota: $('pap-venta-nota').value,
          combos: v.combos,
          precioCombo: v.precioCombo,
          sueltas: v.sueltas,
          precioSuelta: v.precioSuelta,
          sueltasConComision: v.sueltasConComision,
        }),
      });
      setStatus(status, `Cargada: ${r.descripcion} para ${agencia}, comisión ${pesos(r.comision)}. Ya aparece en su panel de PAP.`);
      for (const id of ['pap-venta-empresa', 'pap-venta-pedido', 'pap-venta-nota']) $(id).value = '';
      $('pap-venta-combos').value = '1';
      $('pap-venta-sueltas').value = '0';
      $('pap-venta-sueltas-comision').checked = true;
      actualizarPreview();
      await cargarComisiones();
    } catch (err) {
      setStatus(status, err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // --- Comisiones del mes ---
  function renderComisiones() {
    const cont = $('pap-comisiones');
    if (!estado?.configurado) {
      cont.innerHTML = '<p class="admin-empty">Conectá la clave de API para ver las comisiones.</p>';
      return;
    }
    if (!comisiones) return;
    const { mes, agencias } = comisiones;
    if (!agencias.length) {
      cont.innerHTML = `<p class="admin-empty">No hubo ventas de agencias en ${esc(nombreMes(mes))}.</p>`;
      return;
    }
    const totalAPagar = agencias.reduce((s, g) => s + (g.pago ? 0 : g.aPagar), 0);
    const pendientes = agencias.reduce((s, g) => s + g.pendientes, 0);
    cont.innerHTML =
      `<p class="pap-resumen-mes">${esc(nombreMes(mes))}: <b>${pesos(totalAPagar)}</b> por pagar` +
      (pendientes ? ` · <b>${pendientes}</b> venta(s) pendientes de aprobar` : '') +
      `</p>` +
      agencias
        .map((g, i) => {
          const a = g.afiliado;
          const filas = g.ventas
            .map(
              (v) => `<tr>
                <td>${fecha(v.fecha)}</td>
                <td><b>${esc(v.empresa || 'Compra en la web')}</b>${v.productos ? ' · ' + esc(v.productos) : ''}<br><span class="admin-muted">${esc(v.pedido || '')}${v.detalle ? ' · ' + esc(v.detalle) : ''}${v.nota ? ' · ' + esc(v.nota) : ''}</span></td>
                <td>${pesos(v.totalCost)}</td>
                <td><b>${pesos(v.comision)}</b></td>
                <td>${esc(ESTADOS[v.estado] || v.estado)}</td>
                <td class="pap-acciones">${
                  v.estado === 'pending'
                    ? `<button type="button" class="row-btn" data-tx="${esc(v.id)}" data-status="approved">✓ Aprobar</button>
                       <button type="button" class="row-btn" data-tx="${esc(v.id)}" data-status="declined">✕ Rechazar</button>`
                    : v.estado === 'approved' && !g.pago
                      ? `<button type="button" class="row-btn" data-tx="${esc(v.id)}" data-status="declined" title="Si la empresa devolvió o no pagó">✕ Anular</button>`
                      : ''
                }</td>
              </tr>`
            )
            .join('');
          const pie = g.pago
            ? `<span class="pap-pagado">✓ Pagado ${pesos(g.pago.monto)} el ${fecha(g.pago.pagadoEn)}</span>
               <button type="button" class="row-btn" data-resumen="${i}">✉️ Copiar resumen</button>
               <button type="button" class="row-btn" data-deshacer="${i}">Deshacer</button>`
            : g.aPagar > 0
              ? `<span>A pagar: <b>${pesos(g.aPagar)}</b></span>
                 <button type="button" class="row-btn" data-copiar-alias="${i}" ${a.alias ? '' : 'disabled title="Cargale el alias en la tabla de agencias"'}>Alias${a.alias ? ': ' + esc(a.alias) : ' (falta)'}</button>
                 <button type="button" class="row-btn" data-copiar-monto="${i}">Monto</button>
                 <button type="button" class="row-btn" data-pagado="${i}">Ya transferí ✓</button>
                 <button type="button" class="row-btn" data-resumen="${i}">✉️ Copiar resumen</button>`
              : '<span class="admin-muted">Nada aprobado para pagar todavía.</span>';
          return `<div class="pap-agencia">
              <div class="pap-agencia-head"><b>${esc(a.agencia || a.contacto)}</b> <span class="admin-tag">${esc(a.codigo)}</span>
                <span class="admin-muted">${g.ventas.length} venta(s)</span></div>
              <div class="admin-table"><table><thead><tr><th>Fecha</th><th>Empresa / pedido</th><th>Venta</th><th>Comisión</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
              <div class="pap-agencia-pie">${pie}</div>
            </div>`;
        })
        .join('');
  }

  async function cargarComisiones() {
    if (!estado?.configurado) return renderComisiones();
    const cont = $('pap-comisiones');
    cont.innerHTML = '<p class="admin-empty">Cargando…</p>';
    try {
      comisiones = await api(`/pap/comisiones?mes=${encodeURIComponent($('pap-mes').value)}`);
    } catch (err) {
      cont.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
      return;
    }
    renderComisiones();
  }

  $('pap-mes').value = mesAnterior();
  $('pap-mes').addEventListener('change', cargarComisiones);

  $('pap-comisiones').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !comisiones) return;
    const g = comisiones.agencias[Number(b.dataset.resumen ?? b.dataset.copiarAlias ?? b.dataset.copiarMonto ?? b.dataset.pagado ?? b.dataset.deshacer)];
    try {
      if (b.dataset.tx) {
        const accion = b.dataset.status === 'approved' ? 'aprobar' : 'rechazar';
        if (!window.confirm(`¿Seguro que querés ${accion} esta comisión? La agencia lo ve en su panel.`)) return;
        b.disabled = true;
        await api(`/pap/transacciones/${encodeURIComponent(b.dataset.tx)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: b.dataset.status }),
        });
        await cargarComisiones();
      } else if (b.dataset.resumen != null) {
        copiar(comoTexto(plantillaResumen({ grupo: g, mes: comisiones.mes })), b);
      } else if (b.dataset.copiarAlias != null) {
        if (g.afiliado.alias) copiar(g.afiliado.alias, b);
      } else if (b.dataset.copiarMonto != null) {
        copiar(String(Math.round(g.aPagar)), b);
      } else if (b.dataset.pagado != null) {
        if (!window.confirm(`¿Ya le transferiste ${pesos(g.aPagar)} a ${g.afiliado.agencia || g.afiliado.contacto}?`)) return;
        await api('/pap/pagos', {
          method: 'POST',
          body: JSON.stringify({ afiliadoId: g.afiliado.id, mes: comisiones.mes, monto: g.aPagar }),
        });
        await cargarComisiones();
      } else if (b.dataset.deshacer != null) {
        if (!window.confirm('¿Desmarcar este pago?')) return;
        await api(`/pap/pagos/${encodeURIComponent(g.afiliado.id)}/${comisiones.mes}`, { method: 'DELETE' });
        await cargarComisiones();
      }
    } catch (err) {
      alert(err.message);
      b.disabled = false;
    }
  });

  // --- Plantilla de propuesta ---
  $('pap-copiar-propuesta').addEventListener('click', (e) => {
    if (estado) copiar(comoTexto(plantillaPropuesta(estado)), e.currentTarget);
  });

  // Se carga recién la primera vez que se abre la solapa (cada llamada a PAP
  // es lenta y el resto del panel no la necesita).
  return {
    async abrir() {
      if (cargado) return;
      cargado = true;
      try {
        estado = await api('/pap/estado');
      } catch (err) {
        raiz.querySelector('#pap-estado').hidden = false;
        raiz.querySelector('#pap-estado').textContent = err.message;
        cargado = false;
        return;
      }
      renderEstado();
      precargarPrecios();
      await Promise.all([cargarAfiliados(), cargarComisiones()]);
    },
  };
}
