import type { Request, Response, NextFunction } from 'express';

export type EndpointFunction = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export interface Container {
  build<T extends EndpointFunction>(fn: T): T;
}

/**
 * @deprecated Use `Handler` instead.
 */
export function asyncHandler(
  endpointFn: EndpointFunction,
  container?: Container,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const handler = container ? container.build(endpointFn) : endpointFn;
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
