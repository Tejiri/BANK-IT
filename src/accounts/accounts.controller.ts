import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.create(dto);
  }

  @Get()
  findAll() {
    return this.accounts.findAll();
  }

  @Get(':accountId/balance')
  getBalance(
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
  ) {
    return this.accounts.getBalance(accountId);
  }

  @Get(':accountId/transactions')
  getTransactions(
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.accounts.getTransactions(accountId, query.page, query.limit);
  }

  @Get(':accountId')
  findOne(
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
  ) {
    return this.accounts.findOne(accountId);
  }
}
