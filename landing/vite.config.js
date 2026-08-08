import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        comprar: resolve(root, 'comprar.html'),
        pedido: resolve(root, 'pedido.html'),
        miPanel: resolve(root, 'mi-panel.html'),
        faqs: resolve(root, 'faqs.html'),
      },
    },
  },
});
