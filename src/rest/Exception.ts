import { Response, StatusName } from './Response.js';

export type Headers = Map<string, string> | Record<string, string>;

const prepareError = (status: number): Error => {
  const name = (StatusName as Record<number, any>)[status];
  const error = new Error(name);

  const match = /xenosis(.*)/gi.exec(import.meta.url);
  const filePath = match?.[1];

  if (error.stack && filePath) {
    error.stack = error.stack
      .split('\n')
      .filter((line) => !line.includes(filePath))
      .join('\n');
  }

  error.name = name;
  return error;
};

export class Exception extends Error {
  status: number;
  headers: Headers;
  body: unknown;

  constructor(
    status: number,
    body: unknown = {},
    headers: Headers = {},
    error?: Error,
  ) {
    const base = error ?? prepareError(status);
    super(base.message);

    this.name = base.name;
    this.stack = base.stack ?? '';

    this.status = status;
    this.headers = headers;
    this.body = body;
  }

  apply!: (res: unknown) => void;
}

(Exception.prototype as any).apply = (Response as any).prototype.apply;

interface ExceptionFactory {
  (body?: unknown, error?: Error, headers?: Headers): Exception;
  valueOf(): number;
  toString(): string;
}

const Factory = (statusCode: number): ExceptionFactory => {
  const factory = ((body?: unknown, error?: Error, headers?: Headers) =>
    new Exception(statusCode, body, headers ?? {}, error)) as ExceptionFactory;

  factory.valueOf = () => statusCode;
  factory.toString = () =>
    (StatusName as Record<number, string>)[statusCode] ?? `${statusCode}`;

  return factory;
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Exception {
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
