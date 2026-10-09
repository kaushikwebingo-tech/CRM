import postgres from 'postgres';
import { RecordScope } from './permissions';


export interface ScopeFragment {
  sql: string;
  params: unknown[];
}


export function compileScope(
  scope: RecordScope,
  userId: string,
  startParamIndex: number,
): ScopeFragment {
  switch (scope) {
    case 'all':
      return { sql: '1=1', params: [] };

    case 'own':
      return { sql: `r.owner_id = $${startParamIndex}`, params: [userId] };

    case 'team':
      return {
        sql: `(
          r.owner_id = $${startParamIndex}
          OR r.owner_id IN (
            SELECT tm.user_id
            FROM team_members tm
            WHERE tm.team_id IN (
              SELECT inner_tm.team_id FROM team_members inner_tm WHERE inner_tm.user_id = $${startParamIndex}
            )
          )
        )`,
        params: [userId],
      };

    case 'none':
    default:
      return { sql: '1=0', params: [] };
  }
}

export function scopeFragment(
  sql: postgres.Sql,
  scope: RecordScope,
  userId: string,
): postgres.PendingQuery<postgres.Row[]> | postgres.Fragment {
  switch (scope) {
    case 'all':
      return sql`TRUE`;
    case 'own':
      return sql`r.owner_id = ${userId}`;
    case 'team':
      return sql`(
        r.owner_id = ${userId}
        OR r.owner_id IN (
          SELECT tm.user_id FROM team_members tm
          WHERE tm.team_id IN (
            SELECT t2.team_id FROM team_members t2 WHERE t2.user_id = ${userId}
          )
        )
      )`;
    case 'none':
    default:
      return sql`FALSE`;
  }
}

export function scopeAllowsRecord(
  scope: RecordScope,
  userId: string,
  record: { owner_id?: string | null },
  teammateIds: Set<string>,
): boolean {
  switch (scope) {
    case 'all':
      return true;
    case 'own':
      return record.owner_id === userId;
    case 'team':
      return record.owner_id === userId || (!!record.owner_id && teammateIds.has(record.owner_id));
    case 'none':
    default:
      return false;
  }
}
