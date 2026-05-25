import { asFunction, asValue, AwilixContainer } from 'awilix';
import type {
  ConnectorConfig,
  ILogger,
  SchemaBinding,
  SchemaPackage,
} from '../types';
import type { XenosisConfig } from '../config.schema';
import { importFromService } from './importFromService';

/**
 * Loads every entry in `config.schemas`, dynamically imports the referenced
 * package, validates it satisfies SchemaPackage, and registers the resulting
 * runtime client in the awilix container under the binding's cradle key.
 *
 * Convention (see SCHEMAS.md):
 *   schema package default-exports OR named-exports `{ createClient, schema }`.
 *   Connectors live in `config.connectors`; the binding references one by name.
 */
export async function loadSchemas(
  container: AwilixContainer,
  config: XenosisConfig,
  logger: ILogger,
): Promise<void> {
  const schemas: Record<string, SchemaBinding> | undefined = config?.schemas;

  // Always register schemaDisconnects in the cradle so Commands can resolve
  // it even when this service has no schemas configured. The array stays
  // empty in that case and runDisconnects() short-circuits.
  const disconnects: Array<() => Promise<void> | void> = [];
  container.register({
    schemaDisconnects: asFunction(() => disconnects).singleton(),
  });

  if (!schemas) return;

  const connectors: Record<string, ConnectorConfig> = config?.connectors ?? {};

  for (const [cradleKey, binding] of Object.entries(schemas)) {
    if (!binding?.package || !binding?.connector) {
      throw new Error(
        `schemas.${cradleKey} must declare { package, connector }`,
      );
    }

    const connector = connectors[binding.connector];
    if (!connector) {
      throw new Error(
        `schemas.${cradleKey}.connector "${binding.connector}" not found in config.connectors`,
      );
    }

    const mod = (await importFromService(binding.package)) as Partial<SchemaPackage> & {
      default?: SchemaPackage;
    };
    const pkg: SchemaPackage =
      typeof mod.createClient === 'function' ? (mod as SchemaPackage) : mod.default!;

    if (!pkg || typeof pkg.createClient !== 'function' || !pkg.schema) {
      throw new Error(
        `schemas.${cradleKey}: package "${binding.package}" does not satisfy SchemaPackage (missing createClient or schema metadata)`,
      );
    }

    const client = await pkg.createClient(connector);

    container.register({
      [cradleKey]: asValue(client),
    });

    if (typeof pkg.disconnect === 'function') {
      disconnects.push(() => pkg.disconnect!(client));
    }

    logger.info(
      `📦 Schema loaded: ${cradleKey} ← ${binding.package} (type=${pkg.schema.type}, connector=${binding.connector})`,
    );
  }
}
