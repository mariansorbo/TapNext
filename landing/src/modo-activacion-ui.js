// Celda "Modo" de las tablas de inventario del panel de admin: muestra el modo
// de activación actual del producto (bloqueada / liberada / gratis) y tres
// botones para cambiarlo en el acto. Pega a POST /api/admin/stickers/:id/modo;
// si el server pide "reescritura maestra" (producto ya vendido/activo) ofrece
// forzar. Ver server/modo-activacion.js.
//
// Vive aparte de admin.js para que el diff en el panel sea mínimo: admin.js sólo
// agrega un <th>, una celda por fila y una llamada a wireModoButtons por tabla.

export const MODO_INFO = {
  bloqueada: { icon: '🔒', label: 'Bloqueada', ayuda: 'Necesita que un vendedor lo venda (pago + verificación) para activarse.' },
  liberada: { icon: '🔓', label: 'Liberada', ayuda: 'Se activa por posesión física pagando, sin verificar el mail (para revender en locales).' },
  gratis: { icon: '🎁', label: 'Gratis', ayuda: 'Se activa por posesión física sin pagar, solo con el mail (para amigos).' },
};
const MODOS = ['bloqueada', 'liberada', 'gratis'];

// Celda de una fila. `s` es un item de GET /api/admin/stickers.
export function modoCeldaHtml(s) {
  const actual = s.modoActivacion || 'bloqueada';
  const info = MODO_INFO[actual] || MODO_INFO.bloqueada;
  const botones = MODOS.map((m) => {
    const b = MODO_INFO[m];
    const activo = m === actual;
    return `<button type="button" class="row-btn modo-btn${activo ? ' is-current' : ''}"
      data-id="${s.id}" data-modo="${m}" title="${b.label} — ${b.ayuda}"${activo ? ' disabled' : ''}>${b.icon}</button>`;
  }).join('');
  return `<td class="modo-cell" data-modo="${actual}">
    <span class="admin-tag modo-tag modo-${actual}">${info.icon} ${info.label}</span>
    <span class="modo-btns">${botones}</span>
  </td>`;
}

async function postModo(api, id, modo, forzar) {
  return api(`/stickers/${id}/modo`, { method: 'POST', body: JSON.stringify({ modo, forzar }) });
}

// Engancha los botones de una tabla ya renderizada.
//   api    — el helper api() de admin.js
//   reload — async fn para refrescar las tablas después de un cambio
export function wireModoButtons(container, api, reload) {
  const botones = container.querySelectorAll('.modo-btn');
  botones.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { id, modo } = btn.dataset;
      const cur = btn.closest('.modo-cell')?.dataset.modo;
      if (!id || modo === cur) return;
      const info = MODO_INFO[modo];
      if (!confirm(`¿Cambiar el modo de activación de este producto a "${info.label}"?\n\n${info.ayuda}`)) return;

      botones.forEach((b) => { b.disabled = true; });
      try {
        await postModo(api, id, modo, false);
        await reload();
        return;
      } catch (err) {
        const necesitaForzar = /reescritura maestra/i.test(err.message || '');
        if (necesitaForzar && confirm(`${err.message}\n\n¿Forzar igual? Esto anula la venta anterior y deja huérfano al comprador.`)) {
          try {
            await postModo(api, id, modo, true);
            await reload();
            return;
          } catch (err2) {
            alert(err2.message);
          }
        } else if (!necesitaForzar) {
          alert(err.message);
        }
        botones.forEach((b) => { b.disabled = false; });
      }
    });
  });
}
