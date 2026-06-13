import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class AttesterService {
  private readonly logger = new Logger(AttesterService.name);
  private readonly apiKey = process.env.INFERENCE_API_KEY ?? '';
  private readonly baseUrl =
    process.env.INFERENCE_BASE_URL ?? 'https://confidential-ai-dev-preview.cldev.cloud';
  private readonly ngrokUrl = process.env.NGROK_PUBLIC_URL ?? '';

  private readPrompt(claimType: string): string {
    const filename =
      claimType === 'KYC_AML_VERIFIED' ? 'prompt-kyc-aml.txt' : 'prompt-accredited-investor.txt';
    // __dirname = hackathon/apps/api/src/attester — go up 4 levels to hackathon/
    const promptPath = join(__dirname, '../../../../demo', filename);
    return readFileSync(promptPath, 'utf-8');
  }

  async submitInference(params: {
    walletAddress: string;
    claimType: string;
    documentBase64: string;
    documentName: string;
    documentContentType?: string;
  }): Promise<string> {
    const {
      walletAddress,
      claimType,
      documentBase64,
      documentName,
      documentContentType = 'text/plain',
    } = params;

    if (!this.ngrokUrl) {
      throw new InternalServerErrorException(
        'NGROK_PUBLIC_URL is not set — cannot receive AI Attester callback',
      );
    }

    if (!this.apiKey) {
      throw new InternalServerErrorException('INFERENCE_API_KEY is not configured');
    }

    const promptTemplate = this.readPrompt(claimType);
    const prompt = promptTemplate.replace('REPLACE_WITH_WALLET', walletAddress);
    const callbackUrl = `${this.ngrokUrl}/webhooks/ai-attester`;

    const body = {
      model: 'gemma4',
      system_prompt:
        'You are a compliance verification AI. Return ONLY a minified JSON object. No markdown, no explanation, no extra text. No code fences.',
      prompt,
      resources: [
        {
          filename: documentName,
          content_type: documentContentType,
          content_base64: documentBase64,
        },
      ],
      cre_callback: {
        url: callbackUrl,
      },
    };

    this.logger.log(
      `Submitting to AI Attester: claimType=${claimType} wallet=${walletAddress} callback=${callbackUrl}`,
    );

    const response = await axios.post(`${this.baseUrl}/v1/inference`, body, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const inferenceId: string = response.data.id;
    this.logger.log(`AI Attester queued: inferenceId=${inferenceId} status=${response.data.status}`);
    return inferenceId;
  }
}
