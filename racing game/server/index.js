// Entry point: serves the client, exposes the REST API, runs Socket.IO multiplayer.
// One process = the whole thing (this is what Render runs).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as IOServer } from 'socket.io';

import { router as api } from './api.js';
import { attachRooms } from './rooms.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json({ limit: '256kb' }));

// Health check for Render.
app.get('/healthz', async (_req, res) => {
  let dbState = 'memory';
  if (db.isPersistent) dbState = (await db.ready().catch(() => false)) ? 'postgres' : 'postgres-error';
  res.json({ ok: true, db: dbState, uptime: process.uptime() });
});

app.use('/api', api);

// Static client. index.html is the whole game; served at "/".
// No caching of the game files: browsers must revalidate every load (ETag makes that cheap),
// otherwise students keep running a stale game.js for an hour after every deploy.
const noStore = (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate');
app.use(express.static(CLIENT_DIR, { extensions: ['html'], etag: true, lastModified: true, maxAge: 0, setHeaders: noStore }));
app.get('/', (_req, res) => { noStore(res); res.sendFile(path.join(CLIENT_DIR, 'index.html')); });

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
});
attachRooms(io);

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (client + api + multiplayer)`);
  console.log(`[server] persistence: ${db.isPersistent ? 'Neon Postgres' : 'in-memory (set DATABASE_URL for real accounts)'}`);
});
