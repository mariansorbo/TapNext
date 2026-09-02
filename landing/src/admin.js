import './styles.css';
import { applyBrand } from './brand.js';
import { initNfcGrabar } from './nfc-grabar.js';

applyBrand('Admin');

const API_BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'tap_admin_token';

const getToken = () => sessionStorage.getItem(TOKEN_KEY);
const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !dashboardView.hidden) {
      clearToken();
      showLogin();
      loginStatus.className = 'modal-status is-error';
      loginStatus.textContent = 'Tu sesión expiró — entrá de nuevo.';
    }
    throw new Error(data.error || 'Error de conexión con el servidor.');
  }
  return data;
}

const loginView = document.getElementById('admin-login-view');
const dashboardView = document.getElementById('admin-dashboard-view');
const passwordInput = document.getElementById('admin-password');
const loginButton = document.getElementById('admin-login-button');
const loginStatus = document.getElementById('admin-login-status');
const logoutButton = document.getElementById('admin-logout-button');

function showLogin() {
  loginView.hidden = false;
  dashboardView.hidden = true;
}

async function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  renderFlow();
  await loadAll();
}

async function loadAll() {
  await loadVendedores();
  await Promise.all([loadStickers(), loadPrecios(), loadVentas(), loadComisiones()]);
}

loginButton.addEventListener('click', async () => {
  const password = passwordInput.value;
  if (!password) return;
  loginStatus.className = 'modal-status';
  loginStatus.textContent = 'Entrando...';
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify({ password }) });
    setToken(data.token);
    passwordInput.value = '';
    loginStatus.textContent = '';
    await showDashboard();
  } catch (err) {
    loginStatus.className = 'modal-status is-error';
    loginStatus.textContent = err.message;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/session', { method: 'DELETE' });
  } catch {
    // logout local igual si falla el pedido
  }
  clearToken();
  showLogin();
});

const MONEY = (n) => `$${Number(n).toLocaleString('es-AR')}`;
const FECHA = (v) => (v ? new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const LOTE_TIPO_LABELS = { especial: 'Especial', normal: 'Lote', suelto: 'Suelto' };
const ESTADO_LABELS = { en_stock: 'En stock', vendido_pendiente: 'Vendido, sin activar', activo: 'Activo', inactivo: 'Inactivo' };
const FUNCION_LABELS = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  pago: 'Pago',
  menu: 'Menú',
  review: 'Reseña',
  web: 'Web propia',
  agenda: 'Agenda',
  linktree: 'LinkTree',
};

function renderTable(container, headers, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    return;
  }
  const theadHtml = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
  container.innerHTML = `<table>${theadHtml}<tbody>${rows.join('')}</tbody></table>`;
}

// Diagrama ilustrativo del ciclo de vida de un producto, del chip crudo a la
// comisión liquidada. Es solo informativo — no interactúa con la API.
const FLOW_STEPS = [
  { title: 'Registro de NFC crudo', desc: 'Se lee el UID del chip físico y se registra en el sistema.' },
  { title: 'Derivación de clave', desc: 'Se calcula la contraseña de escritura del chip (HMAC) — nunca se guarda.' },
  { title: 'Asignación de modelo', desc: 'Se define qué impreso 3D lleva ese NFC adentro: input para la impresión.' },
  { title: 'Asignación a vendedor', desc: 'El NFC + modelo queda en poder de un vendedor, listo para vender.' },
  { title: 'Venta y activación', desc: 'El comprador paga y activa su destino (WhatsApp, Instagram, etc).' },
  { title: 'Liquidación al vendedor', desc: 'Confirmado el pago, se calcula y liquida su comisión.' },
];

function renderFlow() {
  const container = document.getElementById('admin-flow');
  if (container.dataset.rendered) return;
  container.dataset.rendered = '1';
  container.innerHTML = FLOW_STEPS.map(
    (step, i) => `
    ${i > 0 ? '<div class="admin-flow-arrow">→</div>' : ''}
    <div class="admin-flow-step">
      <div class="admin-flow-num">${i + 1}</div>
      <h4>${step.title}</h4>
      <p>${step.desc}</p>
    </div>`
  ).join('');
}

// Toggle genérico de "+ Agregar" — abre/cierra un panel colapsable inline y
// rota el ícono. Se usa solo para "Agregar vendedor" (los de Inventario
// ahora son modales, ver wireModal más abajo).
function wireToggle(buttonId, panelId) {
  const button = document.getElementById(buttonId);
  const panel = document.getElementById(panelId);
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.classList.toggle('is-open', !panel.hidden);
  });
}
wireToggle('toggle-add-vendedor', 'add-vendedor-panel');

