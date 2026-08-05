'use strict';

function stripTrailingSlashes(url) {
  return url.replace(/\/+$/, '');
}

// path stays same-origin-relative when no serverUrl is configured — this is
// the browser-fallback case, where the page is served by the same host it
// needs to call. When serverUrl is set (the bundled Electron app, loaded via
// file://, has no meaningful "same origin" for these calls), it's joined in.
function buildApiUrl(path, serverUrl) {
  if (!serverUrl) return path;
  return stripTrailingSlashes(serverUrl) + path;
}

// Same idea for WebSocket URLs, but there's no "relative ws:" concept, so the
// caller must supply a fallbackOrigin (window.location's protocol+host) for
// the no-serverUrl case instead of leaving the URL relative.
function buildWsUrl(path, serverUrl, fallbackOrigin) {
  const base = serverUrl || fallbackOrigin;
  if (!base) throw new Error('buildWsUrl: no serverUrl or fallbackOrigin available');
  const wsBase = base.replace(/^http/, 'ws');
  return stripTrailingSlashes(wsBase) + path;
}

module.exports = { buildApiUrl, buildWsUrl };
