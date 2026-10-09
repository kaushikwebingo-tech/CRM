import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { NotFoundError, ValidationError } from '../common/errors';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 15 * 1024 * 1024);


const ALLOWED_MIME = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/zip', '.zip'],
]);

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;

@Controller('files')
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new ValidationError('No file provided', [{ field: 'file', message: 'No file provided' }]);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
        [{ field: 'file', message: 'File is too large' }],
      );
    }

    const extension = ALLOWED_MIME.get(file.mimetype);
    if (!extension) {
      throw new ValidationError(`Files of type "${file.mimetype}" are not allowed`, [
        { field: 'file', message: `"${file.mimetype}" is not an allowed file type` },
      ]);
    }

   const key = `${crypto.randomUUID()}${extension}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, key), file.buffer);

    return {
      key,
      name: path.basename(file.originalname).slice(0, 255),
      size: file.size,
      mime: file.mimetype,
      url: `/api/files/${key}`,
    };
  }

  @Get(':key')
  async getFile(@Param('key') key: string, @Res() res: Response) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new NotFoundError('File not found');
    }

    const safeKey = path.basename(key);
    const filePath = path.join(UPLOAD_DIR, safeKey);
    if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
      throw new NotFoundError('File not found');
    }
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError('File not found');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeKey}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(filePath);
  }
}
