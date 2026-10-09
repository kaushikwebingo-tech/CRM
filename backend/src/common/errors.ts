import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly title: string,
    public readonly detail: string,
    public readonly fields?: FieldError[],
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
  constructor(detail: string, fields?: FieldError[]) {
    super(HttpStatus.BAD_REQUEST, 'validation_error', 'Validation Error', detail, fields);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail: string) {
    super(HttpStatus.FORBIDDEN, 'forbidden', 'Forbidden', detail);
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, fields?: FieldError[]) {
    super(HttpStatus.CONFLICT, 'conflict', 'Conflict', detail, fields);
  }
}

const PG_INPUT_ERRORS: Record<string, { status: number; type: string; title: string }> = {
  '22P02': { status: 400, type: 'validation_error', title: 'Validation Error' }, // invalid text representation
  '22007': { status: 400, type: 'validation_error', title: 'Validation Error' }, // invalid datetime format
  '22008': { status: 400, type: 'validation_error', title: 'Validation Error' }, // datetime field overflow
  '22003': { status: 400, type: 'validation_error', title: 'Validation Error' }, // numeric out of range
  '23502': { status: 400, type: 'validation_error', title: 'Validation Error' }, // not null violation
  '23503': { status: 400, type: 'validation_error', title: 'Validation Error' }, // FK violation
  '23505': { status: 409, type: 'conflict', title: 'Conflict' },                 // unique violation
  '23514': { status: 400, type: 'validation_error', title: 'Validation Error' }, // check violation
  '22001': { status: 400, type: 'validation_error', title: 'Validation Error' }, // value too long
  '2201X': { status: 400, type: 'validation_error', title: 'Validation Error' }, // invalid row count
};

function zodToFields(err: ZodError): FieldError[] {
  return err.issues.map((issue) => ({
    // drop the leading `data` segment so the key matches the field key the form knows
    field: issue.path.filter((p) => p !== 'data').join('.') || '_',
    message: issue.message,
  }));
}


@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('AppErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    const problem = this.toProblem(exception);

    if (problem.status >= 500) {
      this.logger.error(
        `${request?.method ?? '?'} ${request?.url ?? '?'} -> ${problem.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (response.headersSent) return;
    response.status(problem.status).json(problem.body);
  }

  private toProblem(exception: unknown): { status: number; body: Record<string, unknown> } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          type: exception.type,
          title: exception.title,
          status: exception.status,
          detail: exception.detail,
          ...(exception.fields && { fields: exception.fields }),
        },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: 400,
        body: {
          type: 'validation_error',
          title: 'Validation Error',
          status: 400,
          detail: 'One or more fields are invalid',
          fields: zodToFields(exception),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const detail =
        typeof res === 'string'
          ? res
          : ((res as { message?: unknown })?.message as string) ?? exception.message;
      return {
        status,
        body: {
          type: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'http_error',
          title: HttpStatus[status] ? String(HttpStatus[status]) : 'Error',
          status,
          detail: Array.isArray(detail) ? detail.join(', ') : String(detail),
        },
      };
    }

    const code = (exception as { code?: string })?.code;

    if (code && PG_INPUT_ERRORS[code]) {
      const mapped = PG_INPUT_ERRORS[code];
      return {
        status: mapped.status,
        body: {
          type: mapped.type,
          title: mapped.title,
          status: mapped.status,
          detail: this.pgDetail(code, exception),
        },
      };
    }

    if (code === 'UNDEFINED_VALUE') {
      return {
        status: 400,
        body: {
          type: 'validation_error',
          title: 'Validation Error',
          status: 400,
          detail: 'A required value was undefined',
        },
      };
    }

    return {
      status: 500,
      body: {
        type: 'internal_error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred',
      },
    };
  }

  private pgDetail(code: string, exception: unknown): string {
    switch (code) {
      case '22P02':
        return 'A value is not in a valid format for its field type';
      case '22007':
      case '22008':
        return 'A value is not a valid date or time';
      case '22003':
        return 'A numeric value is out of range';
      case '23503':
        return 'A referenced record does not exist';
      case '23505':
        return 'A record with this value already exists';
      case '23502':
        return 'A required value is missing';
      case '23514':
        return 'A value is not allowed for its field';
      case '22001':
        return 'A value is too long';
      default:
        return (exception as { message?: string })?.message ?? 'Invalid input';
    }
  }
}
