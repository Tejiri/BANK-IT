import {
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateAccountDto {
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency must be a 3-letter code' })
  currency?: string;

  @IsDefined({ message: 'balance is required' })
  balance!: string | number;
}
