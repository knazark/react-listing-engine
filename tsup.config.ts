import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'styled/index': 'src/styled/index.ts',
    'maps/google/index': 'src/maps/google/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  tsconfig: 'tsconfig.build.json',
  format: ['esm', 'cjs'],
  dts: { resolve: true },
  sourcemap: false,
  minify: true,
  clean: true,
  splitting: true,
  treeshake: false, // preserve 'use client' banner (same reason as wizard)
  external: ['react', 'react-dom', '@googlemaps/js-api-loader', '@googlemaps/markerclusterer', '@radix-ui/react-slot'],
  esbuildOptions(options) {
    options.banner = { js: '"use client";' };
    options.alias = { '~': fileURLToPath(new URL('./src', import.meta.url)) };
  },
  // tsup doesn't bundle/copy CSS -- the `/styled` adapter ships a plain,
  // hand-authored stylesheet (src/styled/styles.css) verbatim as
  // dist/styles.css (see the "./styles.css" package.json export). Copying
  // it here (rather than a separate package.json build step) keeps `tsup`
  // the single build entry point.
  onSuccess: async () => {
    const dest = fileURLToPath(new URL('./dist', import.meta.url));
    mkdirSync(dest, { recursive: true });
    copyFileSync(
      fileURLToPath(new URL('./src/styled/styles.css', import.meta.url)),
      fileURLToPath(new URL('./dist/styles.css', import.meta.url)),
    );
  },
});
