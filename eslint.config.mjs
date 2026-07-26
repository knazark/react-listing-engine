import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `examples/*` are standalone consumer apps (their own package.json,
  // tsconfig, node_modules) -- they dogfood the PUBLIC package API and are
  // linted/typechecked/built independently (`pnpm --dir examples/basic ...`),
  // not as part of this package's own `pnpm lint`/`typecheck`/`test`.
  { ignores: ['dist', 'node_modules', 'coverage', 'examples'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Hooks-heavy React library with hand-curated useEffect/useCallback deps
    // and no other rules-of-hooks / exhaustive-deps enforcement. `warn` (not
    // `error`) for exhaustive-deps so a deliberate, documented omission (e.g.
    // ListingMap's mount effect, useListingEvent's ref pattern) doesn't
    // hard-fail the build -- each such site gets an explicit disable
    // directive with a one-line rationale comment instead.
    files: ['src/react/**/*.{ts,tsx}', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // src/core is pure TS (the engine) and must stay framework-free — not even
    // `import type` from react/react-dom. Enforced structurally by the
    // core-boundary vitest spec too; this catches it at lint/edit time.
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/core must not import react (not even types) — see src/__tests__/core-boundary.spec.ts.' },
            { name: 'react-dom', message: 'src/core must not import react-dom (not even types) — see src/__tests__/core-boundary.spec.ts.' },
          ],
        },
      ],
    },
  }
);
