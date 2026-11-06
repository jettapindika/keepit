const fileBytesMap = new Map<string, Uint8Array>();

export const Paths = {
  cache: 'file:///tmp/keepit-cache',
  document: 'file:///tmp/keepit-doc',
};

export class File {
  readonly uri: string;

  constructor(...parts: string[]) {
    this.uri = parts.join('/').replace(/([^:]\/)\/+/g, '$1');
  }

  async write(content: string | Uint8Array): Promise<void> {
    if (typeof content === 'string') {
      fileBytesMap.set(this.uri, new TextEncoder().encode(content));
    } else {
      fileBytesMap.set(this.uri, content);
    }
  }

  async base64(): Promise<string> {
    const bytes = fileBytesMap.get(this.uri);
    if (!bytes) return '';
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async canPreview(): Promise<boolean> {
    return fileBytesMap.has(this.uri);
  }

  async preview(): Promise<void> {}
}
