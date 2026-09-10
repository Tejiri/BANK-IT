import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../common/http-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    try {
      const user = await this.prisma.user.create({
        data: { name: dto.name, email: dto.email },
        include: { accounts: true },
      });
      return this.toResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
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
    const users = await this.prisma.user.findMany({
      include: { accounts: true },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.toResponse(user));
  }

  async findOne(userId: string) {
    const user = await this.prisma.user.findUnique({
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

  private toResponse(user: {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
    accounts: {
      id: string;
      accountNumber: string;
      balance: Prisma.Decimal;
      currency: string;
    }[];
  }) {
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
