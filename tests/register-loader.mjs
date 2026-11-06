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
