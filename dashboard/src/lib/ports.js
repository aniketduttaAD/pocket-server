const config = require('../config');
const db = require('./db');
const { sanitizePort } = require('./shell');

function getUsedPorts(exclude = {}) {
  const projects = db.prepare('SELECT * FROM projects ORDER BY name').all();
  const domains = db.prepare('SELECT * FROM domains ORDER BY hostname').all();
  const used = new Set(config.projects.reservedPorts);

  for (const project of projects) {
    if (exclude.projectName && project.name === exclude.projectName) continue;
    if (project.port) used.add(Number(project.port));
  }

  for (const domain of domains) {
    if (exclude.hostname && domain.hostname === exclude.hostname) continue;
    if (exclude.serviceName && domain.service_name === exclude.serviceName) continue;
    if (domain.port) used.add(Number(domain.port));
  }

  return used;
}

function assertPortInProjectRange(port) {
  if (port < config.projects.portStart || port > config.projects.portEnd) {
    throw new Error(
      `Port ${port} is outside project range ${config.projects.portStart}-${config.projects.portEnd}`
    );
  }
}

function assertPortAvailable(port, exclude = {}) {
  const safePort = sanitizePort(port);
  assertPortInProjectRange(safePort);

  const used = getUsedPorts(exclude);
  if (used.has(safePort)) {
    throw new Error(`Port ${safePort} is already allocated`);
  }

  return safePort;
}

function nextAvailablePort(exclude = {}) {
  const used = getUsedPorts(exclude);
  for (let port = config.projects.portStart; port <= config.projects.portEnd; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new Error(`No free project ports in ${config.projects.portStart}-${config.projects.portEnd}`);
}

function allocateProjectPort(inputPort, exclude = {}) {
  if (inputPort !== undefined && inputPort !== null && String(inputPort).trim() !== '') {
    return assertPortAvailable(inputPort, exclude);
  }
  return nextAvailablePort(exclude);
}

module.exports = {
  getUsedPorts,
  assertPortAvailable,
  nextAvailablePort,
  allocateProjectPort,
};
