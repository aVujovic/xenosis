import { Request, Response, NextFunction } from 'express';
import { Exception } from './Exception';

export class NotFoundException extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'NotFoundException';
  }
}

export class BadRequestException extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'BadRequestException';
  }
}

export class ForbiddenException extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'ForbiddenException';
  }
}

/**
 * Error handler middleware for microservices.
 * Converts custom exceptions to proper HTTP responses with correct status codes.
 * IMPORTANT: Must have exactly 4 parameters for Express to recognize it as error middleware.
 */
export const errorHandlerMiddleware = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const logger = (req as any).logger || console;

  if (err instanceof BadRequestException) {
    logger.warn({
      message: err.message,
      code: err.code,
      name: err.name,
      path: req.path,
      method: req.method,
    });

    return res.status(400).json({
      name: err.name,
      message: err.message,
      code: err.code,
      status: 400,
    });
  }

  if (err instanceof NotFoundException) {
    logger.warn({
      message: err.message,
      code: err.code,
      name: err.name,
      path: req.path,
      method: req.method,
    });

    return res.status(404).json({
      name: err.name,
      message: err.message,
      code: err.code,
      status: 404,
    });
  }

  if (err instanceof ForbiddenException) {
    logger.warn({
      message: err.message,
      code: err.code,
      name: err.name,
      path: req.path,
      method: req.method,
    });

    return res.status(403).json({
      name: err.name,
      message: err.message,
      code: err.code,
      status: 403,
    });
  }

  if (err instanceof Exception) {
    logger.warn({
      message: err.message,
      status: err.status,
      name: err.name,
      path: req.path,
      method: req.method,
    });

    return res.status(err.status).json({
      name: err.name,
      message: err.message,
      body: err.body,
      status: err.status,
    });
  }

  // zod validation errors (when not wrapped through Exception)
  if (err?.name === 'ZodError') {
    logger.warn({
      message: 'Validation error',
      details: err.issues,
      path: req.path,
      method: req.method,
    });

    return res.status(422).json({
      name: 'ValidationError',
      message: 'Validation failed',
      details: err.issues,
      status: 422,
    });
  }

  logger.error({
    message: err.message || 'Internal server error',
    stack: err.stack,
    name: err.name,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    name: 'InternalServerError',
    message: 'An unexpected error occurred',
    status: 500,
  });
};
