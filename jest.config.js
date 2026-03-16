module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/web-dashboard/'],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/skills/**',
        '!src/bridges/TelegramHealthWatchdog.js',
    ],
    // Prevent Puppeteer/grammY from initializing during tests
    setupFiles: ['./tests/setup.js'],
    // Global afterAll cleanup for DebouncedWriter handles
    setupFilesAfterEnv: ['./tests/setup-afterall.js'],
    testTimeout: 15000,
    collectCoverage: false,
};
