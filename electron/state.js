'use strict';

const TICK_MS = 100;

// Smudge overtime: if not stopped manually, it doesn't just end — it keeps
// counting (red, counting up) for one more full duration. spirit-warning
// fires 8s before that overtime period ends.
const OVERTIME_MS = 90000;
const OVERTIME_WARNING_AT = OVERTIME_MS - 8000;

const DURATIONS = {
  smudge:   90000,
  cooldown: 25000,
  hunt:     60000,
};

const timers = {
  smudge:   { running: false, remaining: DURATIONS.smudge,   duration: DURATIONS.smudge,   interval: null, overtime: false, overtimeElapsed: 0 },
  cooldown: { running: false, remaining: DURATIONS.cooldown, duration: DURATIONS.cooldown, interval: null, overtime: false, overtimeElapsed: 0 },
  hunt:     { running: false, remaining: DURATIONS.hunt,     duration: DURATIONS.hunt,     interval: null, overtime: false, overtimeElapsed: 0 },
};

let broadcastFn = null;

function broadcast(channel, data) {
  if (broadcastFn) broadcastFn(channel, data);
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function stopTimer(id, manual = true) {
  const t = timers[id];
  if (t.interval) { clearInterval(t.interval); t.interval = null; }
  t.running = false;
  t.overtime = false;
  t.overtimeElapsed = 0;
  if (manual) broadcast('play-audio', { id, event: 'stop' });
  broadcast('timer-update', { id, value: formatMs(t.remaining), running: false, overtime: false });
}

function playCountdown(id, n) {
  broadcast('play-audio', { id, event: 'countdown', n });
}

function startTimer(id) {
  const t = timers[id];
  t.running = true;
  t.overtime = false;
  broadcast('play-audio', { id, event: 'start' });
  broadcast('timer-update', { id, value: formatMs(t.remaining), running: true, overtime: false });
  t.interval = setInterval(() => {
    if (t.overtime) {
      const prevElapsed = t.overtimeElapsed;
      t.overtimeElapsed += TICK_MS;
      const e = t.overtimeElapsed;

      if (prevElapsed < OVERTIME_WARNING_AT && e >= OVERTIME_WARNING_AT) {
        broadcast('play-audio', { id, event: 'spirit-warning' });
      }
      // 5,4,3,2,1 countdown leading into the overtime's true end
      [5, 4, 3, 2, 1].forEach(n => {
        const at = OVERTIME_MS - n * 1000;
        if (prevElapsed < at && e >= at) playCountdown(id, n);
      });
      if (e >= OVERTIME_MS) {
        stopTimer(id, false);
        broadcast('play-audio', { id, event: 'finish' });
        return;
      }
      broadcast('timer-update', { id, value: formatMs(e), running: true, overtime: true });
      return;
    }

    const prevRemaining = t.remaining;
    t.remaining -= TICK_MS;
    const r = t.remaining;

    if (r <= 0) {
      t.remaining = 0;
      broadcast('play-audio', { id, event: id === 'hunt' ? 'ended' : 'finish' });
      if (id === 'smudge') {
        t.overtime = true;
        t.overtimeElapsed = 0;
        broadcast('timer-update', { id, value: '0:00', running: true, overtime: true });
        return;
      }
      stopTimer(id, false);
      return;
    }

    if (prevRemaining > 10000 && r <= 10000) {
      broadcast('play-audio', { id, event: id === 'cooldown' ? 'demon-cooldown' : 'warning' });
    }

    if (id === 'cooldown') {
      // mini early boundary: 3,2,1 + ding at 5s remaining
      [3, 2, 1].forEach(n => {
        const at = 5000 + n * 1000;
        if (prevRemaining > at && r <= at) playCountdown(id, n);
      });
      if (prevRemaining > 5000 && r <= 5000) {
        broadcast('play-audio', { id, event: 'finish' });
        broadcast('play-audio', { id, event: 'standard-cooldown' });
      }
      // final countdown into the true end
      [3, 2, 1].forEach(n => {
        if (prevRemaining > n * 1000 && r <= n * 1000) playCountdown(id, n);
      });
    } else if (id === 'smudge') {
      if (prevRemaining > 8000 && r <= 8000) {
        broadcast('play-audio', { id, event: 'standard-smudge' });
      }
      [5, 4, 3, 2, 1].forEach(n => {
        if (prevRemaining > n * 1000 && r <= n * 1000) playCountdown(id, n);
      });
    }

    broadcast('timer-update', { id, value: formatMs(r), running: true, overtime: false });
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
    timers[id].running         = false;
    timers[id].remaining       = timers[id].duration;
    timers[id].overtime        = false;
    timers[id].overtimeElapsed = 0;
    broadcast('timer-update', { id, value: formatMs(timers[id].duration), running: false, overtime: false });
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
