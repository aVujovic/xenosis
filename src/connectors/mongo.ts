import { createRequire } from 'node:module';
import type { MongoClient, Db } from 'mongodb';
import { ILogger } from '../types';

export interface MongoConnection {
  client: MongoClient;
  db: Db;
}

// ESM-safe `require` so the MongoDB driver is only loaded when this
// provider actually instantiates a client.
const require = createRequire(import.meta.url);

const mongoProvider = ({
  logger,
  config,
}: {
  logger: ILogger;
  config: any;
}): MongoConnection => {
  const mongoConfig = config?.connectors?.mongo;
  if (!mongoConfig?.url || !mongoConfig?.database) {
    throw new Error('connectors.mongo.{url,database} are required');
  }

  const { MongoClient } = require('mongodb') as typeof import('mongodb');

  const client = new MongoClient(mongoConfig.url, mongoConfig.options ?? {});

  client
    .connect()
    .then(() => {
      logger.info('Mongo server is connected and ready!');
    })
    .catch((err: any) => {
      logger.error(err.message || 'Mongo connection error');
      throw new Error(err.message || 'Mongo connection error');
    });

  client.on('close', () => {
    logger.warn('Mongo server connection closed!');
  });

  client.on('error', (err: any) => {
    logger.error(err.message || 'Mongo runtime error');
  });

  return { client, db: client.db(mongoConfig.database) };
};

export default mongoProvider;
