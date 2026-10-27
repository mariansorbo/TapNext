import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Saca los <!-- comentarios --> del HTML publicado: notas internas que no
// tienen por qué verse con "Ver código fuente". Solo en el build.
const stripHtmlComments = {
  name: 'strip-html-comments',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->/g, ''),
};

export default defineConfig({
  plugins: [stripHtmlComments],
  // Sin comentarios de licencia ni /*! ... */ en el JS minificado.
  esbuild: { legalComments: 'none' },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      // Mismo mapeo que los rewrites de vercel.json (tracking con cookie propia).
      // Regex (no '/t' a secas: eso también agarraría /terminos.html).
      '^/t/(visita|evento)$': {
        target: 'http://localhost:3001',
        rewrite: (p) => p.replace(/^\/t\/visita$/, '/api/visitas').replace(/^\/t\/evento$/, '/api/eventos'),
      },
    },
  },
  build: {
    outDir: 'dist',
    // Explícito: nunca publicar source maps (dejarían ver el código original).
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        comprar: resolve(root, 'comprar.html'),
        pedido: resolve(root, 'pedido.html'),
        pedidoFullCatalogo: resolve(root, 'pedidoFullCatalogo.html'),
        miPanel: resolve(root, 'mi-panel.html'),
        activacion: resolve(root, 'activacion.html'),
        faqs: resolve(root, 'faqs.html'),
        quienesSomos: resolve(root, 'quienes-somos.html'),
        empresas: resolve(root, 'empresas.html'),
        indexEmpresas: resolve(root, 'index-empresas.html'),
        admin: resolve(root, 'admin.html'),
        vendedor: resolve(root, 'vendedor.html'),
        demo: resolve(root, 'demo.html'),
        demoMarca: resolve(root, 'demo-marca.html'),
        demoEscena2Empresas: resolve(root, 'Demo Escena 2 Empresas.html'),
        sorteo: resolve(root, 'sorteo.html'),
        terminos: resolve(root, 'terminos.html'),
        privacidad: resolve(root, 'privacidad.html'),
        pruebaRedireccionamiento: resolve(root, 'prueba-redireccionamiento-custom.html'),
      },
    },
  },
});
