export class SearchCompiler {
  static compile(q: string, startParamIndex: number): { sql: string; params: unknown[] } {
    const trimmed = q.trim();
    if (!trimmed) {
      return { sql: '1=1', params: [] };
    }

    if (trimmed.length < 3) {
      const param = `$${startParamIndex}`;
      return {
        sql: `r.display_name ILIKE ${param}`,
        params: [`${trimmed}%`],
      };
    }

    const param = `$${startParamIndex}`;
    return {
      sql: `(r.display_name ILIKE ${param} OR r.search_tsv ILIKE ${param})`,
      params: [`%${trimmed}%`],
    };
  }
}
