import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Build de los paneles internos (admin y vendedor). No va en dist/ (hosting
// público): sale en server/privado/<rol>/ y lo entrega server/privado.js solo
// con sesión. Un build por rol para que cada uno tenga su propio JS.
//   PRIVADO=admin|vendedor vite build -c vite.privado.config.js   (ver npm run build:privado)

const root = fileURLToPath(new URL('.', import.meta.url));
const rol = process.env.PRIVADO;
if (!['admin', 'vendedor'].includes(rol)) throw new Error('Falta PRIVADO=admin|vendedor');

const stripHtmlComments = {
  name: 'strip-html-comments',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->/g, ''),
};

export default defineConfig({
  plugins: [stripHtmlComments],
  esbuild: { legalComments: 'none' },
  publicDir: false,
  base: `/privado/${rol}/`,
  build: {
    outDir: resolve(root, 'server/privado', rol),
    emptyOutDir: true,
    assetsDir: 'a',
    sourcemap: false,
    rollupOptions: { input: { [rol]: resolve(root, `${rol}.html`) } },
  },
});
