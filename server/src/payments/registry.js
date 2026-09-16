import { telebirrProvider } from './telebirr.js';
import { chapaProvider } from './chapa.js';

/** Payment rails players can deposit from and cash out to, in display order. */
export const METHODS = [
  { id: 'telebirr', label: 'Telebirr', description: 'Ethio Telecom mobile money', methodHint: 'Telebirr' },
  { id: 'cbebirr', label: 'CBE Birr', description: 'Commercial Bank of Ethiopia', methodHint: 'CBE Birr' },
  { id: 'boa', label: 'Bank of Abyssinia', description: 'BoA account / card', methodHint: 'Bank of Abyssinia' },
];

/**
 * Online checkout providers, keyed by method id. Telebirr uses the direct Web API when
 * its credentials are set, otherwise Chapa; CBE Birr and BoA go through Chapa. A method
 * with no gateway credentials is simply absent: players can still deposit to the house
 * accounts by transfer + receipt id (see routes/payments.js), which needs no gateway.
 */
export function buildProviders(config, deps) {
  const providers = new Map();
  const telebirr = telebirrProvider(config.telebirr, deps);
  for (const m of METHODS) {
    const viaChapa = chapaProvider(m, config.chapa, deps);
    const direct = m.id === 'telebirr' && telebirr.available ? telebirr : null;
    const provider = direct ?? (viaChapa.available ? viaChapa : null);
    if (provider) providers.set(m.id, provider);
  }
  return providers;
}

export function describeProviders(providers) {
  return [...providers.values()].map((p) => ({ id: p.id, label: p.label, description: p.description }));
}
