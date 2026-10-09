import { Controller, Get, Res, Req } from '@nestjs/common';
import { SchemaCompiler } from './schema-compiler';
import { CurrentOrg, CurrentUser } from '../common/decorators';
import { Request, Response } from 'express';
import { parsePermissions } from '../auth/permissions';

interface SessionUser {
  id: string;
  role?: { id?: string; permissions?: unknown };
}

@Controller('schema')
export class SchemaController {
  constructor(private readonly compiler: SchemaCompiler) {}

  /**
   * One request carrying every module, its fields, its pipelines and stages,
   * and the user's permission map (Plan Section 6, "The schema bundle").
   *
   * The ETag is computed from the module versions and the user's role before
   * the bundle is assembled, so a 304 costs one indexed query rather than a
   * full rebuild — the previous version hashed the finished bundle, which meant
   * paying for it either way.
   */
  @Get()
  async getBundle(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const schemaVersion = await this.compiler.bundleEtagSource(orgId);
    const etag = `"${schemaVersion}.${user?.role?.id ?? 'norole'}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && this.etagMatches(ifNoneMatch, etag)) {
      return res.status(304).end();
    }

    const bundle = await this.compiler.getBundle(orgId, parsePermissions(user?.role?.permissions));
    return res.json(bundle);
  }

  /** Handles weak validators and comma-separated lists, which exact equality missed. */
  private etagMatches(header: string | string[], etag: string): boolean {
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (raw.trim() === '*') return true;
    return raw
      .split(',')
      .map((v) => v.trim().replace(/^W\//, ''))
      .some((v) => v === etag);
  }
}
