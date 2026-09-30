// Link "Entrar" del nav: si ya hay sesión del panel en esta pestaña, dice
// "Mi panel". Misma clave que usa mi-panel.js para guardar el token.
const TOKEN_KEY = 'tap_panel_token';

let conSesion = false;
try {
  conSesion = Boolean(sessionStorage.getItem(TOKEN_KEY));
} catch {
  // sessionStorage bloqueado: queda "Entrar".
}

if (conSesion) {
  document.querySelectorAll('nav a.nav-link[href="/mi-panel.html"]').forEach((a) => {
    a.textContent = 'Mi panel';
  });
}
