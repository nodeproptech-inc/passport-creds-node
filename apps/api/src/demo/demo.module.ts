import { Global, Module } from '@nestjs/common';
import { DemoStateService } from './demo-state.service';

@Global()
@Module({ providers: [DemoStateService], exports: [DemoStateService] })
export class DemoModule {}
