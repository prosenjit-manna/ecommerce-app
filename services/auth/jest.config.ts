import type { Config } from 'jest';

// SWC strips types (TypeScript 7 has no JS API for ts-jest); `yarn typecheck` does the type checking.
const swc: [string, Record<string, unknown>] = [
  '@swc/jest',
  {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2023' },
    module: { type: 'es6' }, // keep ESM: the service is "type": "module"
  },
];

const shared = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\\.ts$': swc },
  // Source imports use NodeNext-style ".js" specifiers that point at ".ts" files.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/test/setup.ts'],
  clearMocks: true,
} satisfies Config;

const config: Config = {
  // Tests live next to the code they test: src/lib/crypto.ts → src/lib/crypto.test.ts.
  // Integration tests (real Postgres/Redis via Testcontainers) use *.integration.test.ts.
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
    },
    { ...shared, displayName: 'integration', testMatch: ['<rootDir>/src/**/*.integration.test.ts'] },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    // Wiring and generated code: exercised by the integration and e2e runs, not unit tests.
    '!src/index.ts',
    '!src/app.ts',
    '!src/graphql/generated.ts',
    '!src/db/**',
    '!src/redis.ts',
    // Repositories are thin Drizzle queries: covered by integration tests against real Postgres.
    '!src/**/*.repository.ts',
  ],
  coverageThreshold: {
    global: { statements: 70, branches: 70, functions: 70, lines: 70 },
  },
};

export default config;
