import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

export interface CorrelatedRequest extends Request {
  correlationId: string;
}

/** Reuses a caller-supplied `x-correlation-id` if present and sane, otherwise mints one. */
export class CorrelationId {
  private static readonly MAX_INCOMING_LENGTH = 128;

  static resolve(request: Request): string {
    const incoming = request.header('x-correlation-id');
    return incoming && incoming.length <= CorrelationId.MAX_INCOMING_LENGTH ? incoming : randomUUID();
  }
}
