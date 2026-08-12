export default {
    testEnvironment: 'node',
    transform: {},
    injectGlobals: true,
    setupFilesAfterEnv: ['<rootDir>/test/mocks/browser-mocks.js'],
};