// Genérico para abrir/cerrar un .modal-overlay: click en el botón trigger lo
// abre, click en el botón de cerrar o en el fondo lo cierra.
function wireModal(triggerId, overlayId, closeId) {
  const overlay = document.getElementById(overlayId);
  document.getElementById(triggerId).addEventListener('click', () => overlay.classList.add('is-open'));
  document.getElementById(closeId).addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('is-open');
  });
}
wireModal('toggle-add-batch', 'batch-modal-overlay', 'batch-modal-close');
wireModal('toggle-add-individual', 'individual-modal-overlay', 'individual-modal-close');
wireModal('toggle-precios', 'precios-modal-overlay', 'precios-modal-close');
wireModal('toggle-lote-especial', 'especial-modal-overlay', 'especial-modal-close');

// --- Modal "Lote especial": una fila por sticker (modelo + función) ---
const MODELOS_ESP = ['llavero', 'tarjeta', 'placa'];
const especialRows = document.getElementById('especial-rows');

function especialAddRow(modelo = 'llavero', funcion = 'instagram') {
  const row = document.createElement('div');
  row.className = 'especial-row modal-form';
  row.innerHTML = `
    <label>
      <span>Modelo</span>
      <select class="esp-modelo">
        ${MODELOS_ESP.map((m) => `<option value="${m}"${m === modelo ? ' selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}
      </select>
    </label>
    <label>
      <span>¿A dónde apunta?</span>
      <select class="esp-funcion">
        <option value="">Sin definir</option>
        ${Object.entries(FUNCION_LABELS).map(([v, l]) => `<option value="${v}"${v === funcion ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="btn-ghost esp-remove" title="Quitar">✕</button>
  `;
  row.querySelector('.esp-remove').addEventListener('click', () => {
    if (especialRows.children.length > 1) row.remove();
  });
  especialRows.appendChild(row);
}

document.getElementById('especial-add-row').addEventListener('click', () => especialAddRow());
especialAddRow('llavero', 'whatsapp');
especialAddRow('llavero', 'instagram');

document.getElementById('create-especial-button').addEventListener('click', async () => {
  const nombre = document.getElementById('especial-nombre').value.trim();
  const status = document.getElementById('especial-status');
  const result = document.getElementById('especial-result');
  const items = [...especialRows.querySelectorAll('.especial-row')].map((r) => ({
    modelo: r.querySelector('.esp-modelo').value,
    funcion: r.querySelector('.esp-funcion').value || null,
  }));
  if (!items.length) {
    status.className = 'modal-status is-error';
    status.textContent = 'Agregá al menos un sticker.';
    return;
  }
  status.className = 'modal-status';
  status.textContent = 'Creando lote especial...';
  result.hidden = true;
  try {
    const data = await api('/stickers/lote-especial', {
      method: 'POST',
      body: JSON.stringify({ nombre: nombre || undefined, items }),
    });
    status.className = 'modal-status is-success';
    status.textContent = `Lote ${data.loteId} — ${data.cantidad} sticker(s) creados.`;
    result.hidden = false;
    result.innerHTML =
      '<p style="margin-bottom:8px;"><b>Links para grabar en cada chip:</b></p>' +
      data.creados
        .map(
          (c) =>
            `<div style="font-family:var(--mono);font-size:.8rem;margin:4px 0;">` +
            `${c.modelo}/${FUNCION_LABELS[c.funcion] || '—'} · <a href="${c.link}" target="_blank" rel="noopener">${c.link}</a></div>`
        )
        .join('');
    await loadStickers();
  } catch (err) {
    status.className = 'modal-status is-error';
    status.textContent = err.message;
  }
});

let vendedoresCache = [];
let stickersCache = [];

async function loadVendedores() {
  const container = document.getElementById('vendedores-table');
  try {
    vendedoresCache = await api('/vendedores');

    if (!vendedoresCache.length) {
      container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    } else {
      const rowsHtml = vendedoresCache
        .map(
          (v) => `
          <tr data-vendedor-row="${v.id}">
            <td><b>${v.nombre}</b></td>
            <td>${v.codigoRef}</td>
            <td>${v.comisionPct}%</td>
            <td>${(() => {
              const contacto = v.email || v.whatsapp;
              if (!contacto) return '—';
              return v.tieneLogin ? `${contacto} ✓ panel` : `${contacto} (sin contraseña)`;
            })()}</td>
            <td>${v.stockDisponible} / ${v.stockTotal}</td>
            <td>
              <button type="button" class="row-btn copy-link-btn" data-link="${v.linkCompra}">Copiar link</button>
              <button type="button" class="row-btn ver-stock-btn" data-id="${v.id}">Ver stock asignado</button>
              <button type="button" class="row-btn edit-vendedor-btn" data-id="${v.id}">Editar</button>
              <button type="button" class="row-btn danger delete-vendedor-btn" data-id="${v.id}">Eliminar</button>
            </td>
          </tr>
          <tr class="vendedor-edit-row" data-vendedor-edit="${v.id}" hidden>
            <td colspan="6">
              <div class="vendedor-edit-form">
                <div class="modal-form">
                  <label><span>Nombre</span><input type="text" class="edit-v-nombre" value="${v.nombre}"></label>
                  <label><span>Código ref.</span><input type="text" class="edit-v-ref" value="${v.codigoRef}"></label>
                  <label><span>Comisión (%)</span><input type="number" class="edit-v-comision" value="${v.comisionPct}" min="0" max="100"></label>
                  <label><span>Email (para su panel)</span><input type="email" class="edit-v-email" value="${v.email || ''}"></label>
                  <label><span>WhatsApp (alternativa al email)</span><input type="tel" class="edit-v-whatsapp" value="${v.whatsapp || ''}"></label>
                  <label><span>Nueva contraseña (dejar vacío para no cambiarla)</span><input type="password" class="edit-v-password" placeholder="••••••••"></label>
                </div>
                <div>
                  <button type="button" class="btn-primary modal-submit save-vendedor-btn" data-id="${v.id}" style="width:auto; display:inline-block;">Guardar</button>
                  <button type="button" class="btn-ghost cancel-vendedor-btn" data-id="${v.id}">Cancelar</button>
                </div>
                <p class="modal-status edit-v-status"></p>
              </div>
            </td>
          </tr>`
        )
        .join('');

      container.innerHTML = `<table><thead><tr><th>Nombre</th><th>Código ref.</th><th>Comisión</th><th>Login (email / WhatsApp)</th><th>Stock disponible / total</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;

      container.querySelectorAll('.copy-link-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(btn.dataset.link);
            const original = btn.textContent;
            btn.textContent = 'Copiado ✓';
            setTimeout(() => (btn.textContent = original), 1500);
          } catch {
            window.prompt('Copiá el link:', btn.dataset.link);
          }
        });
      });
      container.querySelectorAll('.ver-stock-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const vendedor = vendedoresCache.find((v) => String(v.id) === btn.dataset.id);
          openStockModal(vendedor);
        });
      });
      container.querySelectorAll('.edit-vendedor-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const editRow = container.querySelector(`[data-vendedor-edit="${btn.dataset.id}"]`);
          editRow.hidden = !editRow.hidden;
        });
      });
      container.querySelectorAll('.cancel-vendedor-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          container.querySelector(`[data-vendedor-edit="${btn.dataset.id}"]`).hidden = true;
        });
      });
      container.querySelectorAll('.save-vendedor-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const editRow = container.querySelector(`[data-vendedor-edit="${btn.dataset.id}"]`);
          const nombre = editRow.querySelector('.edit-v-nombre').value.trim();
          const codigoRef = editRow.querySelector('.edit-v-ref').value.trim();
          const comisionPct = Number(editRow.querySelector('.edit-v-comision').value);
          const whatsapp = editRow.querySelector('.edit-v-whatsapp').value.trim();
          const email = editRow.querySelector('.edit-v-email').value.trim();
          const password = editRow.querySelector('.edit-v-password').value;
          const status = editRow.querySelector('.edit-v-status');
          status.className = 'modal-status';
          status.textContent = 'Guardando...';
          try {
            await api(`/vendedores/${btn.dataset.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ nombre, codigoRef, comisionPct, whatsapp, email, ...(password ? { password } : {}) }),
            });
            await loadVendedores();
          } catch (err) {
            status.className = 'modal-status is-error';
            status.textContent = err.message;
          }
        });
      });
      container.querySelectorAll('.delete-vendedor-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este vendedor?')) return;
          try {
            await api(`/vendedores/${btn.dataset.id}`, { method: 'DELETE' });
            await loadVendedores();
          } catch (err) {
            alert(err.message);
          }
        });
      });
    }

    ['batch-vendedor', 'individual-vendedor'].forEach((id) => {
      const select = document.getElementById(id);
      const current = select.value;
      select.innerHTML =
        '<option value="">Sin asignar</option>' +
        vendedoresCache.map((v) => `<option value="${v.id}">${v.nombre} (${v.codigoRef})</option>`).join('');
      select.value = current;
    });
  } catch (err) {
    container.innerHTML = `<p class="admin-empty">${err.message}</p>`;
  }
}

