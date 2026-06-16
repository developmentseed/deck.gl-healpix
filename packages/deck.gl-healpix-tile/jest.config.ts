import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.jest.json'
      }
    ]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@deck\\.gl/geo-layers$': '<rootDir>/src/__mocks__/deck-geo-layers.ts',
    '^@deck\\.gl/layers$': '<rootDir>/src/__mocks__/deck-layers.ts',
    '^@developmentseed/deck\\.gl-healpix$': '<rootDir>/src/__mocks__/healpix-layer.ts'
  }
};

export default config;
