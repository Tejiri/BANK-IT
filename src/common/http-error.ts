import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

export class AppError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus) {
    super({ success: false, error: { code, message } }, status);
  }
}

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(
        typeof body === 'object'
          ? body
          : {
              success: false,
              error: { code: 'INVALID_REQUEST', message: body },
            },
      );
      return;
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: 'TRANSFER_FAILED',
        message: 'Transfer could not be completed',
      },
    });
  }
}
