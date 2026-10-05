import { readdirSync, existsSync } from 'node:fs';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const restricted = (patterns) => [
  'error',
  {
    patterns: [
      {
        group: ['../**'],
        message: 'Use @/* across modules; keep local imports inside this module.',
      },
      ...patterns.map((group) => ({
        group,
        message: 'Respect app → features → entities → shared.',
      })),
    ],
  },
];

const moduleRules = (layer, forbidden) => {
  const root = new URL(`./src/${layer}/`, import.meta.url);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      files: [`src/${layer}/${entry.name}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': restricted([
          ...forbidden,
          [
            `@/${layer}/*`,
            `@/${layer}/**`,
            `!@/${layer}/${entry.name}`,
            `!@/${layer}/${entry.name}/**`,
          ],
        ]),
      },
    }));
};

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'public/mockServiceWorker.js',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': restricted([]),
    },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted([['@/app/**', '@/features/**', '@/entities/**']]),
    },
  },
  ...moduleRules('features', [['@/app/**']]),
  ...moduleRules('entities', [['@/app/**', '@/features/**']]),
]);