document.getElementById('create-vendedor-button').addEventListener('click', async () => {
  const nombre = document.getElementById('new-vendedor-nombre').value.trim();
  const codigoRef = document.getElementById('new-vendedor-ref').value.trim();
  const comisionPct = Number(document.getElementById('new-vendedor-comision').value);
  const whatsapp = document.getElementById('new-vendedor-whatsapp').value.trim();
  const email = document.getElementById('new-vendedor-email').value.trim();
  const password = document.getElementById('new-vendedor-password').value;
  const status = document.getElementById('vendedor-status');

  if (!nombre || !codigoRef) {
    status.className = 'modal-status is-error';
    status.textContent = 'Completá nombre y código de referencia.';
    return;
  }
  if ((whatsapp || email) && !password) {
    status.className = 'modal-status is-error';
    status.textContent = 'Si cargás email o WhatsApp, definí también una contraseña.';
    return;
  }
  status.className = 'modal-status';
  status.textContent = 'Creando...';
  try {
    await api('/vendedores', { method: 'POST', body: JSON.stringify({ nombre, codigoRef, comisionPct, whatsapp, email, password }) });
    status.className = 'modal-status is-success';
    status.textContent = 'Vendedor creado.';
    document.getElementById('new-vendedor-nombre').value = '';
    document.getElementById('new-vendedor-ref').value = '';
    document.getElementById('new-vendedor-whatsapp').value = '';
    document.getElementById('new-vendedor-email').value = '';
    document.getElementById('new-vendedor-password').value = '';
    await loadVendedores();
    const panel = document.getElementById('add-vendedor-panel');
    panel.hidden = true;
    document.getElementById('toggle-add-vendedor').classList.remove('is-open');
  } catch (err) {
    status.className = 'modal-status is-error';
    status.textContent = err.message;
  }
});

