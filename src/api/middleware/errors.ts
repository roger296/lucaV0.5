import type { NextFunction, Request, Response } from 'express';
import { PeriodClosedError, PeriodSoftClosedError } from '../../chain/types';
import {
  InvalidPeriodStateError,
  PeriodNotFoundError,
  PeriodNotEndedError,
  PeriodSequenceError,
  StagingNotClearError,
  TrialBalanceError,
} from '../../engine/periods';
import { PostingEngineError, ValidationError } from '../../engine/types';
import {
  CurrencyMismatchError,
  CurrencyValidationError,
  ExchangeRateRequiredError,
} from '../../engine/currency';

// ---------------------------------------------------------------------------
// errors.ts — Express error-handling middleware
// ---------------------------------------------------------------------------

/** Structured error response envelope. */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

function sendError(
  res: Response,
  req: Request,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  const requestId = req.requestId ?? 'unknown';
  const body: ErrorResponse = {
    success: false,
    error: { code, message, request_id: requestId, ...(details ? { details } : {}) },
  };
  res.status(status).json(body);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';

  // ── Domain / validation errors (400) ─────────────────────────────────────

  if (err instanceof ValidationError) {
    sendError(res, req, 400, 'VALIDATION_ERROR', err.message);
    return;
  }

  if (err instanceof PostingEngineError) {
    sendError(res, req, 400, 'POSTING_ERROR', err.message);
    return;
  }

  if (err instanceof ExchangeRateRequiredError) {
    sendError(res, req, 400, 'EXCHANGE_RATE_REQUIRED', err.message);
    return;
  }

  if (err instanceof CurrencyMismatchError) {
    sendError(res, req, 400, 'CURRENCY_MISMATCH', err.message);
    return;
  }

  if (err instanceof CurrencyValidationError) {
    sendError(res, req, 400, 'CURRENCY_VALIDATION_ERROR', err.message);
    return;
  }

  // JSON parse errors (Express body-parser sends these as SyntaxError with status 400)
  if (err instanceof SyntaxError && (err as SyntaxError & { status?: number }).status === 400) {
    sendError(res, req, 400, 'INVALID_JSON', 'Request body contains invalid JSON');
    return;
  }

  // ── Not-found errors (404) ────────────────────────────────────────────────

  if (err instanceof PeriodNotFoundError) {
    sendError(res, req, 404, 'PERIOD_NOT_FOUND', err.message);
    return;
  }

  // ── State / conflict errors (409) ────────────────────────────────────────

  if (err instanceof PeriodClosedError) {
    sendError(res, req, 409, 'PERIOD_CLOSED', err.message);
    return;
  }

  if (err instanceof PeriodSoftClosedError) {
    sendError(res, req, 409, 'PERIOD_SOFT_CLOSED', err.message);
    return;
  }

  if (err instanceof InvalidPeriodStateError || err instanceof PeriodNotEndedError) {
    sendError(res, req, 409, 'INVALID_PERIOD_STATE', err.message);
    return;
  }

  if (err instanceof PeriodSequenceError) {
    sendError(res, req, 409, 'PERIOD_SEQUENCE_ERROR', err.message);
    return;
  }

  if (err instanceof StagingNotClearError) {
    sendError(res, req, 409, 'STAGING_NOT_CLEAR', err.message);
    return;
  }

  if (err instanceof TrialBalanceError) {
    sendError(res, req, 409, 'TRIAL_BALANCE_ERROR', err.message);
    return;
  }

  // ── Database constraint violations (409) ─────────────────────────────────

  if (err instanceof Error) {
    const pgError = err as Error & { code?: string; constraint?: string; detail?: string };

    // Unique key violation (PostgreSQL error code 23505)
    if (pgError.code === '23505') {
      // Check if this looks like a duplicate idempotency key
      const isIdempotencyViolation = pgError.constraint?.includes('idempotency');
      sendError(
        res,
        req,
        409,
        isIdempotencyViolation ? 'DUPLICATE_IDEMPOTENCY_KEY' : 'CONSTRAINT_VIOLATION',
        isIdempotencyViolation
          ? 'A transaction with this idempotency key has already been submitted'
          : `Duplicate value violates unique constraint: ${pgError.constraint ?? 'unknown'}`,
        pgError.detail ? { detail: pgError.detail } : undefined,
      );
      return;
    }

    // Foreign key violation (PostgreSQL error code 23503)
    if (pgError.code === '23503') {
      sendError(
        res,
        req,
        409,
        'CONSTRAINT_VIOLATION',
        `Foreign key constraint violation: ${pgError.detail ?? pgError.message}`,
        pgError.detail ? { detail: pgError.detail } : undefined,
      );
      return;
    }

    // Authentication / authorisation
    if (err.message.includes('Authentication required')) {
      sendError(res, req, 401, 'MISSING_AUTH', err.message);
      return;
    }

    if (err.message.includes('Forbidden')) {
      sendError(res, req, 403, 'FORBIDDEN', err.message);
      return;
    }
  }

  // ── Unknown error — log and return 500 ───────────────────────────────────
  console.error(`[${requestId}] Unhandled error:`, err);
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  sendError(res, req, 500, 'INTERNAL_ERROR', message);
}
