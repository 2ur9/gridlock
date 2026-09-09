// REST API: class codes, student login, profile, lap submission, leaderboards.
// Mounted under /api by server/index.js.

import express from 'express';
import { db } from './db.js';

export const router = express.Router();

// Rough lower bounds for a *legal* lap, in ms, keyed by trackId then mode.
// Anything faster than this is rejected as a physics bug / cheat / wrong-track submission.
// The circuits are modelled at roughly half real-world scale, so these are ~half of
// real lap records and still deliberately loose — the check only catches the absurd.
const LAP_FLOOR = {
  testoval:    { f1:  40_000, gt:  48_000 },
  monza:       { f1:  85_000, gt: 105_000 },
  spa:         { f1:  85_000, gt: 105_000 },
  silverstone: { f1:  70_000, gt:  85_000 },
  nurburgring: { f1:  85_000, gt: 105_000 },
  alpenring:   { f1:  50_000, gt:  62_000 },
};
const LAP_CEIL = 20 * 60_000; // 20 min — clearly not a real flying lap

function cleanName(s) {
  return String(s || '').trim().slice(0, 24).replace(/[<>]/g, '');
}
function cleanCode(s) {
  return String(s || '').trim().toUpperCase().slice(0, 12).replace(/[^A-Z0-9-]/g, '');
}

const teacherKey = process.env.TEACHER_KEY || '';
function teacherOk(req) {
  if (!teacherKey) return true; // open classroom
  return req.get('x-teacher-key') === teacherKey || req.body?.teacherKey === teacherKey;
}

/* ---- class codes ---------------------------------------------------- */

router.get('/classes', async (_req, res) => {
  try {
    res.json({ classes: await db.listClasses(), persistent: db.isPersistent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/class', async (req, res) => {
  if (!teacherOk(req)) return res.status(403).json({ error: 'teacher key required' });
  const code = cleanCode(req.body?.code);
  const label = String(req.body?.label || code).slice(0, 40);
  if (code.length < 3) return res.status(400).json({ error: 'code must be at least 3 characters (A-Z, 0-9, -)' });
  try {
    res.json({ class: await db.upsertClass(code, label) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- login / profile --------------------------------------------- */

async function fullProfile(code, name) {
  const s = await db.findOrCreateStudent(code, name);
  const best = await db.bestLaps(s.id);
  return {
    id: s.id,
    classCode: s.class_code,
    name: s.name,
    livery: s.livery || db.defaultLivery(),
    career: s.career || {},
    bestLaps: best,
  };
}

router.post('/login', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = cleanName(req.body?.name);
  if (!code || !name) return res.status(400).json({ error: 'class code and name required' });
  try {
    res.json({ profile: await fullProfile(code, name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/profile', async (req, res) => {
  const code = cleanCode(req.query.code);
  const name = cleanName(req.query.name);
  if (!code || !name) return res.status(400).json({ error: 'class code and name required' });
  try {
    res.json({ profile: await fullProfile(code, name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/profile', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = cleanName(req.body?.name);
  if (!code || !name) return res.status(400).json({ error: 'class code and name required' });
  const livery = req.body?.livery && typeof req.body.livery === 'object' ? req.body.livery : undefined;
  const career = req.body?.career && typeof req.body.career === 'object' ? req.body.career : undefined;
  try {
    await db.saveProfile(code, name, { livery, career });
    res.json({ profile: await fullProfile(code, name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- laps + leaderboard ---------------------------------------- */

export function lapIsPlausible(track, mode, ms) {
  if (!Number.isFinite(ms)) return false;
  if (ms > LAP_CEIL) return false;
  const floor = LAP_FLOOR[track]?.[mode] ?? 5_000;
  return ms >= floor;
}

router.post('/lap', async (req, res) => {
  const code = cleanCode(req.body?.code);
  const name = cleanName(req.body?.name);
  const track = String(req.body?.track || '').slice(0, 24);
  const mode = String(req.body?.mode || '').slice(0, 8);
  const weather = req.body?.weather === 'wet' ? 'wet' : 'dry';
  const ms = Math.round(Number(req.body?.ms));
  if (!code || !name) return res.status(400).json({ error: 'class code and name required' });
  if (!lapIsPlausible(track, mode, ms)) {
    return res.status(422).json({ error: 'lap time rejected as implausible', floor: LAP_FLOOR[track]?.[mode] });
  }
  try {
    const s = await db.findOrCreateStudent(code, name);
    await db.submitLap(s.id, track, mode, weather, ms);
    res.json({ ok: true, bestLaps: await db.bestLaps(s.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/leaderboard', async (req, res) => {
  const track = String(req.query.track || '').slice(0, 24);
  const mode = String(req.query.mode || '').slice(0, 8);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  if (!track || !mode) return res.status(400).json({ error: 'track and mode required' });
  try {
    res.json({ leaderboard: await db.leaderboard(track, mode, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