// Modal "Ver stock asignado" — lee del cache de stickers ya cargado, sin pedir de nuevo a la API.
const stockModalOverlay = document.getElementById('stock-modal-overlay');
const stockModalTitle = document.getElementById('stock-modal-title');
const stockModalSub = document.getElementById('stock-modal-sub');
const stockModalTable = document.getElementById('stock-modal-table');
document.getElementById('stock-modal-close').addEventListener('click', closeStockModal);
stockModalOverlay.addEventListener('click', (e) => {
  if (e.target === stockModalOverlay) closeStockModal();
});

function openStockModal(vendedor) {
  const asignados = stickersCache.filter((s) => s.vendedor && s.vendedor.codigoRef === vendedor.codigoRef);
  stockModalTitle.textContent = `Stock asignado a ${vendedor.nombre}`;
  stockModalSub.textContent = `${asignados.length} sticker${asignados.length === 1 ? '' : 's'} en total.`;
  renderTable(
    stockModalTable,
    ['Código', 'Función', 'Modelo', 'Estado'],
    asignados.map(
      (s) => `<tr>
        <td><b>${s.codigoPublico}</b></td>
        <td>${FUNCION_LABELS[s.funcion] || '—'}</td>
        <td>${s.modelo || '—'}</td>
        <td>${ESTADO_LABELS[s.estado] || s.estado}</td>
      </tr>`
    )
  );
  stockModalOverlay.classList.add('is-open');
}
function closeStockModal() {
  stockModalOverlay.classList.remove('is-open');
}

// Inventario en 3 tablas, según en qué paso del flujo está cada NFC:
//   1. Crudos: falta función y/o modelo (todavía editable acá mismo).
//   2. Productos: ya tiene función+modelo, sin vendedor — se le asigna uno.
//   3. Asignados: ya tiene vendedor, todavía sin vender.
// Lo vendido no aparece acá — se ve en la sección Ventas.
async function loadStickers() {
  try {
    stickersCache = await api('/stickers');
    renderCrudosTable();
    renderProductosTable();
    renderAsignadosTable();
  } catch (err) {
    const msg = `<p class="admin-empty">${err.message}</p>`;
    document.getElementById('crudos-table').innerHTML = msg;
    document.getElementById('productos-table').innerHTML = msg;
    document.getElementById('asignados-table').innerHTML = msg;
  }
}

const FUNCION_OPTIONS = Object.entries(FUNCION_LABELS)
  .map(([id, label]) => `<option value="${id}">${label}</option>`)
  .join('');
