import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { TransfersService } from './transfers.service.js';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateTransferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.transfers.create(dto, idempotencyKey?.trim() || undefined);
  }

  @Get(':reference')
  findByReference(@Param('reference') reference: string) {
    return this.transfers.findByReference(reference);
  }
}
