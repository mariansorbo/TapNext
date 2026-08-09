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
  await loadAll();
}

async function loadAll() {
  await loadVendedores();
  await Promise.all([loadStickers(), loadVentas(), loadComisiones()]);
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

function renderTable(container, headers, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="admin-empty">Todavía no hay nada acá.</p>';
    return;
  }
  const theadHtml = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
  container.innerHTML = `<table>${theadHtml}<tbody>${rows.join('')}</tbody></table>`;
}

let vendedoresCache = [];

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

async function loadStickers() {
  const container = document.getElementById('stickers-table');
  try {
    const stickers = await api('/stickers');
    renderTable(
      container,
      ['Código', 'Modelo', 'Estado', 'Vendedor', 'Comprador', ''],
      stickers.map(
        (s) => `<tr>
          <td><b>${s.codigoPublico}</b></td>
          <td>${s.modelo || '—'}</td>
          <td>${ESTADO_LABELS[s.estado] || s.estado}</td>
          <td>${s.vendedor ? `${s.vendedor.nombre} (${s.vendedor.codigoRef})` : '—'}</td>
          <td>${s.comprador ? s.comprador.whatsapp : '—'}</td>
          <td>${s.estado === 'en_stock' ? `<button type="button" class="row-btn danger delete-sticker-btn" data-id="${s.id}">Eliminar</button>` : ''}</td>
        </tr>`
      )
    );
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
  } catch (err) {
    container.innerHTML = `<p class="admin-empty">${err.message}</p>`;
  }
}

document.getElementById('create-batch-button').addEventListener('click', async () => {
  const cantidad = Number(document.getElementById('batch-cantidad').value);
  const modelo = document.getElementById('batch-modelo').value;
  const vendedorId = document.getElementById('batch-vendedor').value || null;
  const status = document.getElementById('batch-status');

  status.className = 'modal-status';
  status.textContent = 'Creando lote...';
  try {
    const data = await api('/stickers/batch', {
      method: 'POST',
      body: JSON.stringify({ cantidad, modelo, vendedorId }),
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
      body: JSON.stringify({ uidNfc, modelo, vendedorId }),
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

async function loadVentas() {
  const container = document.getElementById('ventas-table');
  try {
    const ventas = await api('/ventas');
    renderTable(
      container,
      ['Sticker', 'Vendedor', 'Monto', 'Estado', 'Fecha', ''],
      ventas.map(
        (v) => `<tr>
          <td><b>${v.stickerCodigo || '—'}</b></td>
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