const MODELO_OPTIONS_INV = ['llavero', 'tarjeta', 'placa']
  .map((id) => `<option value="${id}">${id[0].toUpperCase()}${id.slice(1)}</option>`)
  .join('');

function renderCrudosTable() {
  const container = document.getElementById('crudos-table');
  // Los de lote especial nunca van acá: su modelo y función se fijan al crear
  // el lote, no son "crudos" pendientes de definir.
  const crudos = stickersCache.filter(
    (s) => s.estado === 'en_stock' && !s.vendedor && !s.loteEspecial && (!s.funcion || !s.modelo)
  );

  if (!crudos.length) {
    container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    return;
  }

  const rowsHtml = crudos
    .map((s) => {
      // Lote especial: modelo y función se fijan al crear el lote — acá van de
      // solo lectura para no confundir (no se editan sticker por sticker).
      const funcionCell = s.loteEspecial
        ? `<td>${FUNCION_LABELS[s.funcion] || '<span class="admin-muted">sin definir</span>'}</td>`
        : `<td>
            <select class="row-funcion-select" data-id="${s.id}">
              <option value="">Sin asignar</option>
              ${FUNCION_OPTIONS}
            </select>
          </td>`;
      const modeloCell = s.loteEspecial
        ? `<td>${s.modelo || '<span class="admin-muted">sin definir</span>'}</td>`
        : `<td>
            <select class="row-modelo-select" data-id="${s.id}">
              <option value="">Sin asignar</option>
              ${MODELO_OPTIONS_INV}
            </select>
          </td>`;
      const loteCell = s.loteId
        ? `<b>#${s.loteId}</b>${s.lote ? ` ${s.lote}` : ''}${s.loteCantidad ? ` <span class="admin-muted">(x${s.loteCantidad})</span>` : ''}`
        : '<span class="admin-muted">—</span>';
      return `<tr>
        <td><b>${s.codigoPublico}</b>${s.loteEspecial ? ' <span class="admin-tag">Especial</span>' : ''}</td>
        ${funcionCell}
        ${modeloCell}
        <td>${FECHA(s.creadoEn)}</td>
        <td><span class="admin-tag">${s.loteTipoNombre || LOTE_TIPO_LABELS[s.loteTipo] || s.loteTipo}</span></td>
        <td>${loteCell}</td>
        ${candadoCellHtml(s)}
        <td><button type="button" class="row-btn danger delete-sticker-btn" data-id="${s.id}">Eliminar</button></td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `<table><thead><tr><th>Código</th><th>Función</th><th>Modelo</th><th>Creado</th><th>Tipo</th><th>Lote</th><th>Candado</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;

  container.querySelectorAll('.row-funcion-select').forEach((select) => {
    const s = crudos.find((c) => String(c.id) === select.dataset.id);
    select.value = s.funcion || '';
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api(`/stickers/${select.dataset.id}/funcion`, {
          method: 'PATCH',
          body: JSON.stringify({ funcion: select.value }),
        });
        await loadStickers();
      } catch (err) {
        select.disabled = false;
        alert(err.message);
      }
    });
  });
  container.querySelectorAll('.row-modelo-select').forEach((select) => {
    const s = crudos.find((c) => String(c.id) === select.dataset.id);
    select.value = s.modelo || '';
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        await api(`/stickers/${select.dataset.id}/modelo`, {
          method: 'PATCH',
          body: JSON.stringify({ modelo: select.value }),
        });
        await loadStickers();
      } catch (err) {
        select.disabled = false;
        alert(err.message);
      }
    });
  });
  wireCandadoButtons(container);
  wireDeleteButtons(container);
}

