import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../common/http-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAccountDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new AppError(
        'ACCOUNT_NOT_FOUND',
        'User does not exist',
        HttpStatus.NOT_FOUND,
      );
    }

    const account = await this.prisma.account.create({
      data: {
        userId: user.id,
        accountNumber: this.newAccountNumber(),
        balance: parseMoney(dto.balance, 'balance'),
        currency: (dto.currency ?? 'NGN').toUpperCase(),
      },
    });

    return this.toResponse(account);
  }

  async findAll() {
    const accounts = await this.prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((account) => this.toResponse(account));
  }

  async findOne(accountId: string) {
    return this.toResponse(await this.requireAccount(accountId));
  }

  async getBalance(accountId: string) {
    const account = await this.requireAccount(accountId);
    return {
      accountId: account.id,
      balance: Number(account.balance.toFixed()),
      currency: account.currency,
    };
  }

  async getTransactions(accountId: string, page: number, limit: number) {
    await this.requireAccount(accountId);

    const where = {
      OR: [{ senderAccountId: accountId }, { recipientAccountId: accountId }],
    };

    const [total, rows] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows.map((row) => ({
        reference: row.reference,
        senderAccountId: row.senderAccountId,
        recipientAccountId: row.recipientAccountId,
        amount: Number(row.amount.toFixed()),
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }

  private async requireAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new AppError(
        'ACCOUNT_NOT_FOUND',
        'Account does not exist',
        HttpStatus.NOT_FOUND,
      );
    }

    return account;
  }

  private newAccountNumber() {
    return `10${String(randomInt(0, 1_000_000_000)).padStart(8, '0')}`;
  }

  private toResponse(account: {
    id: string;
    userId: string;
    accountNumber: string;
    balance: Prisma.Decimal;
    currency: string;
    createdAt: Date;
  }) {
    return {
      id: account.id,
      userId: account.userId,
      accountNumber: account.accountNumber,
      balance: Number(account.balance.toFixed()),
      currency: account.currency,
      createdAt: account.createdAt.toISOString(),
    };
  }
}

function parseMoney(value: unknown, field: string): Prisma.Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(
      'INVALID_REQUEST',
      `${field} is required`,
      HttpStatus.BAD_REQUEST,
    );
  }

  const asString = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(asString)) {
    throw new AppError(
      'INVALID_REQUEST',
      `${field} must be a number greater than or equal to zero`,
      HttpStatus.BAD_REQUEST,
    );
  }

  return new Prisma.Decimal(asString);
}
