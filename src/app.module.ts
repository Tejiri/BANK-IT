import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TransfersModule } from './transfers/transfers.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [PrismaModule, UsersModule, AccountsModule, TransfersModule],
})
export class AppModule {}