function renderProductosTable() {
  const container = document.getElementById('productos-table');
  // Productos = stock listo para asignar a vendedor. Los de lote especial
  // entran siempre (aunque les falte la función), porque no pasan por "crudos".
  const productos = stickersCache.filter(
    (s) => s.estado === 'en_stock' && !s.vendedor && (s.loteEspecial || (s.funcion && s.modelo))
  );

  if (!productos.length) {
    container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    return;
  }

  const rowsHtml = productos
    .map(
      (s) => `<tr>
        <td><input type="checkbox" class="bulk-check" data-id="${s.id}"></td>
        <td><b>${s.codigoPublico}</b>${s.loteEspecial ? ' <span class="admin-tag">Especial</span>' : ''}</td>
        <td>${FUNCION_LABELS[s.funcion] || '<span class="admin-muted">sin definir</span>'}</td>
        <td>${s.modelo || '<span class="admin-muted">sin definir</span>'}</td>
        <td>
          <select class="row-vendedor-select" data-id="${s.id}">
            <option value="">Sin asignar</option>
            ${vendedoresCache.map((v) => `<option value="${v.id}">${v.nombre} (${v.codigoRef})</option>`).join('')}
          </select>
        </td>
        ${candadoCellHtml(s)}
        <td><button type="button" class="row-btn danger delete-sticker-btn" data-id="${s.id}">Eliminar</button></td>
      </tr>`
    )
    .join('');

  container.innerHTML = `<table><thead><tr><th></th><th>Código</th><th>Función</th><th>Modelo</th><th>Vendedor</th><th>Candado</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;

  container.querySelectorAll('.row-vendedor-select').forEach((select) => {
    select.addEventListener('change', async () => {
      if (!select.value) return;
      select.disabled = true;
      try {
        await api(`/stickers/${select.dataset.id}/asignar`, {
          method: 'PATCH',
          body: JSON.stringify({ vendedorId: select.value }),
        });
        await Promise.all([loadStickers(), loadVendedores()]);
      } catch (err) {
        select.disabled = false;
        alert(err.message);
      }
    });
  });
  container.querySelectorAll('.bulk-check').forEach((checkbox) => {
    checkbox.addEventListener('change', updateBulkAssignBar);
  });
  updateBulkAssignBar();
  wireCandadoButtons(container);
  wireDeleteButtons(container);
}

const bulkAssignBar = document.getElementById('bulk-assign-bar');
const bulkAssignCount = document.getElementById('bulk-assign-count');
const bulkAssignVendedorSelect = document.getElementById('bulk-assign-vendedor');
const bulkAssignStatus = document.getElementById('bulk-assign-status');

function updateBulkAssignBar() {
  const checked = document.querySelectorAll('#productos-table .bulk-check:checked');
  bulkAssignBar.hidden = checked.length === 0;
  bulkAssignCount.textContent = `${checked.length} seleccionado${checked.length === 1 ? '' : 's'}`;
  const currentVendedor = bulkAssignVendedorSelect.value;
  bulkAssignVendedorSelect.innerHTML =
    '<option value="">Elegí vendedor…</option>' +
    vendedoresCache.map((v) => `<option value="${v.id}">${v.nombre} (${v.codigoRef})</option>`).join('');
  bulkAssignVendedorSelect.value = currentVendedor;
  bulkAssignStatus.textContent = '';
  bulkAssignStatus.className = 'modal-status';
}

document.getElementById('bulk-assign-button').addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('#productos-table .bulk-check:checked')).map((c) => c.dataset.id);
  const vendedorId = bulkAssignVendedorSelect.value;
  if (!ids.length || !vendedorId) {
    bulkAssignStatus.className = 'modal-status is-error';
    bulkAssignStatus.textContent = 'Elegí al menos un NFC y un vendedor.';
    return;
  }
  bulkAssignStatus.className = 'modal-status';
  bulkAssignStatus.textContent = 'Asignando...';
  try {
    for (const id of ids) {
      await api(`/stickers/${id}/asignar`, { method: 'PATCH', body: JSON.stringify({ vendedorId }) });
    }
    await Promise.all([loadStickers(), loadVendedores()]);
  } catch (err) {
    bulkAssignStatus.className = 'modal-status is-error';
    bulkAssignStatus.textContent = err.message;
  }
});

function renderAsignadosTable() {
  const container = document.getElementById('asignados-table');
  const asignados = stickersCache.filter((s) => s.estado === 'en_stock' && s.vendedor);

  if (!asignados.length) {
    container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    return;
  }

  const rowsHtml = asignados
    .map(
      (s) => `<tr>
        <td><b>${s.codigoPublico}</b>${s.loteEspecial ? ' <span class="admin-tag">Especial</span>' : ''}</td>
        <td>${FUNCION_LABELS[s.funcion] || '—'}</td>
        <td>${s.modelo}</td>
        <td>${s.vendedor.nombre} (${s.vendedor.codigoRef})</td>
        <td>Asignado, sin vender</td>
        <td>${s.asignadoEn ? new Date(s.asignadoEn).toLocaleDateString('es-AR') : '—'}</td>
        ${candadoCellHtml(s)}
        <td>
          <button type="button" class="row-btn quitar-vendedor-btn" data-id="${s.id}">Quitar vendedor</button>
          <button type="button" class="row-btn danger delete-sticker-btn" data-id="${s.id}">Eliminar</button>
        </td>
      </tr>`
    )
    .join('');

  container.innerHTML = `<table><thead><tr><th>Código</th><th>Función</th><th>Modelo</th><th>Vendedor</th><th>Estado</th><th>Fecha de asignación</th><th>Candado</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;

  container.querySelectorAll('.quitar-vendedor-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/stickers/${btn.dataset.id}/asignar`, { method: 'PATCH', body: JSON.stringify({ vendedorId: null }) });
        await Promise.all([loadStickers(), loadVendedores()]);
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    });
  });
  wireCandadoButtons(container);
  wireDeleteButtons(container);
}

