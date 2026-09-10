import { IsDefined, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateTransferDto {
  @IsDefined({ message: 'senderAccountId is required' })
  @IsString()
  @IsNotEmpty({ message: 'senderAccountId is required' })
  @IsUUID('4', { message: 'senderAccountId must be a valid UUID' })
  senderAccountId!: string;

  @IsDefined({ message: 'recipientAccountId is required' })
  @IsString()
  @IsNotEmpty({ message: 'recipientAccountId is required' })
  @IsUUID('4', { message: 'recipientAccountId must be a valid UUID' })
  recipientAccountId!: string;

  @IsDefined({ message: 'amount is required' })
  amount!: string | number;
}
