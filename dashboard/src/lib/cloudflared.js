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
    .map(
      (r) =>
        `  - hostname: ${r.hostname}\n    service: http://127.0.0.1:${r.port}`
    )
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
  return runCommand('sv', ['restart', 'cloudflared'], { timeout: 30000 });
}

async function addIngressRule(hostname, port) {
  const existing = readConfig();
  const rules = existing.ingress.filter((r) => !r.fallback && r.hostname !== hostname);
  rules.push({ hostname, port });
  writeIngressRules(rules);
  const dnsResult = await routeDns(hostname);
  const restartResult = await restartTunnel();
  return { dnsResult, restartResult, rules };
}

module.exports = {
  readConfig,
  writeIngressRules,
  routeDns,
  restartTunnel,
  addIngressRule,
};
