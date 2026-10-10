/** Test d'intégration du flux commande : nécessite la plateforme démarrée (docker compose up). */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['**/*.e2e.spec.js'],
  testTimeout: 180000,
  globalSetup: '<rootDir>/global-setup.js',
};
