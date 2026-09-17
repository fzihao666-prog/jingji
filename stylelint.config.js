export default {
  extends: ['stylelint-config-standard'],

  ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'],

  rules: {
    'no-descending-specificity': null,
  },
};
