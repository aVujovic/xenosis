import { createRequire } from 'node:module';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ILogger } from '../types';

export interface DynamoConnection {
  client: DynamoDBClient;
  doc: DynamoDBDocumentClient;
}

// ESM-safe `require` so we can lazy-load AWS SDK only when the factory runs.
const require = createRequire(import.meta.url);

/**
 * AWS SDK is heavy (~5MB of JS). Importing it eagerly delays every service's
 * boot even when DynamoDB isn't used. Top-level imports here are types only
 * (erased at runtime); the SDK is `require()`d the first time the factory
 * actually needs to build a client.
 */
const dynamoProvider = ({
  logger,
  config,
}: {
  logger: ILogger;
  config: any;
}): DynamoConnection => {
  const dynamoConfig = config?.connectors?.dynamo;
  if (!dynamoConfig?.region) {
    throw new Error('connectors.dynamo.region is required');
  }

  // Lazy require — pulls AWS SDK into the runtime graph only on first use.
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb') as typeof import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb') as typeof import('@aws-sdk/lib-dynamodb');

  const client = new DynamoDBClient({
    region: dynamoConfig.region,
    ...(dynamoConfig.endpoint ? { endpoint: dynamoConfig.endpoint } : {}),
    ...(dynamoConfig.accessKeyId && dynamoConfig.secretAccessKey
      ? {
          credentials: {
            accessKeyId: dynamoConfig.accessKeyId,
            secretAccessKey: dynamoConfig.secretAccessKey,
          },
        }
      : {}),
  });

  const doc = DynamoDBDocumentClient.from(client);

  logger.info(
    `DynamoDB client ready (region=${dynamoConfig.region}${
      dynamoConfig.endpoint ? `, endpoint=${dynamoConfig.endpoint}` : ''
    })`,
  );

  return { client, doc };
};

export default dynamoProvider;
