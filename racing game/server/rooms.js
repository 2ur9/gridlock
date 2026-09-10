// Multiplayer: room-code lobbies + a relay/authority hybrid over Socket.IO.
//
// Design (see README "Multiplayer notes"):
//  - Rooms live only in memory, keyed by a short code. No matchmaking, no DB.
//  - Each player's car physics runs on THAT player's browser. The server collects
//    every player's latest car state and rebroadcasts one combined snapshot at
//    SNAP_HZ. Clients interpolate remote cars and do soft push-apart on contact.
//  - AI opponents are simulated by the HOST's browser and travel over the wire as
//    just another set of cars in the host's snapshot ("host-authoritative AI").
//  - The server IS authoritative for: room/phase lifecycle, the race clock, the
//    start sequence, lap/standings bookkeeping, and flags. It also clamps obviously
//    impossible player positions (light anti-cheat for a classroom).
//
// This keeps the netcode small and robust without a shared physics engine. If you
// later want true server-side collisions, that's the big refactor noted in the plan.

import { lapIsPlausible } from './api.js';

const SNAP_HZ = 20;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const MAX_PLAYERS = 16;
const COUNTDOWN_MS = 5000;
const EMPTY_ROOM_GRACE_MS = 60_000;
const MAX_SPEED_MS = 130; // ~468 km/h — anything above is a bug/cheat, snap-clamp

const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]).join('');
  } while (rooms.has(code));
  return code;
}

function sanitizeSettings(s = {}) {
  const modes = ['f1', 'gt'];
  const diffs = ['easy', 'medium', 'hard', 'pro'];
  const tracks = ['testoval', 'monza', 'spa', 'silverstone', 'nurburgring', 'alpenring', 'melbourne'];
  return {
    trackId: tracks.includes(s.trackId) ? s.trackId : 'testoval',
    mode: modes.includes(s.mode) ? s.mode : 'gt',
    car: ['f1', 'gt', 'gt3', 'hyper', 'lmh'].includes(s.car) ? s.car : 'gt',
    laps: Math.min(30, Math.max(1, Math.round(s.laps) || 3)),
    aiCount: Math.min(15, Math.max(0, Math.round(s.aiCount) ?? 5)),
    aiDifficulty: diffs.includes(s.aiDifficulty) ? s.aiDifficulty : 'medium',
    weather: s.weather === 'wet' ? 'wet' : 'dry',
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    raceClock: room.phase === 'race' ? Date.now() - room.greenAt : 0,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, ready: p.ready, spectator: p.spectator,
      lap: p.lap, bestLap: p.bestLap, lastLap: p.lastLap, finished: p.finished,
      penaltyMs: p.penaltyMs, position: p.position,
    })),
  };
}

function standings(room) {
  const racers = [...room.players.values()].filter((p) => !p.spectator);
  racers.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
    if (b.lap !== a.lap) return b.lap - a.lap;
    return b.trackProgress - a.trackProgress;
  });
  racers.forEach((p, i) => { p.position = i + 1; });
  return racers.map((p) => ({
    id: p.id, name: p.name, lap: p.lap, position: p.position, trackProgress: p.trackProgress,
    bestLap: p.bestLap, lastLap: p.lastLap, finished: p.finished, penaltyMs: p.penaltyMs,
  }));
}

