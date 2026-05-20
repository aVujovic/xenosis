import type { Response as ExpressResponse } from 'express';

export type Headers = Map<string, string> | Record<string, string>;

export class Response {
  status: number;
  headers: Headers;
  body: unknown;

  constructor(status: number, body: unknown = {}, headers: Headers = {}) {
    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  apply(res: ExpressResponse): void {
    if (this.headers instanceof Map) {
      for (const [name, value] of this.headers.entries()) {
        res.setHeader(name, value);
      }
    } else {
      for (const [name, value] of Object.entries(this.headers)) {
        res.setHeader(name, value as string);
      }
    }

    res.status(this.status).send(this.body);
  }
}

export const StatusName = {
  100: 'Continue',
  101: 'SwitchingProtocols',
  103: 'Checkpoint',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'NonAuthoritativeInformation',
  204: 'NoContent',
  205: 'ResetContent',
  206: 'PartialContent',
  207: 'MultiStatus',
  300: 'MultipleChoices',
  301: 'MovedPermanently',
  302: 'Found',
  303: 'SeeOther',
  304: 'NotModified',
  307: 'TemporaryRedirect',
  308: 'ResumeIncomplete',
  400: 'BadRequest',
  401: 'Unauthorized',
  402: 'PaymentRequired',
  403: 'Forbidden',
  404: 'NotFound',
  405: 'MethodNotAllowed',
  406: 'NotAcceptable',
  407: 'ProxyAuthenticationRequired',
  408: 'RequestTimeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'LengthRequired',
  412: 'PreconditionFailed',
  413: 'RequestEntityTooLarge',
  414: 'RequestUriTooLong',
  415: 'UnsupportedMediaType',
  416: 'RequestedRangeNotSatisfiable',
  417: 'ExpectationFailed',
  418: 'ImATeapot',
  421: 'MisdirectedRequest',
  422: 'UnprocessableEntity',
  423: 'Locked',
  424: 'FailedDependency',
  426: 'UpgradeRequired',
  428: 'PreconditionRequired',
  429: 'TooManyRequests',
  431: 'RequestHeaderFieldsTooLarge',
  451: 'UnavailableForLegalReasons',
  500: 'InternalServerError',
  501: 'NotImplemented',
  502: 'BadGateway',
  503: 'ServiceUnavailable',
  504: 'GatewayTimeout',
  505: 'HTTPVersionNotSupported',
  511: 'NetworkAuthenticationRequired',
} as const;

export const StatusCode = {
  Continue: 100,
  SwitchingProtocols: 101,
  Checkpoint: 103,
  OK: 200,
  Created: 201,
  Accepted: 202,
  NonAuthoritativeInformation: 203,
  NoContent: 204,
  ResetContent: 205,
  PartialContent: 206,
  MultiStatus: 207,
  MultipleChoices: 300,
  MovedPermanently: 301,
  Found: 302,
  SeeOther: 303,
  NotModified: 304,
  SwitchProxy: 306,
  TemporaryRedirect: 307,
  ResumeIncomplete: 308,
  BadRequest: 400,
  Unauthorized: 401,
  PaymentRequired: 402,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  NotAcceptable: 406,
  ProxyAuthenticationRequired: 407,
  RequestTimeout: 408,
  Conflict: 409,
  Gone: 410,
  LengthRequired: 411,
  PreconditionFailed: 412,
  RequestEntityTooLarge: 413,
  RequestUriTooLong: 414,
  UnsupportedMediaType: 415,
  RequestedRangeNotSatisfiable: 416,
  ExpectationFailed: 417,
  ImATeapot: 418,
  MisdirectedRequest: 421,
  UnprocessableEntity: 422,
  Locked: 423,
  FailedDependency: 424,
  UpgradeRequired: 426,
  PreconditionRequired: 428,
  TooManyRequests: 429,
  RequestHeaderFieldsTooLarge: 431,
  UnavailableForLegalReasons: 451,
  InternalServerError: 500,
  NotImplemented: 501,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
  HTTPVersionNotSupported: 505,
  NetworkAuthenticationRequired: 511,
} as const;

interface ResponseFactory {
  (body?: unknown, headers?: Headers): Response;
  valueOf(): number;
  toString(): string;
}

const Factory = (statusCode: number): ResponseFactory => {
  const factory = ((
    body: unknown = StatusName[statusCode as keyof typeof StatusName],
    headers?: Headers,
  ) => new Response(statusCode, body, headers ?? {})) as ResponseFactory;

  factory.valueOf = () => statusCode;
  factory.toString = () => StatusName[statusCode as keyof typeof StatusName];

  return factory;
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Response {
  export const Continue = Factory(100);
  export const SwitchingProtocols = Factory(101);
  export const Checkpoint = Factory(103);
  export const OK = Factory(200);
  export const Created = Factory(201);
  export const Accepted = Factory(202);
  export const NonAuthoritativeInformation = Factory(203);
  export const NoContent = Factory(204);
  export const ResetContent = Factory(205);
  export const PartialContent = Factory(206);
  export const MultiStatus = Factory(207);
  export const MultipleChoices = Factory(300);
  export const MovedPermanently = Factory(301);
  export const Found = Factory(302);
  export const SeeOther = Factory(303);
  export const NotModified = Factory(304);
  export const TemporaryRedirect = Factory(307);
  export const ResumeIncomplete = Factory(308);
  export const BadRequest = Factory(400);
  export const Unauthorized = Factory(401);
  export const PaymentRequired = Factory(402);
  export const Forbidden = Factory(403);
  export const NotFound = Factory(404);
  export const MethodNotAllowed = Factory(405);
  export const NotAcceptable = Factory(406);
  export const ProxyAuthenticationRequired = Factory(407);
  export const RequestTimeout = Factory(408);
  export const Conflict = Factory(409);
  export const Gone = Factory(410);
  export const LengthRequired = Factory(411);
  export const PreconditionFailed = Factory(412);
  export const RequestEntityTooLarge = Factory(413);
  export const RequestUriTooLong = Factory(414);
  export const UnsupportedMediaType = Factory(415);
  export const RequestedRangeNotSatisfiable = Factory(416);
  export const ExpectationFailed = Factory(417);
  export const ImATeapot = Factory(418);
  export const MisdirectedRequest = Factory(421);
  export const UnprocessableEntity = Factory(422);
  export const Locked = Factory(423);
  export const FailedDependency = Factory(424);
  export const UpgradeRequired = Factory(426);
  export const PreconditionRequired = Factory(428);
  export const TooManyRequests = Factory(429);
  export const RequestHeaderFieldsTooLarge = Factory(431);
  export const UnavailableForLegalReasons = Factory(451);
  export const InternalServerError = Factory(500);
  export const NotImplemented = Factory(501);
  export const BadGateway = Factory(502);
  export const ServiceUnavailable = Factory(503);
  export const GatewayTimeout = Factory(504);
  export const HTTPVersionNotSupported = Factory(505);
  export const NetworkAuthenticationRequired = Factory(511);
}