// Candado: columna que aparece en las 3 tablas de inventario, para cualquier
// sticker con UID real (no aplica a los de lote simulado). "Ver clave" pide
// PWD_AUTH/PACK recalculados; "Marcar candado" es la confirmación manual de
// que ya se escribió AUTH0 en el chip físico — el sistema no lo puede saber solo.
function candadoCellHtml(s) {
  if (!s.uidNfc) return '<td>—</td>';
  if (s.protegidoEn) return '<td>🔒 protegido</td>';
  return `<td>
    <button type="button" class="row-btn ver-clave-btn" data-id="${s.id}">Ver clave</button>
    <button type="button" class="row-btn marcar-candado-btn" data-id="${s.id}">Marcar candado</button>
  </td>`;
}

function wireCandadoButtons(container) {
  container.querySelectorAll('.ver-clave-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const data = await api(`/stickers/${btn.dataset.id}/clave`);
        alert(`PWD_AUTH: ${data.writePassword}\nPACK: ${data.writePack}`);
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
  container.querySelectorAll('.marcar-candado-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Ya escribiste AUTH0 en el chip físico? Esto solo lo registra acá, no programa nada.')) return;
      btn.disabled = true;
      try {
        await api(`/stickers/${btn.dataset.id}/candado`, { method: 'PATCH' });
        await loadStickers();
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    });
  });
}

