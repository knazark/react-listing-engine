import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Consumes `react-listing-engine` as an ordinary installed package (see
// package.json's `"react-listing-engine": "file:../.."`, symlinked by pnpm
// into this app's own node_modules) -- no path aliasing back into the
// library's `src/` is needed or wanted here. This file stays a plain Vite +
// React + Tailwind v4 config, same as any other consumer of the package.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
