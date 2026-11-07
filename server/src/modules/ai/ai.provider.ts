import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import {
  AppError,
  RateLimitError,
  ServiceUnavailableError,
  UnprocessableError,
} from '../../core/errors';

export interface AiRequest<T> {
  system: string;
  prompt: string;
  /** Output contract; the response is validated against it. */
  schema: z.ZodType<T>;
  effort?: 'low' | 'medium' | 'high';
}

export interface AiResponse<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Pluggable provider (Anthropic Claude by default; tests install a fake). */
export interface AiProvider {
  readonly name: string;
  configured(): boolean;
  generate<T>(req: AiRequest<T>): Promise<AiResponse<T>>;
}

/** The model declined the request (safety policy); nothing is returned to apply. */
export class AiRefusedError extends AppError {
  constructor() {
    super(
      422,
      'UNPROCESSABLE',
      'The AI assistant declined this request. Please rephrase it or continue manually.',
    );
  }
}

class ClaudeProvider implements AiProvider {
  readonly name = 'anthropic';
  private client: Anthropic | null = null;

  configured(): boolean {
    return env.AI_PROVIDER === 'anthropic' && Boolean(env.ANTHROPIC_API_KEY);
  }

  async generate<T>(req: AiRequest<T>): Promise<AiResponse<T>> {
    // Credentials come from the environment (ANTHROPIC_API_KEY); never hard-coded.
    this.client ??= new Anthropic();
    try {
      const res = await this.client.beta.messages.parse({
        model: env.AI_MODEL,
        max_tokens: 16000,
        // If a safety classifier declines, the API re-runs the request on Anthropic's
        // recommended fallback model instead of returning a refusal.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { effort: req.effort ?? 'medium', format: betaZodOutputFormat(req.schema) },
      });
      if (res.stop_reason === 'refusal') throw new AiRefusedError();
      if (res.stop_reason === 'max_tokens')
        throw new UnprocessableError('The AI response was too long. Try a shorter input.');
      if (!res.parsed_output)
        throw new ServiceUnavailableError(
          'The AI assistant returned an unreadable answer. Please try again.',
        );
      return {
        data: res.parsed_output as T,
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Anthropic.RateLimitError)
        throw new RateLimitError('The AI service is busy. Please try again in a minute.');
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError
      ) {
        logger.error({ status: err.status }, 'AI provider rejected the credentials');
        throw new ServiceUnavailableError(
          'The AI assistant is not configured correctly. Please contact an administrator.',
        );
      }
      if (err instanceof Anthropic.APIError) {
        logger.error({ status: err.status, message: err.message }, 'AI provider error');
        throw new ServiceUnavailableError(
          'The AI service is unavailable right now. Please try again later.',
        );
      }
      throw err;
    }
  }
}

let provider: AiProvider = new ClaudeProvider();

export const aiProvider = () => provider;

/** Replaces the provider (tests). */
export function setAiProvider(next: AiProvider | null): void {
  provider = next ?? new ClaudeProvider();
}
