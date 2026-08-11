import './styles.css';
import { applyBrand } from './brand.js';

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
  if (!res.ok) throw new Error(data.error || 'Error de conexión con el servidor.');
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

let vendedoresCache = [];
let stickersCache = [];
let stockFilter = 'asignados';

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
            <td>${v.stockDisponible} / ${v.stockTotal}</td>
            <td>
              <button type="button" class="row-btn ver-stock-btn" data-id="${v.id}">Ver stock asignado</button>
              <button type="button" class="row-btn edit-vendedor-btn" data-id="${v.id}">Editar</button>
              <button type="button" class="row-btn danger delete-vendedor-btn" data-id="${v.id}">Eliminar</button>
            </td>
          </tr>
          <tr class="vendedor-edit-row" data-vendedor-edit="${v.id}" hidden>
            <td colspan="5">
              <div class="vendedor-edit-form">
                <div class="modal-form">
                  <label><span>Nombre</span><input type="text" class="edit-v-nombre" value="${v.nombre}"></label>
                  <label><span>Código ref.</span><input type="text" class="edit-v-ref" value="${v.codigoRef}"></label>
                  <label><span>Comisión (%)</span><input type="number" class="edit-v-comision" value="${v.comisionPct}" min="0" max="100"></label>
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

      container.innerHTML = `<table><thead><tr><th>Nombre</th><th>Código ref.</th><th>Comisión</th><th>Stock disponible / total</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;

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
          const status = editRow.querySelector('.edit-v-status');
          status.className = 'modal-status';
          status.textContent = 'Guardando...';
          try {
            await api(`/vendedores/${btn.dataset.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ nombre, codigoRef, comisionPct }),
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
  const status = document.getElementById('vendedor-status');

  if (!nombre || !codigoRef) {
    status.className = 'modal-status is-error';
    status.textContent = 'Completá nombre y código de referencia.';
    return;
  }
  status.className = 'modal-status';
  status.textContent = 'Creando...';
  try {
    await api('/vendedores', { method: 'POST', body: JSON.stringify({ nombre, codigoRef, comisionPct }) });
    status.className = 'modal-status is-success';
    status.textContent = 'Vendedor creado.';
    document.getElementById('new-vendedor-nombre').value = '';
    document.getElementById('new-vendedor-ref').value = '';
    await loadVendedores();
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

// Modal "Editar NFC" — solo se ofrece mientras el NFC está en stock y sin
// vendedor asignado. Una vez que tiene vendedor, código+función+modelo quedan
// fijos (ya es el input que le entregaste a esa persona para vender).
const editStockModalOverlay = document.getElementById('edit-stock-modal-overlay');
const editStockCodigo = document.getElementById('edit-stock-codigo');
const editStockFuncionSelect = document.getElementById('edit-stock-funcion');
const editStockModeloSelect = document.getElementById('edit-stock-modelo');
const editStockVendedorSelect = document.getElementById('edit-stock-vendedor');
const editStockStatus = document.getElementById('edit-stock-status');
let editingStickerId = null;

document.getElementById('edit-stock-modal-close').addEventListener('click', closeEditStockModal);
editStockModalOverlay.addEventListener('click', (e) => {
  if (e.target === editStockModalOverlay) closeEditStockModal();
});

function openEditStockModal(sticker) {
  editingStickerId = sticker.id;
  editStockCodigo.textContent = sticker.codigoPublico;
  editStockFuncionSelect.value = sticker.funcion || '';
  editStockModeloSelect.value = sticker.modelo || '';
  editStockVendedorSelect.innerHTML =
    '<option value="">Sin asignar</option>' +
    vendedoresCache.map((v) => `<option value="${v.id}">${v.nombre} (${v.codigoRef})</option>`).join('');
  editStockVendedorSelect.value = '';
  editStockStatus.textContent = '';
  editStockStatus.className = 'modal-status';
  editStockModalOverlay.classList.add('is-open');
}
function closeEditStockModal() {
  editStockModalOverlay.classList.remove('is-open');
  editingStickerId = null;
}

document.getElementById('edit-stock-save-button').addEventListener('click', async () => {
  if (!editingStickerId) return;
  editStockStatus.className = 'modal-status';
  editStockStatus.textContent = 'Guardando...';
  try {
    await api(`/stickers/${editingStickerId}/funcion`, {
      method: 'PATCH',
      body: JSON.stringify({ funcion: editStockFuncionSelect.value }),
    });
    await api(`/stickers/${editingStickerId}/modelo`, {
      method: 'PATCH',
      body: JSON.stringify({ modelo: editStockModeloSelect.value }),
    });
    if (editStockVendedorSelect.value) {
      await api(`/stickers/${editingStickerId}/asignar`, {
        method: 'PATCH',
        body: JSON.stringify({ vendedorId: editStockVendedorSelect.value }),
      });
    }
    closeEditStockModal();
    await Promise.all([loadVendedores(), loadStickers()]);
  } catch (err) {
    editStockStatus.className = 'modal-status is-error';
    editStockStatus.textContent = err.message;
  }
});

document.querySelectorAll('.admin-filter-btn').forEach((btn) => {
  btn.classList.toggle('is-active', btn.dataset.filter === stockFilter);
  btn.addEventListener('click', () => {
    stockFilter = btn.dataset.filter;
    document.querySelectorAll('.admin-filter-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderStickersTable();
  });
});

async function loadStickers() {
  try {
    stickersCache = await api('/stickers');
    renderStickersTable();
  } catch (err) {
    document.getElementById('stickers-table').innerHTML = `<p class="admin-empty">${err.message}</p>`;
  }
}

function renderStickersTable() {
  const container = document.getElementById('stickers-table');
  const stickers = stockFilter === 'asignados' ? stickersCache.filter((s) => s.vendedor) : stickersCache;

  if (!stickers.length) {
    container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    return;
  }

  // Modelo y vendedor son de solo lectura acá una vez asignados. Mientras el
  // NFC esté en stock y SIN vendedor, se puede editar vía el botón "Editar"
  // (abre un modal) — apenas tiene vendedor, código+función+modelo quedan
  // fijos (ya es el input que se le entregó a esa persona para vender).
  const rowsHtml = stickers
    .map((s) => {
      const isStock = s.estado === 'en_stock';
      const isLocked = Boolean(s.vendedor);
      const acciones = [];
      if (isStock && !isLocked) acciones.push(`<button type="button" class="row-btn edit-stock-btn" data-id="${s.id}">Editar</button>`);
      if (isStock) acciones.push(`<button type="button" class="row-btn danger delete-sticker-btn" data-id="${s.id}">Eliminar</button>`);

      return `<tr>
        <td><b>${s.codigoPublico}</b></td>
        <td>${FUNCION_LABELS[s.funcion] || '—'}</td>
        <td>${s.modelo || '—'}</td>
        <td>${ESTADO_LABELS[s.estado] || s.estado}</td>
        <td>${s.vendedor ? `${s.vendedor.nombre} (${s.vendedor.codigoRef})` : '—'}</td>
        <td>${s.comprador ? s.comprador.whatsapp : '—'}</td>
        <td>${acciones.join(' ')}</td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `<table><thead><tr><th>Código</th><th>Función</th><th>Modelo</th><th>Estado</th><th>Vendedor</th><th>Comprador</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;

  container.querySelectorAll('.edit-stock-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sticker = stickersCache.find((s) => String(s.id) === btn.dataset.id);
      openEditStockModal(sticker);
    });
  });
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
    `;
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
  const container = document.getElementById('precios-table');
  try {
    const precios = await api('/precios');
    const porFuncion = {};
    precios.forEach((p) => {
      porFuncion[p.funcion] = porFuncion[p.funcion] || {};
      porFuncion[p.funcion][p.modelo] = p.precio;
    });
    const funciones = Object.keys(FUNCION_LABELS);

    const headHtml = `<tr><th>Función</th>${MODELO_ORDEN.map((m) => `<th>${MODELO_LABELS[m]}</th>`).join('')}</tr>`;
    const rowsHtml = funciones
      .map(
        (funcion) => `<tr>
          <td><b>${FUNCION_LABELS[funcion]}</b></td>
          ${MODELO_ORDEN.map(
            (modelo) => `<td>
              <input type="number" class="precio-input" min="0" step="50"
                data-funcion="${funcion}" data-modelo="${modelo}"
                value="${porFuncion[funcion]?.[modelo] ?? ''}">
            </td>`
          ).join('')}
        </tr>`
      )
      .join('');

    container.innerHTML = `<table><thead>${headHtml}</thead><tbody>${rowsHtml}</tbody></table>`;

    container.querySelectorAll('.precio-input').forEach((input) => {
      let lastSaved = input.value;
      input.addEventListener('change', async () => {
        const precio = Number(input.value);
        if (!Number.isFinite(precio) || precio < 0) {
          input.value = lastSaved;
          return;
        }
        try {
          await api('/precios', {
            method: 'PATCH',
            body: JSON.stringify({ funcion: input.dataset.funcion, modelo: input.dataset.modelo, precio }),
          });
          lastSaved = input.value;
        } catch (err) {
          input.value = lastSaved;
          alert(err.message);
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

if (getToken()) {
  showDashboard().catch(() => showLogin());
} else {
  showLogin();
}
