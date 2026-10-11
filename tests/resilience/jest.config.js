/** Tests de résilience : provoquent de vraies pannes (broker arrêté, service tué) sur la plateforme de développement. */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['**/*.e2e.spec.js'],
  testTimeout: 300000,
  globalSetup: '<rootDir>/../integration/global-setup.js',
};
