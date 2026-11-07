// tests/loader.mjs
// Node.js ESM module resolution hook for running KeepIt TypeScript source modules directly in `node --test`:
// - Resolves `@/*` path aliases to `../src/*`
// - Resolves extensionless TypeScript relative/aliased imports (`.ts` / `.tsx` / `/index.ts`)
// - Supplies deterministic in-memory shims for React Native / Expo native host modules (`AsyncStorage`, `react-native`, `expo-file-system`, `expo-clipboard`, `expo-modules-core`)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIMS_DIR = path.resolve(ROOT_DIR, 'tests', 'shims');

const SHIM_MAP = new Map([
  ['@react-native-async-storage/async-storage', path.join(SHIMS_DIR, 'async-storage.ts')],
  ['react-native', path.join(SHIMS_DIR, 'react-native.ts')],
  ['expo-file-system', path.join(SHIMS_DIR, 'expo-file-system.ts')],
  ['expo-clipboard', path.join(SHIMS_DIR, 'expo-clipboard.ts')],
  ['expo-modules-core', path.join(SHIMS_DIR, 'expo-modules-core.ts')],
  ['react-native-reanimated', path.join(SHIMS_DIR, 'reanimated.ts')],
  ['react-native-url-polyfill/auto', path.join(SHIMS_DIR, 'empty.ts')],
  ['expo-linking', path.join(SHIMS_DIR, 'expo-linking.ts')],
]);

function tryResolveTsFile(candidateBase) {
  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}.js`,
    path.join(candidateBase, 'index.ts'),
    path.join(candidateBase, 'index.tsx'),
    path.join(candidateBase, 'index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return pathToFileURL(c).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (SHIM_MAP.has(specifier)) {
    return {
      url: pathToFileURL(SHIM_MAP.get(specifier)).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('@/')) {
    const subPath = specifier.slice(2);
    const resolved = tryResolveTsFile(path.join(ROOT_DIR, 'src', subPath));
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : ROOT_DIR;
    const baseDir = path.dirname(parentPath);
    const resolved = tryResolveTsFile(path.resolve(baseDir, specifier));
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const rawSource = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(rawSource, {
      fileName: filePath,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    return {
      format: 'module',
      source: transpiled.outputText,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
