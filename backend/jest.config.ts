import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only run integration tests — unit tests use node:test and are excluded.
  testMatch: ['<rootDir>/src/scripts/integration/**/*.test.ts'],
  testTimeout: 30000,
  verbose: true,
  // Run files in the same process to keep Supabase connections clean.
  maxWorkers: 1,
  // Load env vars before any test file.
  globalSetup: '<rootDir>/src/scripts/integration/_helpers/globalSetup.ts',
};

export default config;
