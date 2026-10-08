// Sección "Sorteo Instagram" del panel admin: participantes, chances, marcado
// en bloque de historias / posteos / seguidores y el sorteo en sí (con ruleta
// para filmarlo en vivo). Backend en server/sorteo.js.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// wa.me necesita el número internacional: 11 2345 6789 → 5491123456789.
const waLink = (d) => `https://wa.me/${d.startsWith('54') ? d : d.length === 10 ? '549' + d : d}`;

const fecha = (iso) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function initSorteoAdmin({ api }) {
  const resumen = document.getElementById('sorteo-resumen');
  const tabla = document.getElementById('sorteo-table');
  const ruleta = document.getElementById('sorteo-ruleta');
  const btnSortear = document.getElementById('sorteo-sortear-btn');
  const btnCsv = document.getElementById('sorteo-csv-btn');
  const marcarCampo = document.getElementById('sorteo-marcar-campo');
  const marcarTexto = document.getElementById('sorteo-marcar-texto');
  const marcarBtn = document.getElementById('sorteo-marcar-btn');
  const marcarStatus = document.getElementById('sorteo-marcar-status');

  let datos = { participantes: [], sorteo: null };

  async function cargar() {
    try {
      datos = await api('/sorteo');
    } catch (err) {
      tabla.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
      return;
    }
    render();
  }

  function render() {
    const { participantes: ps, sorteo, abierto } = datos;
    const activos = ps.filter((p) => !p.descalificado);
    const boletos = activos.reduce((n, p) => n + p.chances, 0);
    const ganadores = ps.filter((p) => p.ganador_en);
    resumen.innerHTML = `
      <b>${ps.length}</b> anotados · <b>${boletos}</b> boletos ·
      ${ps.filter((p) => p.historia).length} con historia (x2) ·
      ${abierto ? `abierto hasta el ${esc(sorteo.cierreTexto)}` : '<b>cerrado</b> — listo para sortear'}
      <br>🏆 Ganadores ${ganadores.length}/${sorteo.ganadores}${ganadores.length ? ': ' + ganadores.map((g) => `<b>@${esc(g.instagram)}</b>`).join(', ') : ''}`;
    btnSortear.innerHTML = `<span class="add-icon">🎲</span> Sortear ${Math.min(ganadores.length + 1, sorteo.ganadores)}º ganador`;

    if (!ps.length) {
      tabla.innerHTML = '<p class="admin-empty">Todavía no se anotó nadie.</p>';
      return;
    }
    const filas = ps.map((p) => {
      const contacto =
        p.contacto_tipo === 'whatsapp'
          ? `<a href="${esc(waLink(p.contacto))}" target="_blank" rel="noopener">${esc(p.contacto)}</a>`
          : `<a href="mailto:${esc(p.contacto)}">${esc(p.contacto)}</a>`;
      const sigue = p.sigue === true ? '✔ sí' : p.sigue === false ? '✖ no' : '¿?';
      const estado = p.ganador_en ? '🏆 Ganador' : p.descalificado ? 'Descalificado' : '';
      return `<tr data-id="${p.id}"${p.descalificado ? ' style="opacity:.45"' : ''}>
        <td><a href="https://instagram.com/${esc(p.instagram)}" target="_blank" rel="noopener">@${esc(p.instagram)}</a></td>
        <td>${contacto}</td>
        <td><button type="button" class="row-btn" data-ciclo-sigue>${sigue}</button></td>
        <td><input type="checkbox" data-campo="historia"${p.historia ? ' checked' : ''}></td>
        <td><b>${p.chances}</b></td>
        <td>${estado}</td>
        <td><small>${fecha(p.creado_en)}</small></td>
        <td><button type="button" class="row-btn${p.descalificado ? '' : ' danger'}" data-descalificar>${p.descalificado ? 'Rehabilitar' : 'Descalificar'}</button></td>
      </tr>`;
    });
    tabla.innerHTML = `<table><thead><tr>
      <th>Instagram</th><th>Contacto</th><th>Sigue</th><th>Historia (x2)</th><th>Chances</th><th></th><th>Anotado</th><th></th>
    </tr></thead><tbody>${filas.join('')}</tbody></table>`;
  }

  async function patch(id, cambios) {
    try {
      await api(`/sorteo/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
    } catch (err) {
      alert(err.message);
    }
    await cargar();
  }

  tabla.addEventListener('change', (e) => {
    const campo = e.target.dataset?.campo;
    if (!campo) return;
    patch(e.target.closest('tr').dataset.id, { [campo]: e.target.checked });
  });
  tabla.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const p = datos.participantes.find((x) => String(x.id) === tr.dataset.id);
    if (e.target.matches('[data-ciclo-sigue]')) {
      // ¿? → sí → no → ¿?
      patch(p.id, { sigue: p.sigue === null ? true : p.sigue === true ? false : null });
    } else if (e.target.matches('[data-descalificar]')) {
      if (!p.descalificado && !confirm(`¿Descalificar a @${p.instagram}?`)) return;
      patch(p.id, { descalificado: !p.descalificado });
    }
  });

  marcarBtn.addEventListener('click', async () => {
    marcarStatus.className = 'modal-status';
    marcarStatus.textContent = 'Marcando…';
    try {
      const r = await api('/sorteo/marcar', {
        method: 'POST',
        body: JSON.stringify({ campo: marcarCampo.value, texto: marcarTexto.value }),
      });
      marcarStatus.className = 'modal-status is-success';
      marcarStatus.textContent =
        `Marcados: ${r.marcados.length ? r.marcados.map((h) => '@' + h).join(', ') : 'ninguno'}.` +
        (r.noAnotados.length ? ` No están anotados: ${r.noAnotados.map((h) => '@' + h).join(', ')}.` : '');
      marcarTexto.value = '';
      await cargar();
    } catch (err) {
      marcarStatus.className = 'modal-status is-error';
      marcarStatus.textContent = err.message;
    }
  });

  btnCsv.addEventListener('click', () => {
    const cols = ['instagram', 'contacto', 'sigue', 'historia', 'chances', 'descalificado', 'ganador_en', 'creado_en'];
    const csv = [cols.join(',')]
      .concat(datos.participantes.map((p) => cols.map((c) => `"${String(p[c] ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `sorteo-${datos.sorteo?.slug || 'participantes'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });

  // Ruleta: va pasando @ cada vez más lento y frena en el ganador que ya
  // eligió el server (el azar lo decide el backend, esto es solo el show).
  async function animar(ganador) {
    const pool = datos.participantes.filter((p) => !p.descalificado && !p.ganador_en).map((p) => p.instagram);
    const nombre = ruleta.querySelector('.sorteo-ruleta-nombre');
    let delay = 40;
    while (delay < 320) {
      nombre.textContent = '@' + pool[Math.floor(Math.random() * pool.length)];
      await new Promise((r) => setTimeout(r, delay));
      delay *= 1.08;
    }
    nombre.textContent = '@' + ganador.instagram;
  }

  btnSortear.addEventListener('click', async () => {
    const yaGanaron = datos.participantes.filter((p) => p.ganador_en).length;
    if (datos.sorteo && yaGanaron >= datos.sorteo.ganadores &&
        !confirm(`Ya hay ${yaGanaron} ganadores. ¿Sortear uno más (suplente)?`)) return;
    if (datos.abierto && !confirm('El sorteo todavía está abierto (se puede seguir anotando gente). ¿Sortear igual?')) return;
    btnSortear.disabled = true;
    ruleta.hidden = false;
    ruleta.innerHTML = '<div class="sorteo-ruleta-nombre">…</div><div class="sorteo-ruleta-info"></div>';
    try {
      const r = await api('/sorteo/sortear', { method: 'POST' });
      await animar(r.ganador);
      const g = r.ganador;
      ruleta.querySelector('.sorteo-ruleta-info').innerHTML = `
        🏆 Ganó entre ${r.participantes} participantes (${r.boletos} boletos) · tenía ${g.chances} chance${g.chances > 1 ? 's' : ''}<br>
        <a href="https://instagram.com/${esc(g.instagram)}" target="_blank" rel="noopener">Abrir su perfil</a> y verificá que siga la cuenta:
        <div class="sorteo-ruleta-acciones">
          <button type="button" class="btn-primary" data-ok>✔ Sigue — confirmar ganador</button>
          <button type="button" class="btn-ghost" data-no>✖ No sigue — descalificar y volver a sortear</button>
        </div>`;
      ruleta.querySelector('[data-ok]').addEventListener('click', async () => {
        await patch(g.id, { sigue: true });
        ruleta.querySelector('.sorteo-ruleta-acciones').innerHTML =
          `Confirmado. Avisale por DM a @${esc(g.instagram)} y a su contacto (${esc(g.contacto)}).`;
      });
      ruleta.querySelector('[data-no]').addEventListener('click', async () => {
        await patch(g.id, { sigue: false, descalificado: true });
        btnSortear.click();
      });
    } catch (err) {
      ruleta.innerHTML = `<p class="admin-empty">${esc(err.message)}</p>`;
    } finally {
      btnSortear.disabled = false;
      await cargar();
    }
  });

  return cargar;
}
