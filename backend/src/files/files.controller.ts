import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

@Controller('files')
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const safeExt = path.extname(file.originalname);
    const key = `${crypto.randomUUID()}${safeExt}`;
    const targetPath = path.join(UPLOAD_DIR, key);
    fs.writeFileSync(targetPath, file.buffer);

    return {
      key,
      name: file.originalname,
      size: file.size,
      mime: file.mimetype,
      url: `/api/files/${key}`,
    };
  }

  @Get(':key')
  async getFile(@Param('key') key: string, @Res() res: Response) {
    const safeKey = path.basename(key);
    const filePath = path.join(UPLOAD_DIR, safeKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }
    res.sendFile(filePath);
  }
}
