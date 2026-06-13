import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CREService {
  private readonly logger = new Logger(CREService.name);
  private readonly creBaseUrl = process.env.CRE_BASE_URL ?? 'http://localhost:3002';

  constructor(private readonly http: HttpService) {}

  // Sends only the verificationId to the CRE. The CRE then calls GET /cre/verification-result/:id
  // to fetch the sanitized result — no PII or raw documents leave the backend.
  async triggerWorkflow(verificationId: string): Promise<void> {
    const url = `${this.creBaseUrl}/trigger`;
    this.logger.log(`Triggering CRE workflow for verificationId=${verificationId}`);

    try {
      await firstValueFrom(
        this.http.post(url, { verificationId }),
      );
      this.logger.log(`CRE workflow triggered for verificationId=${verificationId}`);
    } catch (err: any) {
      // Log and continue — CRE failures are not fatal for the webhook response
      this.logger.error(`Failed to trigger CRE for verificationId=${verificationId}: ${err?.message}`);
    }
  }
}
