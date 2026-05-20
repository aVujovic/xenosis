import { createRequire } from 'node:module';
import type { Pool } from 'mysql2/promise';
import { ILogger } from '../types';

// ESM-safe `require` so mysql2 is only loaded when this provider runs.
const require = createRequire(import.meta.url);

const mysqlProvider = ({
  logger,
  config,
}: {
  logger: ILogger;
  config: any;
}): Pool => {
  const mysqlConfig = config?.connectors?.mysql;
  if (
    !mysqlConfig?.host ||
    !mysqlConfig?.port ||
    !mysqlConfig?.username ||
    !mysqlConfig?.database
  ) {
    throw new Error(
      'connectors.mysql.{host,port,username,database} are required',
    );
  }

  const mysql = require('mysql2/promise') as typeof import('mysql2/promise');

  const pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.username,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    waitForConnections: true,
    connectionLimit: mysqlConfig.connectionLimit ?? 10,
    queueLimit: 0,
  });

  pool
    .getConnection()
    .then((conn) => {
      logger.info('MySQL server is connected and ready!');
      conn.release();
    })
    .catch((err: any) => {
      logger.error(err.message || 'MySQL connection error');
      throw new Error(err.message || 'MySQL connection error');
    });

  return pool;
};

export default mysqlProvider;
