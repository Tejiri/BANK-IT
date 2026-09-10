import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AppError, AppErrorFilter } from './common/http-error.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const message =
          Object.values(errors[0]?.constraints ?? {})[0] ?? 'Invalid request';
        return new AppError('INVALID_REQUEST', message, HttpStatus.BAD_REQUEST);
      },
    }),
  );
  app.useGlobalFilters(new AppErrorFilter());

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
