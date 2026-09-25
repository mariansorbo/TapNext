import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
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
        admin: resolve(root, 'admin.html'),
        vendedor: resolve(root, 'vendedor.html'),
        demo: resolve(root, 'demo.html'),
      },
    },
  },
});
