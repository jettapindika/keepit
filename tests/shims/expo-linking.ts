export function createURL(
  path = '',
  options?: { scheme?: string; queryParams?: Record<string, string | undefined> }
): string {
  const scheme = options?.scheme ?? 'keepit';
  const normalizedPath = path.replace(/^\/+/, '');
  const base = `${scheme}://${normalizedPath}`;
  if (!options?.queryParams) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options.queryParams)) {
    if (v !== undefined) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function getInitialURL(): Promise<string | null> {
  return null;
}

export function addEventListener(
  _type: 'url',
  _handler: (event: { url: string }) => void
): { remove: () => void } {
  return { remove: () => {} };
}

export async function openURL(_url: string): Promise<boolean> {
  return true;
}
