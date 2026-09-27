// A stand-in for idb-keyval: one key-value store per simulated device, chosen
// by whichever device the current async call chain is running as (see
// asDevice in firebase.mjs). Lets several "devices" run the real sync engine
// side by side in one Node process, each with its own sync metadata.
import { AsyncLocalStorage } from 'node:async_hooks';

export const deviceContext = globalThis.__deviceContext ??= new AsyncLocalStorage();
const stores = globalThis.__deviceStores ??= new Map();

const mine = () => {
  const d = deviceContext.getStore()?.device ?? 'default';
  if (!stores.has(d)) stores.set(d, new Map());
  return stores.get(d);
};

export const get = async (k) => structuredClone(mine().get(k));
export const set = async (k, v) => { mine().set(k, structuredClone(v)); };
export const del = async (k) => { mine().delete(k); };
export const resetDevices = () => stores.clear();
