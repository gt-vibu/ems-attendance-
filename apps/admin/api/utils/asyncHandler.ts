import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps async Express route handlers to guarantee that any rejected promises
 * or unhandled errors are passed directly to Express's next() error middleware.
 */
export function asyncHandler(fn: (req: Request | any, res: Response | any, next: NextFunction) => Promise<any>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
