/**
 * DynamoDB has no schema enforcement — this file is purely conventional.
 * Add an interface for every item shape you store, and register the table
 * name in the `tables` map so consumers cannot typo it.
 */

export interface ExampleItem {
  pk: string;
  sk: string;
  name: string;
  createdAt: string;
}

export const tables = {
  example: 'example',
} as const;

export type TableName = (typeof tables)[keyof typeof tables];
