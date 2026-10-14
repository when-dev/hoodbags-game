import { defineConfig } from 'vite';

export default defineConfig({
  // WSL + /mnt drives don't emit file events, so poll for changes in dev
  server: { watch: { usePolling: true, interval: 300 } },
  build: { chunkSizeWarningLimit: 1200 },
});
