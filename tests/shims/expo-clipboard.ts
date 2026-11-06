let clipboardText = '';

export async function setStringAsync(text: string): Promise<boolean> {
  clipboardText = text;
  return true;
}

export async function getStringAsync(): Promise<string> {
  return clipboardText;
}
