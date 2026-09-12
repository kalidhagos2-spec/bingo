import { telebirrProvider } from './telebirr.js';
import { chapaProvider } from './chapa.js';
import { mockProvider } from './mock.js';

/** Payment methods offered to players, in display order. */
export const METHODS = [
  { id: 'telebirr', label: 'Telebirr', description: 'Ethio Telecom mobile money', methodHint: 'Telebirr' },
  { id: 'cbebirr', label: 'CBE Birr', description: 'Commercial Bank of Ethiopia', methodHint: 'CBE Birr' },
  { id: 'boa', label: 'Bank of Abyssinia', description: 'BoA account / card', methodHint: 'Bank of Abyssinia' },
];

/**
 * Builds the provider map. Telebirr uses the direct Web API when its credentials are
 * set, otherwise Chapa. CBE Birr and BoA go through Chapa. Any method without a real
 * gateway configured falls back to the sandbox provider, unless PAYMENTS_MOCK forces it.
 */
export function buildProviders(config, deps) {
  const providers = new Map();
  const real = {};
  if (!config.forceMock) {
    const telebirr = telebirrProvider(config.telebirr, deps);
    for (const m of METHODS) {
      const viaChapa = chapaProvider(m, config.chapa, deps);
      const direct = m.id === 'telebirr' && telebirr.available ? telebirr : null;
      real[m.id] = direct ?? (viaChapa.available ? viaChapa : null);
    }
  }
  for (const m of METHODS) {
    providers.set(m.id, real[m.id] ?? mockProvider(m, deps));
  }
  return providers;
}

export function describeProviders(providers) {
  return [...providers.values()].map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    sandbox: Boolean(p.sandbox),
  }));
}
