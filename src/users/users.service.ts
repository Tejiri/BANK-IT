import { HttpStatus, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { AppError } from '../common/http-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';

type AccountSummary = {
  id: string;
  accountNumber: string;
  balance: Decimal;
  currency: string;
};

type UserWithAccounts = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  accounts: AccountSummary[];
};

type UsersDb = {
  user: {
    create: (args: {
      data: { name: string; email: string };
      include: { accounts: true };
    }) => Promise<UserWithAccounts>;
    findMany: (args: {
      include: { accounts: true };
      orderBy: { createdAt: 'desc' };
    }) => Promise<UserWithAccounts[]>;
    findUnique: (args: {
      where: { id: string };
      include: { accounts: true };
    }) => Promise<UserWithAccounts | null>;
  };
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    try {
      const user = await this.db().user.create({
        data: { name: dto.name, email: dto.email },
        include: { accounts: true },
      });
      return this.toResponse(user);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          'INVALID_REQUEST',
          'A user with this email already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async findAll() {
    const users = await this.db().user.findMany({
      include: { accounts: true },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.toResponse(user));
  }

  async findOne(userId: string) {
    const user = await this.db().user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });

    if (!user) {
      throw new AppError(
        'ACCOUNT_NOT_FOUND',
        'User does not exist',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toResponse(user);
  }

  private db(): UsersDb {
    return asUsersDb(this.prisma);
  }

  private toResponse(user: UserWithAccounts) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      accounts: user.accounts.map((account) => ({
        id: account.id,
        accountNumber: account.accountNumber,
        balance: Number(account.balance.toFixed()),
        currency: account.currency,
      })),
    };
  }
}

function asUsersDb(value: unknown): UsersDb {
  return value as UsersDb;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
