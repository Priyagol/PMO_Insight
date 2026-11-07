import mongoose from 'mongoose';
import { logger } from './logger';

mongoose.set('strictQuery', true);
// Never let Mongoose buffer queries while disconnected: fail fast instead.
mongoose.set('bufferCommands', false);

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    autoIndex: true,
  });
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** Pings MongoDB; used by the readiness probe. */
export async function pingMongo(): Promise<void> {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== 1 || !db) throw new Error('MongoDB not connected');
  await db.admin().command({ ping: 1 });
}
