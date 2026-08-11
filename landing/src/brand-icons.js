// Íconos de marca (SVG inline, simplificados) para las funciones del wizard de
// compra — WhatsApp, Instagram, Mercado Pago y Google Calendar son referencias
// estilizadas a cada marca (colores + forma reconocible), no el asset oficial
// pixel-perfect. El resto usa la paleta propia de AltoqueTap.

export const BRAND_ICONS = {
  whatsapp: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="#25D366"/>
    <path d="M16.02 7c-4.98 0-9.02 4.04-9.02 9.02 0 1.59.42 3.14 1.21 4.5L7 25l4.6-1.2a9 9 0 0 0 4.42 1.13h.01c4.98 0 9.02-4.04 9.02-9.02S21 7 16.02 7Zm5.3 12.77c-.22.63-1.28 1.2-1.77 1.27-.45.06-1.02.09-1.65-.1a15.4 15.4 0 0 1-1.5-.55 12.3 12.3 0 0 1-4.7-4.15c-.35-.47-1.17-1.56-1.17-2.98s.75-2.12 1.02-2.41c.27-.29.6-.36.8-.36l.57.01c.18.01.43-.07.67.51.24.58.82 2 .89 2.15.07.15.12.32.02.51-.1.19-.15.32-.29.49-.15.18-.31.4-.44.53-.15.15-.3.31-.13.6.17.29.75 1.24 1.61 2 1.1.98 2.03 1.29 2.32 1.44.29.15.46.13.63-.06.17-.19.72-.84.91-1.13.19-.29.38-.24.63-.14.26.09 1.63.77 1.91.91.28.14.47.21.53.33.07.13.07.72-.15 1.35Z" fill="#fff"/>
  </svg>`,

  instagram: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="ig-grad" x1="0" y1="32" x2="32" y2="0">
      <stop offset="0" stop-color="#FFDD55"/><stop offset=".5" stop-color="#E1306C"/><stop offset="1" stop-color="#5851DB"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="8" fill="url(#ig-grad)"/>
    <rect x="9" y="9" width="14" height="14" rx="4" stroke="#fff" stroke-width="1.7"/>
    <circle cx="16" cy="16" r="3.6" stroke="#fff" stroke-width="1.7"/>
    <circle cx="21" cy="11" r="1" fill="#fff"/>
  </svg>`,

  mercadopago: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="#00B1EA"/>
    <path d="M8 13a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3v-6Z" fill="#fff"/>
    <rect x="8" y="12.5" width="16" height="2.2" fill="#00B1EA"/>
    <circle cx="20.5" cy="18" r="1.6" fill="#00B1EA"/>
  </svg>`,

  googleCalendar: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="8" width="22" height="19" rx="3" fill="#fff" stroke="#DADCE0"/>
    <rect x="5" y="8" width="22" height="6" rx="3" fill="#4285F4"/>
    <rect x="9" y="5" width="2.4" height="6" rx="1.2" fill="#4285F4"/>
    <rect x="20.6" y="5" width="2.4" height="6" rx="1.2" fill="#4285F4"/>
    <text x="16" y="23.5" text-anchor="middle" font-size="10" font-family="Arial, sans-serif" fill="#4285F4" font-weight="700">31</text>
  </svg>`,

  google: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="#fff" stroke="#E5E7EB"/>
    <path d="M23.6 16.23c0-.68-.06-1.33-.17-1.96H16v3.71h4.26a3.64 3.64 0 0 1-1.58 2.39v1.98h2.55c1.5-1.38 2.37-3.42 2.37-5.87 0-.08 0-.17-.01-.25Z" fill="#4285F4"/>
    <path d="M16 24c2.16 0 3.97-.72 5.3-1.94l-2.55-1.98c-.71.48-1.62.76-2.75.76-2.11 0-3.9-1.43-4.54-3.34H8.83v2.05A8 8 0 0 0 16 24Z" fill="#34A853"/>
    <path d="M11.46 17.5a4.8 4.8 0 0 1 0-3.02v-2.05H8.83a8 8 0 0 0 0 7.12l2.63-2.05Z" fill="#FBBC05"/>
    <path d="M16 10.14c1.18 0 2.23.4 3.06 1.2l2.3-2.3A7.96 7.96 0 0 0 16 7a8 8 0 0 0-7.17 4.43l2.63 2.05C12.1 11.57 13.89 10.14 16 10.14Z" fill="#EA4335"/>
  </svg>`,

  googleMaps: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="#fff" stroke="#E5E7EB"/>
    <path d="M16 6c-3.6 0-6.5 2.86-6.5 6.4 0 4.8 6.5 12.6 6.5 12.6s6.5-7.8 6.5-12.6C22.5 8.86 19.6 6 16 6Z" fill="#EA4335"/>
    <circle cx="16" cy="12.5" r="2.6" fill="#fff"/>
  </svg>`,

  linktree: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="#1b1f23"/>
    <path d="M16 8v16M16 12l-5-3M16 12l5-3M16 17l-5-3M16 17l5-3" stroke="#43E55E" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="23" r="1.6" fill="#43E55E"/>
  </svg>`,

  web: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="rgba(123,92,255,0.15)"/>
    <circle cx="16" cy="16" r="8" stroke="#7B5CFF" stroke-width="1.6"/>
    <path d="M8 16h16" stroke="#7B5CFF" stroke-width="1.6"/>
    <path d="M16 8c2.5 2.3 2.5 13.7 0 16M16 8c-2.5 2.3-2.5 13.7 0 16" stroke="#7B5CFF" stroke-width="1.6"/>
  </svg>`,

  menu: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="rgba(242,184,75,0.15)"/>
    <path d="M11 8v7a2 2 0 0 0 2 2v9M9 8v5M13 8v5" stroke="#F2B84B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M21 8c-1.7 0-3 2-3 5s1.3 5 3 5v6" stroke="#F2B84B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};
