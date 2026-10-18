import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/**', '.output-e2e/**', '.wxt/**', 'node_modules/**', 'eslint.config.js', 'scripts/**'] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
);
