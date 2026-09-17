import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApi, serveGenerated } from './server/message-api.mjs';

export default defineConfig({
  build: { minify: false },
  plugins: [react(), {
    name: 'messageme-local-api',
    configureServer(server) {
      server.middlewares.use('/generated', serveGenerated);
      server.middlewares.use('/api/send-mms', handleApi);
    }
  }]
});
