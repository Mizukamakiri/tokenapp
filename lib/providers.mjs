export const PROVIDERS = Object.freeze(['codex', 'claude']);
export const providerLabel = provider => ({ codex: 'ChatGPT', claude: 'Claude', all: 'All' })[provider] || provider;

export function selectedProviders(view = 'codex') {
  if (view === 'all') return [...PROVIDERS];
  if (PROVIDERS.includes(view)) return [view];
  throw new Error('Choose All, Claude or ChatGPT.');
}

export function importStatus(importers, view = 'codex', scanRunning = false) {
  const providers = selectedProviders(view).map(provider => ({ provider, ...importers[provider].status }));
  if (view !== 'all') return providers[0];
  const sum = field => providers.reduce((total, status) => total + (status[field] || 0), 0);
  return {
    provider: 'all', providers, running: scanRunning || providers.some(status => status.running),
    initialized: providers.every(status => status.initialized),
    files: sum('files'), compressedFiles: sum('compressedFiles'), processed: sum('processed'), bytes: sum('bytes'),
    lastScan: providers.every(status => status.lastScan) ? providers.map(status => status.lastScan).sort()[0] : null,
    errors: providers.flatMap(status => status.errors.map(error => providerLabel(status.provider) + ': ' + error)),
    revision: JSON.stringify(providers.map(status => [status.provider, status.lastScan, status.running, status.initialized, Math.floor(status.processed / 20)]))
  };
}