export function attachRooms(io) {
  io.on('connection', (socket) => {
    let roomCode = null;

    const currentRoom = () => (roomCode ? rooms.get(roomCode) : null);

    function leave() {
      const room = currentRoom();
      if (!room) return;
      room.players.delete(socket.id);
      socket.leave(room.code);
      io.to(room.code).emit('room:state', publicRoom(room));

      if (room.hostId === socket.id) {
        // migrate host to the first remaining non-spectator, else anyone
        const next = [...room.players.values()].find((p) => !p.spectator) || [...room.players.values()][0];
        if (next) {
          room.hostId = next.id;
          io.to(room.code).emit('room:host', { hostId: room.hostId });
          io.to(room.code).emit('room:state', publicRoom(room));
        }
      }
      if (room.players.size === 0) {
        room.emptySince = Date.now();
        setTimeout(() => {
          const r = rooms.get(room.code);
          if (r && r.players.size === 0 && Date.now() - r.emptySince >= EMPTY_ROOM_GRACE_MS - 50) {
            clearInterval(r.tickTimer);
            rooms.delete(r.code);
          }
        }, EMPTY_ROOM_GRACE_MS);
      }
      roomCode = null;
    }

    socket.on('room:create', (payload, ack) => {
      leave();
      const code = makeCode();
      const room = {
        code,
        hostId: socket.id,
        phase: 'lobby',
        settings: sanitizeSettings(payload?.settings),
        players: new Map(),
        greenAt: 0,
        createdAt: Date.now(),
        emptySince: 0,
        tickTimer: null,
      };
      rooms.set(code, room);
      joinRoom(room, payload?.name, false);
      room.tickTimer = setInterval(() => tick(io, room), 1000 / SNAP_HZ);
      ack?.({ ok: true, code, room: publicRoom(room) });
    });

    socket.on('room:join', (payload, ack) => {
      const code = String(payload?.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return ack?.({ ok: false, error: 'No room with that code' });
      const racers = [...room.players.values()].filter((p) => !p.spectator).length;
      const asSpectator = !!payload?.spectator || racers >= MAX_PLAYERS || room.phase === 'race' || room.phase === 'finished';
      leave();
      joinRoom(room, payload?.name, asSpectator);
      ack?.({ ok: true, code, room: publicRoom(room), spectator: asSpectator, youAreHost: room.hostId === socket.id });
    });

    function joinRoom(room, rawName, spectator) {
      roomCode = room.code;
      socket.join(room.code);
      const name = String(rawName || 'Racer').trim().slice(0, 24) || 'Racer';
      room.players.set(socket.id, {
        id: socket.id, name, spectator,
        ready: false, finished: false, finishOrder: 0,
        lap: 0, bestLap: null, lastLap: null, penaltyMs: 0,
        trackProgress: 0, position: 0,
        car: null, lastCarAt: 0,
      });
      io.to(room.code).emit('room:state', publicRoom(room));
    }

    socket.on('room:leave', () => leave());

    socket.on('room:settings', (settings) => {
      const room = currentRoom();
      if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
      room.settings = sanitizeSettings({ ...room.settings, ...settings });
      io.to(room.code).emit('room:state', publicRoom(room));
    });

    socket.on('room:ready', (v) => {
      const room = currentRoom();
      const p = room?.players.get(socket.id);
      if (!p) return;
      p.ready = !!v;
      io.to(room.code).emit('room:state', publicRoom(room));
    });

    socket.on('race:start', () => {
      const room = currentRoom();
      if (!room || room.hostId !== socket.id || room.phase === 'race') return;
      for (const p of room.players.values()) {
        p.finished = false; p.finishOrder = 0; p.lap = 0;
        p.bestLap = null; p.lastLap = null; p.penaltyMs = 0; p.trackProgress = 0;
      }
      // Assign each driver a distinct grid slot, otherwise every client places itself on pole
      // and the whole field starts stacked in the same box.
      const grid = [...room.players.values()].filter((p) => !p.spectator);
      grid.forEach((p, i) => { p.gridIndex = i; });
      room.phase = 'countdown';
      room.greenAt = Date.now() + COUNTDOWN_MS;
      io.to(room.code).emit('race:countdown', {
        greenAt: room.greenAt, settings: room.settings,
        grid: grid.map((p) => ({ id: p.id, gridIndex: p.gridIndex, name: p.name })),
      });
      io.to(room.code).emit('room:state', publicRoom(room));
      setTimeout(() => {
        if (room.phase !== 'countdown') return;
        room.phase = 'race';
        room.finishCount = 0;
        io.to(room.code).emit('race:green', { at: Date.now() });
        io.to(room.code).emit('room:state', publicRoom(room));
      }, COUNTDOWN_MS);
    });

    socket.on('race:reset-player', (targetId) => {
      const room = currentRoom();
      if (!room || room.hostId !== socket.id) return;
      io.to(targetId).emit('race:respawn');
    });

    socket.on('race:to-lobby', () => {
      const room = currentRoom();
      if (!room || room.hostId !== socket.id) return;
      room.phase = 'lobby';
      for (const p of room.players.values()) p.ready = false;
      io.to(room.code).emit('room:state', publicRoom(room));
    });

    // High-rate: a player's own car state (+ the host also sends its AI cars).
    socket.on('car:update', (msg) => {
      const room = currentRoom();
      const p = room?.players.get(socket.id);
      if (!p || !msg) return;
      // light anti-cheat: clamp absurd speeds
      const v = msg.v || [0, 0, 0];
      const speed = Math.hypot(v[0], v[1], v[2]);
      if (speed > MAX_SPEED_MS) { v[0] *= MAX_SPEED_MS / speed; v[1] *= MAX_SPEED_MS / speed; v[2] *= MAX_SPEED_MS / speed; }
      p.car = { p: msg.p, q: msg.q, v, rpm: msg.rpm | 0, gear: msg.gear | 0, steer: msg.steer || 0, car: String(msg.car || '').slice(0, 8) };
      p.trackProgress = Number(msg.progress) || 0;
      p.lastCarAt = Date.now();
      if (room.hostId === socket.id && Array.isArray(msg.ai)) room.aiCars = msg.ai.slice(0, 15);
    });

    // A client reporting one of its own completed laps.
    socket.on('lap:done', (msg) => {
      const room = currentRoom();
      const p = room?.players.get(socket.id);
      if (!p || room.phase !== 'race' || p.finished) return;
      const ms = Math.round(Number(msg?.ms));
      const valid = !!msg?.valid && lapIsPlausible(room.settings.trackId, room.settings.mode, ms);
      p.lap = Math.max(p.lap, Number(msg?.lap) || p.lap + 1);
      p.lastLap = ms;
      if (valid && (p.bestLap == null || ms < p.bestLap)) p.bestLap = ms;
      if (!valid) p.penaltyMs += 2000; // track-limits style penalty
      if (p.lap >= room.settings.laps && !p.finished) {
        p.finished = true;
        p.finishOrder = ++room.finishCount;
        io.to(room.code).emit('race:player-finished', { id: p.id, name: p.name, order: p.finishOrder });
      }
      io.to(room.code).emit('race:standings', standings(room));
      // checkered once every active racer is done (or the leader finished and a short window passes)
      const racers = [...room.players.values()].filter((x) => !x.spectator);
      if (racers.length && racers.every((x) => x.finished)) endRace(room);
    });

    socket.on('flag:incident', (msg) => {
      const room = currentRoom();
      if (!room || room.phase !== 'race') return;
      io.to(room.code).emit('flag:yellow', { at: msg?.at || null, by: socket.id, until: Date.now() + 8000 });
    });

    socket.on('chat', (text) => {
      const room = currentRoom();
      const p = room?.players.get(socket.id);
      if (!p) return;
      io.to(room.code).emit('chat', { name: p.name, text: String(text || '').slice(0, 200), at: Date.now() });
    });

    socket.on('disconnect', () => leave());

    function endRace(room) {
      if (room.phase === 'finished') return;
      room.phase = 'finished';
      io.to(room.code).emit('race:finished', { standings: standings(room), settings: room.settings });
      io.to(room.code).emit('room:state', publicRoom(room));
    }
  });

}

function tick(io, room) {
  if (room.players.size === 0) return;
  const now = Date.now();
  const cars = [];
  for (const p of room.players.values()) {
    if (p.car && now - p.lastCarAt < 3000 && !p.spectator) {
      cars.push({ id: p.id, name: p.name, ...p.car, lap: p.lap, pos: p.position });
    }
  }
  io.to(room.code).emit('snap', {
    t: now,
    phase: room.phase,
    clock: room.phase === 'race' ? now - room.greenAt : (room.phase === 'countdown' ? room.greenAt - now : 0),
    cars,
    ai: room.aiCars || [],
    standings: room.phase === 'race' || room.phase === 'finished' ? standings(room) : null,
  });
}

export const _test = { makeCode, sanitizeSettings, rooms };
