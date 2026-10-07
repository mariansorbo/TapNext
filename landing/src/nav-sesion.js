// Link "Entrar" del nav: si ya hay sesión del panel, dice "Mi panel". Misma
// clave que usa mi-panel.js para guardar el token (localStorage; el wizard de
// compra todavía la deja en sessionStorage).
const TOKEN_KEY = 'tap_panel_token';

let conSesion = false;
try {
  conSesion = Boolean(localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY));
} catch {
  // storage bloqueado: queda "Entrar".
}

if (conSesion) {
  document.querySelectorAll('nav a.nav-link[href="/mi-panel.html"]').forEach((a) => {
    a.textContent = 'Mi panel';
  });
}
