import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

// Deliberately narrow. This isn't here to have opinions about style — it's
// here to catch the one class of bug that can't be seen in a build and takes
// the whole app down at runtime: a name used but never imported (a missing
// `useEffect` blanked Coaches Corner on two devices), and hooks called
// conditionally. `npm run lint` before a deploy, every time.
export default [
  {
    files: ['**/*.{js,jsx,mjs}'],
    ignores: ['dist/**', 'node_modules/**', 'public/stockfish/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The codebase carries exhaustive-deps disables from before this config
    // existed; that rule is off here, and flagging its comments as unused is
    // noise on top of noise.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      // Without these, every component imported for JSX reads as unused.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-hooks/exhaustive-deps': 'off',
      // Noise, not bugs — these would bury the two rules that matter.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^(React|_)' }],
      'no-empty': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
];
