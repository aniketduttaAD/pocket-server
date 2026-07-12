const fs = require('fs');
const config = require('../config');
const { runCommand } = require('./shell');

function readConfig() {
  const configPath = config.paths.cloudflaredConfig;
  if (!fs.existsSync(configPath)) {
    return { tunnel: config.tunnel.name, ingress: [] };
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return parseYamlIngress(raw);
}

function parseYamlIngress(raw) {
  const lines = raw.split('\n');
  const ingress = [];
  let inIngress = false;
  let current = null;

  for (const line of lines) {
    if (line.trim() === 'ingress:') {
      inIngress = true;
      continue;
    }
    if (!inIngress) continue;

    const hostMatch = line.match(/^\s*-\s*hostname:\s*(.+)$/);
    if (hostMatch) {
      if (current) ingress.push(current);
      current = { hostname: hostMatch[1].trim(), service: null };
      continue;
    }

    const svcMatch = line.match(/^\s*service:\s*(.+)$/);
    if (svcMatch && current) {
      current.service = svcMatch[1].trim();
    }

    const fallbackMatch = line.match(/^\s*-\s*service:\s*http_status:404\s*$/);
    if (fallbackMatch) {
      if (current) ingress.push(current);
      ingress.push({ fallback: true, service: 'http_status:404' });
      current = null;
    }
  }
  if (current) ingress.push(current);
  return { ingress };
}

function ingressEntryToRule(entry) {
  if (!entry.hostname || entry.fallback) return null;
  const svc = entry.service || '';
  if (svc.startsWith('tcp://')) {
    const m = svc.match(/:(\d+)\s*$/);
    return {
      hostname: entry.hostname,
      tcp: true,
      port: parseInt(m?.[1] || String(config.postgres.port), 10),
      service: svc,
    };
  }
  const m = svc.match(/:(\d+)\s*$/);
  return {
    hostname: entry.hostname,
    tcp: false,
    port: parseInt(m?.[1] || '80', 10),
    service: svc,
  };
}

function ruleToYaml(r) {
  if (r.tcp) {
    const port = r.port || config.postgres.port;
    return `  - hostname: ${r.hostname}\n    service: tcp://127.0.0.1:${port}`;
  }
  return `  - hostname: ${r.hostname}\n    service: http://127.0.0.1:${r.port}`;
}

function writeIngressRules(rules) {
  const configPath = config.paths.cloudflaredConfig;
  const credPath = `${config.paths.home}/.cloudflared/${config.tunnel.id}.json`;

  let header = `tunnel: ${config.tunnel.name}\n`;
  if (config.tunnel.id) {
    header += `credentials-file: ${credPath}\n`;
  }
  header += 'ingress:\n';

  const body = rules
    .filter((r) => !r.fallback)
    .map(ruleToYaml)
    .join('\n');

  const footer = '\n  - service: http_status:404\n';
  const content = header + body + footer;

  fs.mkdirSync(require('path').dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content);
  return content;
}

async function routeDns(hostname) {
  const bin = config.paths.cloudflaredBin;
  return runCommand(bin, ['tunnel', 'route', 'dns', config.tunnel.name, hostname], {
    timeout: 60000,
  });
}

async function restartTunnel() {
  const pm2 = await runCommand('pm2', ['restart', 'tunnel'], { timeout: 30000 });
  if (pm2.ok) return pm2;
  return runCommand('sv', ['restart', 'cloudflared'], { timeout: 30000 });
}

function getRulesFromConfig() {
  const existing = readConfig();
  return existing.ingress.map(ingressEntryToRule).filter(Boolean);
}

async function addIngressRule(hostname, port) {
  const rules = getRulesFromConfig().filter((r) => r.hostname !== hostname);
  rules.push({ hostname, tcp: false, port });
  writeIngressRules(rules);
  const dnsResult = await routeDns(hostname);
  const restartResult = await restartTunnel();
  return { dnsResult, restartResult, rules };
}

async function ensureDbTunnel() {
  const hostname = config.database.publicHost;
  const port = config.postgres.port;
  const rules = getRulesFromConfig();
  const hasDb = rules.some((r) => r.hostname === hostname && r.tcp);

  if (hasDb) {
    return { ok: true, hostname, port, already: true };
  }

  const merged = rules.filter((r) => r.hostname !== hostname);
  merged.push({ hostname, tcp: true, port });
  writeIngressRules(merged);
  const dnsResult = await routeDns(hostname);
  const restartResult = await restartTunnel();

  return { ok: true, hostname, port, dnsResult, restartResult };
}

function dbTunnelConfigured() {
  const hostname = config.database.publicHost;
  const rules = getRulesFromConfig();
  return rules.some((r) => r.hostname === hostname && r.tcp);
}

module.exports = {
  readConfig,
  writeIngressRules,
  routeDns,
  restartTunnel,
  addIngressRule,
  ensureDbTunnel,
  dbTunnelConfigured,
};
