import { Module } from '@nestjs/common';
import { MockContractAdapter } from './mock-contract-adapter';
import { OnchainContractAdapter } from './onchain-contract-adapter';

const CONTRACT_ADAPTER = {
  provide: 'CONTRACT_ADAPTER',
  useClass: process.env.DEMO_MODE === 'true' ? MockContractAdapter : OnchainContractAdapter,
};

@Module({
  providers: [CONTRACT_ADAPTER, MockContractAdapter, OnchainContractAdapter],
  exports: ['CONTRACT_ADAPTER'],
})
export class ContractModule {}
