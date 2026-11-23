import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: [
      'dist/**/*',
      'dev-dist/**/*',
      'node_modules/**/*',
      '.playwright-cli/**/*',
      'android-builder/**/*',
    ],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
