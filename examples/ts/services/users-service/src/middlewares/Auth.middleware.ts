import type { Request, Response, NextFunction } from 'express';
import { Exception } from '@xenosisorg/xenosis-core';
import { asValue } from 'awilix';
import jwt from 'jsonwebtoken';

/**
 * Shape of the user object placed into the request scope by this middleware.
 * Mirrors whatever `userService.create(...)` returns minus the password / hash.
 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Builds a middleware that:
 *   1. Reads `Authorization: Bearer <token>` from the request.
 *   2. Verifies it against `config.auth.jwtSecret`.
 *   3. Registers the decoded user in the per-request awilix scope as
 *      `cradle.currentUser` — services that inject `currentUser` get the
 *      authenticated user for free.
 *
 * Throws `Exception.Unauthorized` on missing or invalid token. The global
 * `errorHandlerMiddleware` turns that into a 401 JSON response.
 *
 * Built as a factory because it needs `config` from cradle; the global
 * `authMiddleware` cradle key in service.ts holds the wired instance.
 */
export function buildAuthMiddleware(opts: {
  jwtSecret: string;
}): (req: Request, res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && /^Bearer\s+/i.test(header)
        ? header.replace(/^Bearer\s+/i, '').trim()
        : undefined;

    if (!token) {
      return next(
        Exception.Unauthorized({ reason: 'missing or malformed Authorization header' }),
      );
    }

    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(token, opts.jwtSecret);
      if (typeof decoded !== 'object' || decoded === null) {
        throw new Error('decoded payload is not an object');
      }
      payload = decoded as jwt.JwtPayload;
    } catch (err) {
      return next(
        Exception.Unauthorized({
          reason: err instanceof Error ? err.message : 'invalid token',
        }),
      );
    }

    const user: CurrentUser = {
      id: String(payload.sub ?? ''),
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
    };

    if (!user.id || !user.email) {
      return next(
        Exception.Unauthorized({ reason: 'token payload missing required fields' }),
      );
    }

    // Register on the per-request awilix scope set by request-context middleware.
    // Services / repositories / job handlers running on this request can now
    // inject `currentUser` in their constructor and get this user.
    if (req.scope) {
      req.scope.register({
        currentUser: asValue(user),
      });
    }

    next();
  };
}
