'use strict';
const state = require('./state.js');

const broadcasts = [];
state.setBroadcast((channel, data) => broadcasts.push({ channel, data }));

// Test: toggleTimer starts a timer
state.toggleTimer('smudge');
setTimeout(() => {
  const start = broadcasts.find(b => b.channel === 'timer-update' && b.data.id === 'smudge' && b.data.running);
  console.assert(start !== undefined, 'FAIL: no running timer-update broadcast on start');
  console.assert(typeof start.data.value === 'string', 'FAIL: value should be a string');

  // Test: second toggle stops the timer
  state.toggleTimer('smudge');
  const stop = broadcasts.filter(b => b.channel === 'timer-update' && b.data.id === 'smudge').pop();
  console.assert(stop.data.running === false, 'FAIL: running should be false after second toggle');

  // Test: resetAll stops all timers
  state.toggleTimer('hunt');
  state.resetAll();
  const resetBroadcast = broadcasts.find(b => b.channel === 'reset-all');
  console.assert(resetBroadcast !== undefined, 'FAIL: reset-all not broadcast');

  // Test: setDuration changes timer length
  state.setDuration('cooldown', 5000);
  state.toggleTimer('cooldown');
  const cooldownStart = broadcasts.filter(b => b.channel === 'timer-update' && b.data.id === 'cooldown' && b.data.running).pop();
  console.assert(cooldownStart !== undefined, 'FAIL: cooldown did not start');

  console.log('All state.js tests passed');
  process.exit(0);
}, 200);
