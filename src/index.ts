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
export type { BuiltHandler, RouteMeta } from './rest/Handler';
export { Exception } from './rest/Exception';
export {
  errorHandlerMiddleware,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from './rest/ErrorHandler';

// Recording Router — drop-in for express.Router() that captures routes for
// OpenAPI. Controllers use this transparently.
export { Router } from './rest/openapi';
export type { RouteRecord } from './rest/openapi';
export type { OpenapiConfig } from './libs/openapi.loader';

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
export { CALLER_HEADER } from './peers/tracing';
export type {
  PeerApi,
  PeerClient,
  PeerHandlers,
  PeerBinding,
  PeerTransport,
  TransportRequest,
  ReliabilityConfig,
  RouteSpec,
  HttpMethod,
  TraceContext,
  BodyEncoding,
  ErrorMapper,
  Boundaries,
  Authentication,
} from './peers/types';

export * from './types';

// Config schema + typed config. Add a `src/config.schema.ts` to your service
// default-exporting `defineConfigSchema({...})` to type + validate your own keys.
export { xenosisConfigSchema, defineConfigSchema } from './config.schema';
export type { XenosisConfig } from './config.schema';

// Internal loaders + providers — exported for tooling (e.g. @xenosisorg/xenosis-testing)
// that needs to assemble a container outside the standard xenosisBootstrap flow.
// Not part of the everyday app-author API; the surface may shift with internals.
export { loadSchemas } from './libs/schemas.loader';
export { runAutoload } from './libs/autoload.loader';
export { loadSharedModules } from './libs/sharedModules.loader';
export { mountOpenapi } from './libs/openapi.loader';
export { loadPeers } from './peers/loader';
export { loadServiceApis } from './peers/servicesLoader';
export { createPeerClient } from './peers/createPeerClient';
export { buildReliabilityPolicy } from './peers/reliability';
export { buildRequestContextMiddleware } from './middlewares/requestContext.middleware';
export { default as serverProvider } from './providers/server.provider';
export { default as loggerProvider } from './providers/logger.provider';
export { Commands } from './providers/commands.provider';
export { Signals } from './providers/signals.provider';
