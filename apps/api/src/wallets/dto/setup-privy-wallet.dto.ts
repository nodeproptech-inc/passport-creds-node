import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class SetupPrivyWalletDto {
  @IsString()
  @IsNotEmpty()
  privyUserId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'walletAddress must be a valid EVM address' })
  walletAddress!: string;
}
