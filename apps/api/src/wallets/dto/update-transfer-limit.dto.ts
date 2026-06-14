import { IsNumber, Min } from 'class-validator';

export class UpdateTransferLimitDto {
  @IsNumber()
  @Min(0)
  dailyLimitUsd!: number;
}
