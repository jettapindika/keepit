// Force offline/local-first mode before ANY test file or src module loads.
// src/api/supabase.ts reads EXPO_PUBLIC_* at module-load time and ESM import
// hoisting means in-file assignments in remediation.test.ts run too late.
if (!process.env.KEEPIT_TEST_ALLOW_SUPABASE) {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'offline';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = '';
}

import { register, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as loaderHooks from './loader.mjs';
if (typeof registerHooks === 'function') {
  // Node 22.15+ / 26+ synchronous/hook registration without DEP0205 warning
  register('./loader.mjs', pathToFileURL(import.meta.filename));
} else {
  void loaderHooks;
  register('./loader.mjs', pathToFileURL(import.meta.filename));
}
