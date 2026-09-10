import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  await prisma.idempotencyKey.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  const ada = await prisma.user.create({
    data: {
      name: 'Ada Okonkwo',
      email: 'ada@bankit.test',
      accounts: {
        create: {
          accountNumber: '1000000001',
          balance: '100000',
          currency: 'NGN',
        },
      },
    },
    include: { accounts: true },
  });

  const boli = await prisma.user.create({
    data: {
      name: 'Boli Mensah',
      email: 'boli@bankit.test',
      accounts: {
        create: {
          accountNumber: '1000000002',
          balance: '50000',
          currency: 'NGN',
        },
      },
    },
    include: { accounts: true },
  });

  console.log('Seeded accounts:');
  console.log(
    `  Ada  ${ada.accounts[0].id}  NGN ${ada.accounts[0].balance.toString()}`,
  );
  console.log(
    `  Boli ${boli.accounts[0].id}  NGN ${boli.accounts[0].balance.toString()}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
