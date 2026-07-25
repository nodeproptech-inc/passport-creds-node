import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress, IsObject, IsOptional } from 'class-validator';
import { type Address } from 'viem';
import { WorldIdService } from './world-id.service';

class VerifyWorldIdDto {
  @IsEthereumAddress()
  wallet!: Address;

  @IsEthereumAddress()
  identity!: Address;

  @IsObject()
  idkitResponse!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** World ID endpoints belong to the new API; proofs are always checked server-side. */
@Controller('world-id')
export class WorldIdController {
  constructor(private readonly worldId: WorldIdService) {}

  @Post('request')
  createRequest() {
    return this.worldId.createRequest();
  }

  @Post('verify')
  verify(@Body() dto: VerifyWorldIdDto) {
    return this.worldId.verifyAndPrepareClaim(dto.wallet, dto.identity, dto.idkitResponse);
  }
}
