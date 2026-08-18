// @ts-check
import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  Notification: 'readonly',
  indexedDB: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  addEventListener: 'readonly',
  location: 'readonly',
  caches: 'readonly',
  self: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  XLSX: 'readonly',
  DriverOffline: 'readonly',
  OfflineQueue: 'readonly',
  Busboy: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  require: 'readonly',
  module: 'readonly',
  exports: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'middle-kit/**', 'data/**', '.publish-ProverkaSklad/**', '*.min.js'] },
  js.configs.recommended,
  {
    files: ['public/**/*.js', 'receiving-test/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browserGlobals },
  },
  {
    files: ['server.js', 'src/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: nodeGlobals },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
  },
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    rules: { 'no-console': 'off', 'max-lines-per-function': 'off' },
  },
];
