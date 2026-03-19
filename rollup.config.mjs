import { readFileSync } from 'fs';
import path from 'path';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';

const dirname = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(dirname, './package.json')));

const env = process.env.NODE_ENV || 'development';

export default [
  // ESM and CJS
  {
    input: path.join(dirname, './src/index.ts'),
    plugins: [
      peerDepsExternal(),
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify(env),
        'process.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: './dist/types',
        outDir: './dist',
      })
    ],
    output: [
      { file: pkg.main, format: 'cjs', sourcemap: true, exports: 'named' },
      { file: pkg.module, format: 'es', sourcemap: true }
    ]
  },
  // Bundled type declarations
  {
    input: path.join(dirname, 'dist/types/index.d.ts'),
    output: [{ file: path.join(dirname, 'dist/index.d.ts'), format: 'es' }],
    plugins: [dts()]
  }
];
