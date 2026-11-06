export const Platform: { OS: 'ios' | 'android' | 'web' } = {
  OS: 'web',
};

export const Share = {
  lastShared: null as { title?: string; message?: string; url?: string } | null,
  async share(content: { title?: string; message?: string; url?: string }) {
    Share.lastShared = content;
    return { action: 'sharedAction' };
  },
};

export function useColorScheme(): 'light' | 'dark' {
  return 'dark';
}