function wireDeleteButtons(container) {
  container.querySelectorAll('.delete-sticker-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este sticker sin vender?')) return;
      try {
        await api(`/stickers/${btn.dataset.id}`, { method: 'DELETE' });
        await Promise.all([loadStickers(), loadVendedores()]);
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

document.getElementById('create-batch-button').addEventListener('click', async () => {
  const cantidad = Number(document.getElementById('batch-cantidad').value);
  const funcion = document.getElementById('batch-funcion').value;
  const modelo = document.getElementById('batch-modelo').value;
  const vendedorId = document.getElementById('batch-vendedor').value || null;
  const status = document.getElementById('batch-status');

  status.className = 'modal-status';
  status.textContent = 'Creando lote...';
  try {
    const data = await api('/stickers/batch', {
      method: 'POST',
      body: JSON.stringify({ cantidad, funcion, modelo, vendedorId }),
    });
    status.className = 'modal-status is-success';
    status.textContent = `Creados ${data.creados.length} stickers.`;
    await Promise.all([loadStickers(), loadVendedores()]);
  } catch (err) {
    status.className = 'modal-status is-error';
    status.textContent = err.message;
  }
});

document.getElementById('create-individual-button').addEventListener('click', async () => {
  const uidNfc = document.getElementById('individual-uid').value.trim();
  const funcion = document.getElementById('individual-funcion').value;
  const modelo = document.getElementById('individual-modelo').value;
  const vendedorId = document.getElementById('individual-vendedor').value || null;
  const status = document.getElementById('individual-status');
  const result = document.getElementById('individual-result');

  if (!uidNfc) {
    status.className = 'modal-status is-error';
    status.textContent = 'Pegá el UID del chip primero.';
    return;
  }
  status.className = 'modal-status';
  status.textContent = 'Generando...';
  result.hidden = true;
  try {
    const data = await api('/stickers/individual', {
      method: 'POST',
      body: JSON.stringify({ uidNfc, funcion, modelo, vendedorId }),
    });
    status.className = 'modal-status is-success';
    status.textContent = 'Listo — copiá la clave ahora, no se vuelve a mostrar.';
    result.hidden = false;
    result.innerHTML = `
      <div><b>Código público:</b> ${data.codigoPublico}</div>
      <div><b>URL a grabar en el chip:</b> ${data.url}</div>
      <div><b>Clave de escritura (PWD_AUTH):</b> ${data.writePassword}</div>
      <div><b>PACK:</b> ${data.writePack}</div>
      <div style="margin-top:8px">
        <button type="button" class="row-btn marcar-candado-btn" data-id="${data.id}">Marcar candado (ya escribí AUTH0)</button>
      </div>
    `;
    wireCandadoButtons(result);
    document.getElementById('individual-uid').value = '';
    await Promise.all([loadStickers(), loadVendedores()]);
  } catch (err) {
    status.className = 'modal-status is-error';
    status.textContent = err.message;
  }
});

const MODELO_LABELS = { llavero: 'Llavero', tarjeta: 'Tarjeta', placa: 'Placa', suelto: 'Suelto' };
const MODELO_ORDEN = ['llavero', 'tarjeta', 'placa', 'suelto'];

async function loadPrecios() {
  const container = document.getElementById('precios-form');
  const status = document.getElementById('precios-status');
  try {
    const precios = await api('/precios');
    const porModelo = Object.fromEntries(precios.map((p) => [p.modelo, p.precio]));

    container.innerHTML = MODELO_ORDEN.map(
      (modelo) => `
      <label>
        <span>${MODELO_LABELS[modelo]}</span>
        <input type="number" class="precio-input" min="0" step="50" data-modelo="${modelo}" value="${porModelo[modelo] ?? ''}">
      </label>`
    ).join('');

    container.querySelectorAll('.precio-input').forEach((input) => {
      let lastSaved = input.value;
      input.addEventListener('change', async () => {
        const precio = Number(input.value);
        if (!Number.isFinite(precio) || precio < 0) {
          input.value = lastSaved;
          return;
        }
        status.className = 'modal-status';
        status.textContent = 'Guardando...';
        try {
          await api('/precios', { method: 'PATCH', body: JSON.stringify({ modelo: input.dataset.modelo, precio }) });
          lastSaved = input.value;
          status.className = 'modal-status is-success';
          status.textContent = 'Guardado.';
        } catch (err) {
          input.value = lastSaved;
          status.className = 'modal-status is-error';
          status.textContent = err.message;
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="admin-empty">${err.message}</p>`;
  }
}

async function loadVentas() {
  const container = document.getElementById('ventas-table');
  try {
    const ventas = await api('/ventas');
    renderTable(
      container,
      ['Productos', 'Vendedor', 'Monto', 'Estado', 'Fecha', ''],
      ventas.map(
        (v) => `<tr>
          <td>${
            v.items && v.items.length
              ? v.items.map((it) => `<b>${it.stickerCodigo}</b> (${it.modelo || 'sin modelo'})`).join(', ')
              : '—'
          }</td>
          <td>${v.vendedorNombre || '—'}</td>
          <td>${MONEY(v.monto)}</td>
          <td>${v.estadoPago}</td>
          <td>${v.fecha}</td>
          <td>${
            v.estadoPago === 'confirmado' && !v.comisionLiquidada
              ? `<button type="button" class="row-btn liquidar-btn" data-id="${v.id}">Liquidar</button>`
              : v.comisionLiquidada
                ? '✓ liquidada'
                : v.estadoPago === 'pendiente'
                  ? `<button type="button" class="row-btn danger cancelar-venta-btn" data-id="${v.id}">Cancelar</button>`
                  : ''
          }</td>
        </tr>`
      )
    );
    container.querySelectorAll('.liquidar-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api(`/ventas/${btn.dataset.id}/liquidar`, { method: 'PATCH' });
          await Promise.all([loadVentas(), loadComisiones()]);
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });
    container.querySelectorAll('.cancelar-venta-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Cancelar esta venta pendiente? Los stickers vuelven a stock.')) return;
        btn.disabled = true;
        try {
          await api(`/ventas/${btn.dataset.id}`, { method: 'DELETE' });
          await Promise.all([loadVentas(), loadStickers(), loadComisiones()]);
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="admin-empty">${err.message}</p>`;
  }
}

async function loadComisiones() {
  const container = document.getElementById('comisiones-table');
  try {
    const comisiones = await api('/comisiones');
    renderTable(
      container,
      ['Vendedor', 'Ventas totales', 'Comisión pendiente', 'Comisión liquidada'],
      comisiones.map(
        (c) => `<tr>
          <td><b>${c.nombre}</b> (${c.comisionPct}%)</td>
          <td>${MONEY(c.ventasTotales)}</td>
          <td>${MONEY(c.comisionPendiente)}</td>
          <td>${MONEY(c.comisionLiquidada)}</td>
        </tr>`
      )
    );
  } catch (err) {
    container.innerHTML = `<p class="admin-empty">${err.message}</p>`;
  }
}

initNfcGrabar({
  api,
  getVendedores: () => vendedoresCache,
  onSaved: () => { loadStickers(); },
});

if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
