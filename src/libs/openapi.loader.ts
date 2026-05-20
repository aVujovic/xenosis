import type { Application, RequestHandler } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { OPENAPI_REGISTRY } from '../providers/server.provider.js';

interface OpenapiRouteLike {
  method: string;
  fullPath: string;
  meta?: {
    request: { in: 'query' | 'body' | 'headers' | 'params'; schema: unknown }[];
    response?: unknown;
  };
}

export interface OpenapiConfig {
  enabled?: boolean;
  /** Swagger UI path (default /docs). */
  path?: string;
  /** Spec JSON path (default /openapi.json). */
  jsonPath?: string;
  title?: string;
  version?: string;
  description?: string;
}

const toJsonSchema = (schema: unknown): Record<string, unknown> =>
  zodToJsonSchema(schema as never, { target: 'openApi3' }) as Record<string, unknown>;

/** Express `:id` → OpenAPI `{id}`. */
const toOpenapiPath = (p: string): string =>
  p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const pathParamNames = (p: string): string[] =>
  [...p.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);

/**
 * Build an OpenAPI 3.1 document from the route registry stamped onto the Express
 * app by the recording Router + server.use patch. Request bodies come from
 * `Request.Body`, query/path params from `Request.Query`/`Request.Params`, and
 * the 200 response from a route's `.returns(schema)` (generic object otherwise).
 */
export function buildOpenapiDocument(
  server: Application,
  config: OpenapiConfig & { name?: string },
): Record<string, unknown> {
  const registry =
    ((server as unknown as Record<symbol, OpenapiRouteLike[]>)[OPENAPI_REGISTRY]) ?? [];

  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of registry) {
    const openapiPath = toOpenapiPath(route.fullPath);
    const verb = route.method.toLowerCase();
    const operation: Record<string, unknown> = {
      responses: {
        '200': route.meta?.response
          ? {
              description: 'OK',
              content: { 'application/json': { schema: toJsonSchema(route.meta.response) } },
            }
          : { description: 'OK' },
      },
    };

    const parameters: Record<string, unknown>[] = [];
    const declaredParams = new Set<string>();

    for (const req of route.meta?.request ?? []) {
      if (req.in === 'body') {
        operation.requestBody = {
          required: true,
          content: { 'application/json': { schema: toJsonSchema(req.schema) } },
        };
      } else if (req.in === 'query' || req.in === 'params') {
        const json = toJsonSchema(req.schema) as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        const required = new Set(json.required ?? []);
        for (const [name, prop] of Object.entries(json.properties ?? {})) {
          parameters.push({
            name,
            in: req.in === 'params' ? 'path' : 'query',
            required: req.in === 'params' ? true : required.has(name),
            schema: prop,
          });
          if (req.in === 'params') declaredParams.add(name);
        }
      }
    }

    // Path params present in the URL but not covered by a Request.Params schema.
    for (const name of pathParamNames(route.fullPath)) {
      if (!declaredParams.has(name)) {
        parameters.push({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        });
      }
    }

    if (parameters.length > 0) operation.parameters = parameters;

    paths[openapiPath] ??= {};
    paths[openapiPath]![verb] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: config.title ?? config.name ?? 'Xenosis service',
      version: config.version ?? '1.0.0',
      ...(config.description ? { description: config.description } : {}),
    },
    paths,
  };
}

/** Minimal Swagger UI page that loads the bundle from a CDN and points at the spec. */
export function swaggerUiHtml(jsonPath: string, title: string): RequestHandler {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(jsonPath)},
      dom_id: '#swagger-ui',
    });
  </script>
</body>
</html>`;
  return (_req, res) => {
    res.type('html').send(html);
  };
}

/**
 * Mount `/openapi.json` and the Swagger UI page on the server. Called from
 * xenosisBootstrap AFTER controllers are loaded (so the registry is complete)
 * and BEFORE commands.start() (so it lands before the error handler).
 */
export function mountOpenapi(
  server: Application,
  config: OpenapiConfig & { name?: string },
): { jsonPath: string; uiPath: string } {
  const jsonPath = config.jsonPath ?? '/openapi.json';
  const uiPath = config.path ?? '/docs';
  const doc = buildOpenapiDocument(server, config);

  server.get(jsonPath, (_req, res) => {
    res.json(doc);
  });
  server.get(uiPath, swaggerUiHtml(jsonPath, config.title ?? config.name ?? 'Xenosis'));

  return { jsonPath, uiPath };
}
