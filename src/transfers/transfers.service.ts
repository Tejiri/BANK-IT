import { createHash, randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { AppError } from '../common/http-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';

type TransferSuccess = {
  success: true;
  reference: string;
  status: 'SUCCESS';
};

type AccountRow = {
  id: string;
  balance: Decimal;
  currency: string;
};

type TransferRow = {
  reference: string;
  senderAccountId: string;
  recipientAccountId: string;
  amount: Decimal;
  currency: string;
  status: string;
  createdAt: Date;
};

type SqlTag = {
  <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

type TransferTx = {
  $queryRaw: SqlTag;
  $executeRaw: SqlTag;
  account: {
    findUnique: (args: { where: { id: string } }) => Promise<AccountRow | null>;
  };
  transaction: {
    create: (args: {
      data: {
        reference: string;
        senderAccountId: string;
        recipientAccountId: string;
        amount: Decimal;
        currency: string;
        status: string;
      };
    }) => Promise<unknown>;
  };
  idempotencyKey: {
    update: (args: {
      where: { key: string };
      data: { responseBody: TransferSuccess };
    }) => Promise<unknown>;
  };
};

type TransfersDb = {
  $transaction: (
    fn: (tx: TransferTx) => Promise<TransferSuccess>,
    options?: { timeout: number },
  ) => Promise<TransferSuccess>;
  transaction: {
    findUnique: (args: {
      where: { reference: string };
    }) => Promise<TransferRow | null>;
  };
};

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateTransferDto,
    idempotencyKey?: string,
  ): Promise<TransferSuccess> {
    if (dto.senderAccountId === dto.recipientAccountId) {
      throw new AppError(
        'INVALID_REQUEST',
        'Sender and recipient accounts must be different',
        HttpStatus.BAD_REQUEST,
      );
    }

    const amount = parseAmount(dto.amount);
    const requestHash = hashRequest(dto, amount);

    try {
      const result = await this.db().$transaction(
        async (tx) => {
          if (idempotencyKey) {
            const replay = await this.claimIdempotencyKey(
              tx,
              idempotencyKey,
              requestHash,
            );
            if (replay) {
              return replay;
            }
          }

          const [firstId, secondId] = [
            dto.senderAccountId,
            dto.recipientAccountId,
          ].sort();

          await tx.$queryRaw`
            SELECT id FROM accounts WHERE id = ${firstId}::uuid FOR UPDATE
          `;
          await tx.$queryRaw`
            SELECT id FROM accounts WHERE id = ${secondId}::uuid FOR UPDATE
          `;

          const sender = await tx.account.findUnique({
            where: { id: dto.senderAccountId },
          });
          const recipient = await tx.account.findUnique({
            where: { id: dto.recipientAccountId },
          });

          if (!sender || !recipient) {
            throw new AppError(
              'ACCOUNT_NOT_FOUND',
              'Sender or recipient account does not exist',
              HttpStatus.NOT_FOUND,
            );
          }

          if (sender.currency !== recipient.currency) {
            throw new AppError(
              'CURRENCY_MISMATCH',
              'Sender and recipient account currencies do not match',
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          if (sender.balance.lt(amount)) {
            throw new AppError(
              'INSUFFICIENT_FUNDS',
              'Insufficient account balance',
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }

          const amountSql = amount.toFixed();

          await tx.$executeRaw`
            UPDATE accounts
            SET balance = balance - ${amountSql}::decimal
            WHERE id = ${sender.id}::uuid
              AND balance >= ${amountSql}::decimal
          `;

          await tx.$executeRaw`
            UPDATE accounts
            SET balance = balance + ${amountSql}::decimal
            WHERE id = ${recipient.id}::uuid
          `;

          const reference = `TRX-${randomUUID()}`;

          await tx.transaction.create({
            data: {
              reference,
              senderAccountId: sender.id,
              recipientAccountId: recipient.id,
              amount,
              currency: sender.currency,
              status: 'SUCCESS',
            },
          });

          const body: TransferSuccess = {
            success: true,
            reference,
            status: 'SUCCESS',
          };

          if (idempotencyKey) {
            await tx.idempotencyKey.update({
              where: { key: idempotencyKey },
              data: { responseBody: body },
            });
          }

          return body;
        },
        { timeout: 15_000 },
      );

      return result;
    } catch (caught) {
      if (caught instanceof AppError) {
        throw caught;
      }
      throw new AppError(
        'TRANSFER_FAILED',
        'Transfer could not be completed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findByReference(reference: string) {
    const transfer = await this.db().transaction.findUnique({
      where: { reference },
    });

    if (!transfer) {
      throw new AppError(
        'INVALID_REQUEST',
        'Transfer not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      reference: transfer.reference,
      senderAccountId: transfer.senderAccountId,
      recipientAccountId: transfer.recipientAccountId,
      amount: Number(transfer.amount.toFixed()),
      currency: transfer.currency,
      status: transfer.status,
      createdAt: transfer.createdAt.toISOString(),
    };
  }

  private db(): TransfersDb {
    return asTransfersDb(this.prisma);
  }

  private async claimIdempotencyKey(
    tx: TransferTx,
    key: string,
    requestHash: string,
  ): Promise<TransferSuccess | null> {
    const inserted = await tx.$queryRaw<{ key: string }[]>`
      INSERT INTO idempotency_keys (key, request_hash, response_body)
      VALUES (${key}, ${requestHash}, '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `;

    if (inserted.length > 0) {
      return null;
    }

    const existing = await tx.$queryRaw<
      { request_hash: string; response_body: TransferSuccess }[]
    >`
      SELECT request_hash, response_body
      FROM idempotency_keys
      WHERE key = ${key}
    `;

    const row = existing[0];
    if (!row) {
      throw new AppError(
        'TRANSFER_FAILED',
        'Transfer could not be completed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (row.request_hash !== requestHash) {
      throw new AppError(
        'DUPLICATE_REQUEST',
        'Idempotency key was already used for a different transfer',
        HttpStatus.CONFLICT,
      );
    }

    return row.response_body;
  }
}

function asTransfersDb(value: unknown): TransfersDb {
  return value as TransfersDb;
}

function parseAmount(value: unknown): Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(
      'INVALID_REQUEST',
      'amount is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  const asString = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(asString)) {
    throw new AppError(
      'INVALID_REQUEST',
      'amount must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  }

  const amount = new Decimal(asString);
  if (amount.lte(0)) {
    throw new AppError(
      'INVALID_REQUEST',
      'amount must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  }

  return amount;
}

function hashRequest(dto: CreateTransferDto, amount: Decimal) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        senderAccountId: dto.senderAccountId,
        recipientAccountId: dto.recipientAccountId,
        amount: amount.toFixed(),
      }),
    )
    .digest('hex');
}
