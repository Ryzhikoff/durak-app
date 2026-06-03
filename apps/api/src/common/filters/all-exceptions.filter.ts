import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      code = defaultCodeForStatus(status);
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        if (typeof r.code === 'string') code = r.code;
        if (typeof r.message === 'string') {
          message = r.message;
        } else if (Array.isArray(r.message)) {
          message = (r.message as string[]).join('; ');
          details = r.message;
        } else if (typeof r.error === 'string') {
          message = r.error;
        }
        if (r.details !== undefined) details = r.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
      this.logger.error({ err: exception }, 'Unhandled exception');
    } else {
      this.logger.error({ err: exception }, 'Unknown thrown value');
    }

    const body: ErrorBody = { error: { code, message } };
    if (details !== undefined) body.error.details = details;

    void res.status(status).send(body);
    // structured log on errors
    if (status >= 500) {
      this.logger.error(
        { method: req.method, url: req.url, status, code },
        'Request failed with 5xx',
      );
    }
  }
}
