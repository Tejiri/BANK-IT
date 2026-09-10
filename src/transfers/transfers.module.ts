import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
