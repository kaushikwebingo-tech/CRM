import { Controller, Get, Res, Req } from '@nestjs/common';
import { SchemaCompiler } from './schema-compiler';
import { CurrentOrg } from '../common/decorators';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

@Controller('schema')
export class SchemaController {
  constructor(private readonly compiler: SchemaCompiler) {}

  @Get()
  async getBundle(@CurrentOrg() orgId: string, @Req() req: Request, @Res() res: Response) {
    const bundle = await this.compiler.getBundle(orgId);
    
    const hash = crypto.createHash('md5').update(JSON.stringify(bundle)).digest('hex');
    const etag = `"${hash}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).send();
    }

    return res.setHeader('ETag', etag).json(bundle);
  }
}
