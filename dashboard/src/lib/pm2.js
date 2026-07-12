const { runCommand } = require('./shell');

async function listProcesses() {
  const result = await runCommand('pm2', ['jlist']);
  if (!result.ok) {
    return { ok: false, error: result.error, processes: [] };
  }
  try {
    const processes = JSON.parse(result.stdout);
    return {
      ok: true,
      processes: processes.map((p) => ({
        name: p.name,
        pid: p.pid,
        status: p.pm2_env?.status,
        cpu: p.monit?.cpu,
        memory: p.monit?.memory,
        uptime: p.pm2_env?.pm_uptime,
        restarts: p.pm2_env?.restart_time,
        cwd: p.pm2_env?.pm_cwd,
      })),
    };
  } catch {
    return { ok: false, error: 'Failed to parse PM2 output', processes: [] };
  }
}

async function startService(name, command, cwd) {
  const args = ['start', command, '--name', name];
  if (cwd) args.push('--cwd', cwd);
  return runCommand('pm2', args, { timeout: 120000 });
}

async function stopService(name) {
  return runCommand('pm2', ['stop', name]);
}

async function restartService(name) {
  return runCommand('pm2', ['restart', name]);
}

async function deleteService(name) {
  return runCommand('pm2', ['delete', name]);
}

async function getLogs(name, lines = 100) {
  return runCommand('pm2', ['logs', name, '--lines', String(lines), '--nostream'], {
    timeout: 30000,
  });
}

async function savePm2() {
  return runCommand('pm2', ['save']);
}

module.exports = {
  listProcesses,
  startService,
  stopService,
  restartService,
  deleteService,
  getLogs,
  savePm2,
};
