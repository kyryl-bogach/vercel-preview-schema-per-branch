import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/core';
import config from './mikro-orm.config';

let orm: MikroORM | null = null;

/**
 * Gets or creates the MikroORM singleton instance.
 * Uses a singleton pattern to avoid creating multiple connections in serverless environments.
 */
export async function getORM(): Promise<MikroORM> {
  if (!orm) {
    orm = await MikroORM.init(config);
  }
  return orm;
}
