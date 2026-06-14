import { IsNumber, Min } from 'class-validator';

export class TransferIntentDto {
  @IsNumber()
  @Min(0)
  amountUsd!: number;
}
