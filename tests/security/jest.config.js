/** Tests de sécurité contre la plateforme réelle (nécessite docker compose up). */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['**/*.e2e.spec.js'],
  testTimeout: 180000,
  globalSetup: '<rootDir>/../integration/global-setup.js',
};
