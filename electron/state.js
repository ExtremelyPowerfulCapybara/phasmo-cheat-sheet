'use strict';

const TICK_MS = 100;

const DURATIONS = {
  smudge:   90000,
  cooldown: 25000,
  hunt:     60000,
};

const timers = {
  smudge:   { running: false, remaining: DURATIONS.smudge,   duration: DURATIONS.smudge,   interval: null },
  cooldown: { running: false, remaining: DURATIONS.cooldown, duration: DURATIONS.cooldown, interval: null },
  hunt:     { running: false, remaining: DURATIONS.hunt,     duration: DURATIONS.hunt,     interval: null },
};

let broadcastFn = null;

function broadcast(channel, data) {
  if (broadcastFn) broadcastFn(channel, data);
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function stopTimer(id) {
  const t = timers[id];
  if (t.interval) { clearInterval(t.interval); t.interval = null; }
  t.running = false;
  broadcast('timer-update', { id, value: formatMs(t.remaining), running: false });
}

function startTimer(id) {
  const t = timers[id];
  t.running = true;
  broadcast('timer-update', { id, value: formatMs(t.remaining), running: true });
  t.interval = setInterval(() => {
    t.remaining -= TICK_MS;
    if (t.remaining <= 0) {
      t.remaining = 0;
      stopTimer(id);
      broadcast('play-audio', { id, event: 'ended' });
      return;
    }
    if (t.remaining <= 10000 && (t.remaining + TICK_MS) > 10000) {
      broadcast('play-audio', { id, event: 'warning' });
    }
    broadcast('timer-update', { id, value: formatMs(t.remaining), running: true });
  }, TICK_MS);
}

function toggleTimer(id) {
  if (!timers[id]) return;
  const t = timers[id];
  if (t.running) {
    stopTimer(id);
  } else {
    t.remaining = t.duration;
    startTimer(id);
  }
}

function resetAll() {
  for (const id of Object.keys(timers)) {
    if (timers[id].interval) { clearInterval(timers[id].interval); timers[id].interval = null; }
    timers[id].running   = false;
    timers[id].remaining = timers[id].duration;
    broadcast('timer-update', { id, value: formatMs(timers[id].duration), running: false });
  }
  broadcast('reset-all', {});
}

function setDuration(id, ms) {
  if (!timers[id]) return;
  timers[id].duration = ms;
  if (!timers[id].running) timers[id].remaining = ms;
}

function setBroadcast(fn) {
  broadcastFn = fn;
}

module.exports = { toggleTimer, resetAll, setDuration, setBroadcast };
