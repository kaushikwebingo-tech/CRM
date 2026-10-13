export function stripQuotedHistory(text?: string | null): string {
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const cleanLines: string[] = [];

  const quoteHeaderRegex = /^(on\s.+wrote:|from:\s.+|sent:\s.+|date:\s.+|subject:\s.+|-----original message-----|________________________________)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (quoteHeaderRegex.test(trimmed)) {
      break;
    }

    if (trimmed.startsWith('>')) {
      continue;
    }

    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}
