import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly title: string,
    public readonly detail: string,
    public readonly fields?: { field: string; message: string }[]
  ) {
    super(detail);
  }
}

export class NotFoundError extends AppError {
  constructor(detail: string) {
    super(HttpStatus.NOT_FOUND, 'not_found', 'Not Found', detail);
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, fields?: { field: string; message: string }[]) {
    super(HttpStatus.BAD_REQUEST, 'validation_error', 'Validation Error', detail, fields);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail: string) {
    super(HttpStatus.FORBIDDEN, 'forbidden', 'Forbidden', detail);
  }
}

export class ConflictError extends AppError {
  constructor(detail: string) {
    super(HttpStatus.CONFLICT, 'conflict', 'Conflict', detail);
  }
}

@Catch(AppError)
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: AppError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    response.status(exception.status).json({
      type: exception.type,
      title: exception.title,
      status: exception.status,
      detail: exception.detail,
      ...(exception.fields && { fields: exception.fields }),
    });
  }
}
