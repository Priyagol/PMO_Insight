import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { createRedis } from '../config/redis';
import { verifyAccessToken } from '../core/auth/jwt';

export const rooms = {
  user: (id: string) => `user:${id}`,
  project: (id: string) => `project:${id}`,
  department: (id: string) => `dept:${id}`,
};

let io: Server | null = null;

/**
 * Socket.IO with the Redis adapter so events reach clients connected to any API replica.
 * Every connection must present a valid access token; each socket joins its private
 * `user:<id>` room. Project/department rooms are joined in later phases after an
 * authorisation check.
 */
export async function attachSockets(httpServer: HttpServer): Promise<Server> {
  const pub = createRedis('socket-pub');
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);

  io = new Server(httpServer, {
    cors: { origin: env.APP_ORIGIN, credentials: true },
    adapter: createAdapter(pub, sub),
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    try {
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(rooms.user(userId));
    logger.debug({ userId, socketId: socket.id }, 'Socket connected');
  });

  return io;
}

/** Emits to a room; a no-op when sockets are not attached (e.g. in the worker or tests). */
export function emitTo(room: string, event: string, payload: unknown): void {
  io?.to(room).emit(event, payload);
}

export async function closeSockets(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
