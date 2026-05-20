import { Router } from 'express';
export type { Application as IServer } from 'express';
export type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
  RequestHandler,
} from 'express';
export type { ILogger } from './types';

export { xenosisBootstrap } from './xenosisBootstrap';

export { Request, z } from './rest/Request';
export { Response, StatusCode } from './rest/Response';
export { Handler } from './rest/Handler';
export { Exception } from './rest/Exception';
export {
  errorHandlerMiddleware,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from './rest/ErrorHandler';

export { Router };

export type { MongoConnection } from './providers/mongo.provider';
export type { DynamoConnection } from './providers/dynamo.provider';

// Request context — per-request scope, child logger, active trace
export {
  getRequestContext,
  getActiveTraceContext,
} from './middlewares/requestContext.middleware';
export type { RequestContext } from './middlewares/requestContext.middleware';

// Peers (inter-service RPC)
export { definePeerApi } from './peers/definePeerApi';
export { defineServiceApi } from './peers/defineServiceApi';
export { mountPeerApi } from './peers/mountPeerApi';
export { PeerHttpError } from './peers/reliability';
export type {
  PeerApi,
  PeerClient,
  PeerHandlers,
  PeerBinding,
  PeerTransport,
  ReliabilityConfig,
  RouteSpec,
  HttpMethod,
  TraceContext,
  BodyEncoding,
  ErrorMapper,
} from './peers/types';

export * from './types';
