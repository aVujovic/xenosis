// Framework-agnostic HTTP types. `IServer` is now the abstract `XServer` —
// the Express adapter passes Express's `Application` through unchanged (it
// implements `XServer` structurally), and the Hono adapter (Phase 3) builds
// a thin wrapper around Hono + @hono/node-server. Code that needs the raw
// Express request type can still import it directly from `'express'`; this
// package no longer re-exports it.
export type {
  XServer as IServer,
  XReq,
  XRes,
  XNext,
  XHandler,
  XErrorHandler,
  XRouter,
  XRequestContext,
} from './rest/http';
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

export type { MongoConnection } from './connectors/mongo';
export type { DynamoConnection } from './connectors/dynamo';
export type { KafkaConnection } from './connectors/kafka';

// Request context — per-request scope, child logger, active trace
export {
  getRequestContext,
  getActiveTraceContext,
  REPLAY_HEADER,
} from './middlewares/requestContext.middleware';
export type { RequestContext } from './middlewares/requestContext.middleware';

// Sockets (WebSocket RPC + broadcast)
export { defineSocketApi } from './sockets/defineSocketApi';
export { loadSockets } from './sockets/loader';
export { HTTP_SERVER } from './runtime/server';
export type {
  SocketApi,
  SocketBus,
  SocketContext,
  SocketHandler,
  MessageSchema,
  MessageBody,
  SocketMethodFn,
  ChannelSpec,
} from './sockets/types';
export type {
  SocketTransport,
  TransportConnection,
  TransportHandle,
  TransportMountOptions,
} from './sockets/transports/types';

// Events (async pub/sub between services)
export { defineEventApi } from './events/defineEventApi';
export { defineEventHandler } from './events/defineEventHandler';
export type {
  EventApi,
  EventTopicSpec,
  EventTopicMap,
  EventBus,
  EventContext,
  EventHandlerFn,
  BoundEventHandler,
  PublishOptions,
} from './events/types';
export type {
  EventTransportProvider,
  EventTransportProducer,
  EventTransportConsumer,
  PublishMessage,
  ConsumeMessage,
  SubscribeOptions,
} from './events/transports/types';

// Peers (inter-service RPC)
export { definePeerApi } from './peers/definePeerApi';
export { defineServiceApi } from './peers/defineServiceApi';
export { mountPeerApi } from './peers/mountPeerApi';
export { PeerHttpError } from './peers/reliability';
export { CALLER_HEADER } from './peers/tracing';
export type { PeerCallEvent } from './peers/telemetry';
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
export { loadEvents } from './events/loader';
export { loadServiceApis } from './peers/servicesLoader';
export { createPeerClient } from './peers/createPeerClient';
export { buildReliabilityPolicy } from './peers/reliability';
export { buildRequestContextMiddleware } from './middlewares/requestContext.middleware';
export { default as serverProvider } from './runtime/server';
export { default as loggerProvider } from './core/logger';
export { Commands } from './runtime/commands';
export { Signals } from './runtime/signals';
