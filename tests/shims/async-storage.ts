const memoryStore = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return memoryStore.has(key) ? (memoryStore.get(key) ?? null) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memoryStore.set(key, String(value));
  },
  async removeItem(key: string): Promise<void> {
    memoryStore.delete(key);
  },
  async clear(): Promise<void> {
    memoryStore.clear();
  },
  __dump(): Record<string, string> {
    return Object.fromEntries(memoryStore.entries());
  },
};

export default AsyncStorage;
