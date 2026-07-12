const config = require('../config');

function parseTcpPublicUrl(url) {
  if (!url) return null;
  const raw = url.replace(/^tcp:\/\//, '');
  const match = raw.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
  if (!match) return null;
  return { host: match[1], port: parseInt(match[2], 10), publicUrl: url };
}

async function fetchLiveTcpEndpoint() {
  const apiUrl = `${config.ngrok.apiUrl.replace(/\/$/, '')}/api/tunnels`;
  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { ok: false, error: `ngrok API returned ${res.status}` };
    }
    const data = await res.json();
    const tunnel = (data.tunnels || []).find((t) => t.proto === 'tcp' && t.public_url);
    if (!tunnel) {
      return { ok: false, error: 'No active ngrok TCP tunnel (run: pm2 restart ngrok-db)' };
    }
    const parsed = parseTcpPublicUrl(tunnel.public_url);
    if (!parsed) {
      return { ok: false, error: `Could not parse ngrok URL: ${tunnel.public_url}` };
    }
    return { ok: true, ...parsed, source: 'live' };
  } catch (err) {
    return { ok: false, error: err.message || 'ngrok API unreachable on 127.0.0.1:4040' };
  }
}

async function getTcpEndpoint() {
  if (config.ngrok.tcpHost && config.ngrok.tcpPort) {
    return {
      ok: true,
      host: config.ngrok.tcpHost,
      port: config.ngrok.tcpPort,
      publicUrl: `tcp://${config.ngrok.tcpHost}:${config.ngrok.tcpPort}`,
      source: 'static',
    };
  }

  if (!config.ngrok.enabled) {
    return { ok: false, error: 'ngrok is not enabled' };
  }

  return fetchLiveTcpEndpoint();
}

async function getStatus() {
  if (!config.ngrok.enabled) {
    return { enabled: false, ok: false, error: 'Set NGROK_ENABLED=true in ~/dash/.env' };
  }

  const endpoint = await getTcpEndpoint();
  return {
    enabled: true,
    ok: endpoint.ok,
    host: endpoint.host || null,
    port: endpoint.port || null,
    publicUrl: endpoint.publicUrl || null,
    source: endpoint.source || null,
    error: endpoint.error || null,
  };
}

function remoteReady(status) {
  return status.ok;
}

module.exports = {
  getTcpEndpoint,
  getStatus,
  remoteReady,
  parseTcpPublicUrl,
};
