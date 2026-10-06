export interface KeysetCursor {
  c: unknown;
  id: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): KeysetCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !parsed.id) {
      return null;
    }
    return parsed as KeysetCursor;
  } catch {
    return null;
  }
}
