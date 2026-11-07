import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo, pingMongo } from '../src/config/db';
import { nextKey, nextSequence } from '../src/core/idgen';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Replica set (not a standalone) so transactions behave as in production.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectMongo(replSet.getUri('arihant_test'));
});

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('MongoDB connectivity', () => {
  it('pings the database', async () => {
    await expect(pingMongo()).resolves.toBeUndefined();
  });

  it('supports multi-document transactions (replica set)', async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await nextSequence('txn-test', session);
        await nextSequence('txn-test', session);
      });
    } finally {
      await session.endSession();
    }
    expect(await nextSequence('txn-test')).toBe(3);
  });

  it('rolls back a failed transaction', async () => {
    const session = await mongoose.startSession();
    await expect(
      session.withTransaction(async () => {
        await nextSequence('rollback-test', session);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    await session.endSession();
    expect(await nextSequence('rollback-test')).toBe(1);
  });
});

describe('id generation', () => {
  it('issues unique, gap-free keys under 50 concurrent requests', async () => {
    const keys = await Promise.all(Array.from({ length: 50 }, () => nextKey('trd')));
    expect(new Set(keys).size).toBe(50);
    const numbers = keys.map((k) => Number(k.split('-')[1])).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(keys.every((k) => k.startsWith('TRD-'))).toBe(true);
  });
});
