export function parseCsv(input: string): string[][] {
  const text = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : '';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  let i = 0;

  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0].trim() === ''));
}


const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function escapeCsvCell(cell: unknown): string {
  const str = cell === null || cell === undefined ? '' : String(cell);
  const guarded = FORMULA_PREFIXES.some((p) => str.startsWith(p)) ? `\t${str}` : str;
  if (
    guarded.includes(',') ||
    guarded.includes('"') ||
    guarded.includes('\n') ||
    guarded.includes('\r') ||
    guarded.startsWith('\t')
  ) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function stringifyCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}
