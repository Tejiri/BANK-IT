import 'dotenv/config';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AppError, AppErrorFilter } from '../src/common/http-error';
import { PrismaService } from '../src/prisma/prisma.service';
import { Prisma } from '../src/generated/prisma/client';

describe('Transfers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let senderId: string;
  let recipientId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => {
          const message =
            Object.values(errors[0]?.constraints ?? {})[0] ?? 'Invalid request';
          return new AppError('INVALID_REQUEST', message, HttpStatus.BAD_REQUEST);
        },
      }),
    );
    app.useGlobalFilters(new AppErrorFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.idempotencyKey.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    const senderUser = await prisma.user.create({
      data: {
        name: 'Sender',
        email: `sender-${Date.now()}@bankit.test`,
        accounts: {
          create: {
            accountNumber: `SND-${Date.now()}`,
            balance: '100000',
            currency: 'NGN',
          },
        },
      },
      include: { accounts: true },
    });

    const recipientUser = await prisma.user.create({
      data: {
        name: 'Recipient',
        email: `recipient-${Date.now()}@bankit.test`,
        accounts: {
          create: {
            accountNumber: `RCP-${Date.now()}`,
            balance: '50000',
            currency: 'NGN',
          },
        },
      },
      include: { accounts: true },
    });

    senderId = senderUser.accounts[0].id;
    recipientId = recipientUser.accounts[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('transfers money and creates a transaction', async () => {
    const res = await request(app.getHttpServer())
      .post('/transfers')
      .send({
        senderAccountId: senderId,
        recipientAccountId: recipientId,
        amount: 20000,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      success: true,
      status: 'SUCCESS',
    });
    expect(res.body.reference).toMatch(/^TRX-/);

    const [sender, recipient] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: senderId } }),
      prisma.account.findUniqueOrThrow({ where: { id: recipientId } }),
    ]);

    expect(Number(sender.balance.toString())).toBe(80000);
    expect(Number(recipient.balance.toString())).toBe(70000);

    await request(app.getHttpServer())
      .get(`/transfers/${res.body.reference}`)
      .expect(200)
      .expect((getRes) => {
        expect(getRes.body.amount).toBe(20000);
        expect(getRes.body.status).toBe('SUCCESS');
      });
  });

  it('rejects insufficient funds', async () => {
    const res = await request(app.getHttpServer())
      .post('/transfers')
      .send({
        senderAccountId: senderId,
        recipientAccountId: recipientId,
        amount: 100000.01,
      })
      .expect(422);

    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INSUFFICIENT_FUNDS',
        message: 'Insufficient account balance',
      },
    });

    const sender = await prisma.account.findUniqueOrThrow({
      where: { id: senderId },
    });
    expect(Number(sender.balance.toString())).toBe(100000);
  });

  it('rejects a missing account', async () => {
    const res = await request(app.getHttpServer())
      .post('/transfers')
      .send({
        senderAccountId: senderId,
        recipientAccountId: '550e8400-e29b-41d4-a716-446655440000',
        amount: 100,
      })
      .expect(404);

    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('rejects the same sender and recipient', async () => {
    const res = await request(app.getHttpServer())
      .post('/transfers')
      .send({
        senderAccountId: senderId,
        recipientAccountId: senderId,
        amount: 100,
      })
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rolls back balances when a later step fails', async () => {
    const amount = new Prisma.Decimal('20000');

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE accounts
          SET balance = balance - ${amount.toFixed()}::decimal
          WHERE id = ${senderId}::uuid
        `;
        await tx.$executeRaw`
          UPDATE accounts
          SET balance = balance + ${amount.toFixed()}::decimal
          WHERE id = ${recipientId}::uuid
        `;
        throw new Error('simulated failure');
      }),
    ).rejects.toThrow('simulated failure');

    const [sender, recipient] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: senderId } }),
      prisma.account.findUniqueOrThrow({ where: { id: recipientId } }),
    ]);

    expect(Number(sender.balance.toString())).toBe(100000);
    expect(Number(recipient.balance.toString())).toBe(50000);
  });

  it('replays a duplicate idempotency key without debiting twice', async () => {
    const payload = {
      senderAccountId: senderId,
      recipientAccountId: recipientId,
      amount: 20000,
    };

    const first = await request(app.getHttpServer())
      .post('/transfers')
      .set('Idempotency-Key', 'abc123')
      .send(payload)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/transfers')
      .set('Idempotency-Key', 'abc123')
      .send(payload)
      .expect(201);

    expect(second.body).toEqual(first.body);

    const sender = await prisma.account.findUniqueOrThrow({
      where: { id: senderId },
    });
    expect(Number(sender.balance.toString())).toBe(80000);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('creates a user and account, then returns balance and history', async () => {
    const userRes = await request(app.getHttpServer())
      .post('/users')
      .send({ name: 'Ada', email: `ada-${Date.now()}@bankit.test` })
      .expect(201);

    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({
        userId: userRes.body.id,
        balance: 100000,
        currency: 'NGN',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/accounts/${accountRes.body.id}/balance`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          accountId: accountRes.body.id,
          balance: 100000,
          currency: 'NGN',
        });
      });

    await request(app.getHttpServer())
      .post('/transfers')
      .send({
        senderAccountId: senderId,
        recipientAccountId: accountRes.body.id,
        amount: 1000,
      })
      .expect(201);

    const history = await request(app.getHttpServer())
      .get(`/accounts/${accountRes.body.id}/transactions?page=1&limit=20`)
      .expect(200);

    expect(history.body.page).toBe(1);
    expect(history.body.limit).toBe(20);
    expect(history.body.total).toBe(1);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].status).toBe('SUCCESS');
  });
});
