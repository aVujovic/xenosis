import { createRequire } from 'node:module';
import type RedisType from 'ioredis';
import { ILogger } from '../types';

// ESM-safe `require` so ioredis is only loaded when this provider runs.
const require = createRequire(import.meta.url);

const redisProvider = ({
  logger,
  config,
}: {
  logger: ILogger;
  config: any;
}): RedisType => {
  const redisConfig = config?.connectors?.redis;
  if (!redisConfig?.host || !redisConfig?.port) {
    throw new Error('connectors.redis.host and connectors.redis.port are required');
  }

  const { default: Redis } = require('ioredis') as typeof import('ioredis');

  const redis = new Redis({
    host: redisConfig.host,
    port: redisConfig.port,
  });

  redis
    .on('connect', () => {
      logger.info('Redis server is connected and ready!');
    })
    .on('error', (err: any) => {
      logger.error(err.message || 'Redis connection error');
      throw new Error(err.message || 'Redis connection error');
    })
    .on('reconnecting', () => {
      logger.warn('Redis server is reconnecting...');
    })
    .on('close', () => {
      logger.warn('Redis server is closed!');
    })
    .on('end', () => {
      logger.warn('Redis server is ended!');
    });

  return redis;
};

export default redisProvider;
