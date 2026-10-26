// The UI imports 'three' and 'three/addons/...' through an import map; tests map them to the vendored copy.
// Import this module first, then the UI modules with a dynamic import().
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const vendor = pathToFileURL(new URL('../ui/vendor/three/', import.meta.url).pathname).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: ${JSON.stringify(`${vendor}three.module.js`)}, shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(`${vendor}addons/`)} + s.slice(13), shortCircuit: true };
  return next(s, c);
}`)}`);
