export interface KeysetCursor {
  /** the sort value of the last row on the previous page */
  c: unknown;
  /** the record id of that row, which makes the order total */
  id: string;
  /** the sort key the cursor was minted for; a mismatch is rejected rather than bound */
  k?: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): KeysetCursor | null {
  try {
    if (typeof raw !== 'string' || raw.length > 4096) return null;
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<KeysetCursor>;
    if (typeof candidate.id !== 'string' || !candidate.id) return null;
    if (candidate.k !== undefined && typeof candidate.k !== 'string') return null;
    return { c: candidate.c ?? null, id: candidate.id, k: candidate.k };
  } catch {
    return null;
  }
}
