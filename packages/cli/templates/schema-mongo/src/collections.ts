import type { ObjectId } from 'mongodb';

/**
 * Define your collection document shapes here.
 * Each interface should match the shape of the documents stored in MongoDB.
 */

export interface ExampleDoc {
  _id: ObjectId;
  name: string;
  createdAt: Date;
}

/**
 * Collection name registry — keep names in one place so consumers can use them
 * without typos.
 */
export const collections = {
  example: 'example',
} as const;

export type CollectionName = (typeof collections)[keyof typeof collections];
