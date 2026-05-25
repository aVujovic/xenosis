import { createRequire } from 'node:module';
import type { PrismaClient } from '@prisma/client';
import { ILogger } from '../types';

// ESM-safe `require` so @prisma/client is only loaded when this class
// is actually constructed (i.e. when a service uses the single-schema
// fallback). Services with `schemas.*` bindings get Prisma through the
// schema package and never touch this class.
const require = createRequire(import.meta.url);

export default class PrismaConnection {
  private logger: ILogger;
  private prisma: PrismaClient;

  constructor({ logger, config }: { logger: any; config: any }) {
    this.logger = logger;
    const psql = config?.connectors?.psql;
    if (!psql) {
      throw new Error('connectors.psql config is required');
    }
    const writeUrl = `postgresql://${psql.username}:${psql.password}@${psql.host}:${psql.port}/${psql.database}`;

    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');

    this.prisma = new PrismaClient({
      datasources: {
        db: { url: writeUrl },
      },
    });
    this.connect();
  }

  public get prismaClient() {
    return this.prisma;
  }

  public async connect() {
    await this.prisma.$connect();
    this.logger.info('Connected to the database successfully');
  }

  public async disconnect() {
    await this.prisma.$disconnect();
    this.logger.info('Disconnected from the database successfully');
  }
}
