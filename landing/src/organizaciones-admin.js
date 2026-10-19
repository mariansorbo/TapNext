// Sección "Organizaciones" del panel admin: qué cuentas son de empresa (sus
// productos muestran "NextTap by <nombre>" + su imagen al tapear). Se convierte
// una cuenta por mail — si no existe todavía, se crea y la empresa entra a Mi
// panel con un código. La imagen la carga la organización desde Mi panel.
// Backend en server/organizaciones.js.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function initOrganizacionesAdmin({ api, apiBase }) {
  const tabla = document.getElementById('organizaciones-table');
  const emailInput = document.getElementById('new-org-email');
  const nombreInput = document.getElementById('new-org-nombre');
  const crearBtn = document.getElementById('create-org-button');
  const status = document.getElementById('org-admin-status');
  const toggle = document.getElementById('toggle-add-org');
  const panel = document.getElementById('add-org-panel');

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) emailInput.focus();
  });

  async function cargar() {
    try {
      const orgs = await api('/organizaciones');
      if (!orgs.length) {
        tabla.innerHTML = '<p class="admin-empty">Todavía no hay organizaciones.</p>';
        return;
      }
      tabla.innerHTML = `<table><thead><tr><th>Imagen</th><th>Nombre</th><th>Cuenta</th><th>Productos</th><th></th></tr></thead><tbody>${orgs
        .map(
          (o) => `<tr>
            <td>${
              o.imagenUrl
                ? `<img src="${esc(apiBase + o.imagenUrl)}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;display:block">`
                : '<span class="admin-muted">sin imagen</span>'
            }</td>
            <td><b>${esc(o.nombre)}</b></td>
            <td>${esc(o.email || '—')}</td>
            <td>${o.productos}</td>
            <td>
              <button type="button" class="row-btn org-renombrar" data-id="${o.compradorId}" data-nombre="${esc(o.nombre)}">Renombrar</button>
              <button type="button" class="row-btn danger org-quitar" data-id="${o.compradorId}" data-nombre="${esc(o.nombre)}">Quitar</button>
            </td>
          </tr>`
        )
        .join('')}</tbody></table>`;

      tabla.querySelectorAll('.org-renombrar').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const nombre = prompt('Nombre que se muestra ("NextTap by …"):', btn.dataset.nombre);
          if (nombre == null) return;
          try {
            await api(`/organizaciones/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ nombre }) });
            await cargar();
          } catch (err) {
            alert(err.message);
          }
        })
      );
      tabla.querySelectorAll('.org-quitar').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm(`¿Quitar "${btn.dataset.nombre}" como organización? La cuenta y sus productos siguen, pero el tap vuelve a la pantalla común y se borra su imagen.`)) return;
          try {
            await api(`/organizaciones/${btn.dataset.id}`, { method: 'DELETE' });
            await cargar();
          } catch (err) {
            alert(err.message);
          }
        })
      );
    } catch (err) {
      tabla.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
    }
  }

  crearBtn.addEventListener('click', async () => {
    status.className = 'modal-status';
    status.textContent = '';
    crearBtn.disabled = true;
    try {
      await api('/organizaciones', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput.value, nombre: nombreInput.value }),
      });
      status.className = 'modal-status is-success';
      status.textContent = 'Listo. La organización entra a Mi panel con ese mail y carga su imagen.';
      emailInput.value = '';
      nombreInput.value = '';
      await cargar();
    } catch (err) {
      status.className = 'modal-status is-error';
      status.textContent = err.message;
    } finally {
      crearBtn.disabled = false;
    }
  });

  return cargar;
}
