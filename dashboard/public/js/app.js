const App = {
  sourceType: 'upload',
  autoRefreshTimer: null,
  dbPollTimer: null,
  activeTab: 'overview',
  lastDbSignature: '',
  lastNgrokEndpoint: null,
  projects: [],
  services: [],

  async api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
    });
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },

  setPageTitle(tab) {
    const titles = {
      overview: 'Overview', services: 'Services', projects: 'Projects',
      domains: 'Domains', databases: 'Databases', commands: 'Commands', settings: 'Settings',
    };
    document.getElementById('page-title').textContent = titles[tab] || tab;
  },

  initNav() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    document.getElementById('menu-btn')?.addEventListener('click', () => {
      sidebar?.classList.add('open');
      overlay?.classList.remove('hidden');
    });
    overlay?.addEventListener('click', () => {
      sidebar?.classList.remove('open');
      overlay?.classList.add('hidden');
    });

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById(`tab-${btn.dataset.tab}`);
        if (panel) panel.classList.add('active');
        App.setPageTitle(btn.dataset.tab);
        App.activeTab = btn.dataset.tab;
        App.syncDbPolling();
        if (App.activeTab === 'databases') App.loadDatabases();
        sidebar?.classList.remove('open');
        overlay?.classList.add('hidden');
      });
    });

    document.getElementById('refresh-btn').addEventListener('click', () => App.refreshAll());
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await App.api('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });

    document.getElementById('verify-all-domains')?.addEventListener('click', () => App.verifyAllDomains());
    document.getElementById('settings-backup')?.addEventListener('click', () => App.runBackup());
    document.getElementById('settings-verify-dns')?.addEventListener('click', () => App.verifyAllDomains());
  },

  syncDbPolling() {
    clearInterval(App.dbPollTimer);
    if (App.activeTab !== 'databases') return;
    App.dbPollTimer = setInterval(() => App.loadDatabases({ silent: true }), 20000);
  },

  dbSignature(data) {
    return JSON.stringify({
      ngrok: data.ngrok,
      rows: (data.stored || []).map((d) => ({
        dbname: d.dbname,
        connection_url: d.connection_url,
        local_connection_url: d.local_connection_url,
        remote_error: d.remote_error,
      })),
    });
  },

  initActions() {
    document.body.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;

      const { action, name, hostname, dbname, copy } = el.dataset;

      if (action === 'copy' && copy) {
        e.preventDefault();
        await UI.copy(copy);
        return;
      }
      if (action === 'service') {
        e.preventDefault();
        await App.serviceAction(el.dataset.op, name);
        return;
      }
      if (action === 'project') {
        e.preventDefault();
        await App.projectAction(el.dataset.op, name);
        return;
      }
      if (action === 'verify-domain' && hostname) {
        e.preventDefault();
        await App.verifyDomain(hostname);
        return;
      }
      if (action === 'delete-db' && dbname) {
        e.preventDefault();
        await App.deleteDb(dbname);
      }
    });
  },

  initWizard() {
    let step = 1;
    const showStep = (n) => {
      step = n;
      document.querySelectorAll('.wizard-step').forEach((s) => {
        s.classList.toggle('active', parseInt(s.dataset.step, 10) === n);
      });
      document.querySelectorAll('.wizard-panel').forEach((p) => {
        p.classList.toggle('active', parseInt(p.dataset.panel, 10) === n);
      });
    };
    document.querySelectorAll('.wizard-next').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (step === 1 && !document.querySelector('[name="name"]').value) {
          UI.toast('Enter a project name', 'error');
          return;
        }
        showStep(Math.min(step + 1, 3));
      });
    });
    document.querySelectorAll('.wizard-prev').forEach((btn) => {
      btn.addEventListener('click', () => showStep(Math.max(step - 1, 1)));
    });

    document.querySelectorAll('.source-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        App.sourceType = tab.dataset.source;
        document.querySelectorAll('.source-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.source-panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById(`source-${App.sourceType}`);
        if (panel) panel.classList.add('active');
      });
    });
  },

  async loadSetupStatus() {
    UI.showLoading('stats-grid');
    const data = await this.api('/api/setup/status');

    document.getElementById('sidebar-domain').textContent = data.security.baseDomain;

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card accent"><div class="label">Services online</div><div class="value">${data.summary.servicesOnline}/${data.summary.servicesTotal}</div></div>
      <div class="stat-card ${data.summary.domainsActive === data.summary.domainsTotal ? 'success' : 'warning'}"><div class="label">Domains active</div><div class="value">${data.summary.domainsActive}/${data.summary.domainsTotal}</div></div>
      <div class="stat-card"><div class="label">Projects</div><div class="value">${data.summary.projectsTotal}</div></div>
      <div class="stat-card"><div class="label">Next app port</div><div class="value">${data.summary.nextProjectPort || '-'}</div></div>`;

    const portHint = document.getElementById('port-hint');
    if (portHint) {
      portHint.textContent = `Blank port means auto-assign. Next free: ${data.summary.nextProjectPort}. Range: ${data.security.projectPortRange}. Used: ${data.security.usedPorts.join(', ') || 'none'}.`;
    }

    document.getElementById('security-checks').innerHTML = data.checks.map((c) => `
      <div class="check-item">
        <span class="check-icon ${c.ok ? 'ok' : 'fail'}">${c.ok ? '✓' : '✗'}</span>
        <div><div class="check-label">${UI.escapeHtml(c.label)}</div>${c.ok ? '' : `<div class="check-hint">${UI.escapeHtml(c.hint)}</div>`}</div>
      </div>`).join('') || UI.emptyState('No checks', '');

    document.getElementById('public-urls').innerHTML = data.publicUrls.length
      ? data.publicUrls.map((u) => `
        <div class="url-row">
          <div class="url-main">
            ${UI.badge(u.status)}
            ${UI.badge(u.accessLevel)}
            <a href="${UI.attr(u.url)}" target="_blank" rel="noopener">${UI.escapeHtml(u.hostname)}</a>
          </div>
          <button type="button" class="btn secondary small" data-action="copy" data-copy="${UI.attr(u.url)}">Copy</button>
        </div>`).join('')
      : UI.emptyState('No public URLs', 'Add domains in the Domains tab');

    document.getElementById('settings-info').innerHTML = `
      <div class="kv-row"><span class="kv-label">Environment</span><span>${data.security.isDev ? 'Development' : 'Production'}</span></div>
      <div class="kv-row"><span class="kv-label">Bind host</span><code>${UI.escapeHtml(data.security.bindHost)}</code></div>
      <div class="kv-row"><span class="kv-label">Trust proxy</span><span>${data.security.trustProxy ? 'Yes' : 'No'}</span></div>
      <div class="kv-row"><span class="kv-label">Base domain</span><span>${UI.escapeHtml(data.security.baseDomain)}</span></div>
      <div class="kv-row"><span class="kv-label">Project ports</span><span>${UI.escapeHtml(data.security.projectPortRange)}</span></div>
      <div class="kv-row"><span class="kv-label">Tunnel ID</span><span>${data.security.tunnelId || 'Not set'}</span></div>
      <div class="kv-row"><span class="kv-label">Security checks</span><span>${data.allChecksPass ? 'All pass' : 'Action needed'}</span></div>`;

    return data;
  },

  async loadHealth() {
    UI.showLoading('health-grid');
    const data = await this.api('/api/services/health/all');
    const el = document.getElementById('health-grid');
    if (!data.checks?.length) {
      el.innerHTML = UI.emptyState('No health checks', 'Add projects with ports or domain routes');
      return;
    }
    el.innerHTML = `<div class="health-pills">${data.checks.map((c) => `
      <div class="health-pill ${c.status === 'up' ? 'up' : 'down'}">
        <span class="health-dot"></span>
        <span class="health-name">${UI.escapeHtml(c.name)}</span>
        <span class="health-status">${c.status}</span>
      </div>`).join('')}</div>`;
  },

  async loadServices() {
    UI.showLoading('services-list');
    const data = await this.api('/api/services');
    this.services = data.services || [];
    const el = document.getElementById('services-list');
    const sel = document.getElementById('log-service-select');
    const pm2Sel = document.getElementById('pm2-service-select');

    if (!this.services.length) {
      el.innerHTML = UI.emptyState('No services running', 'Start dash, media, or a project via PM2');
      return;
    }

    const rows = this.services.map((s) => {
      const pub = s.domain ? `https://${s.domain.hostname}` : null;
      return `<tr>
        <td><strong>${UI.escapeHtml(s.name)}</strong></td>
        <td>${UI.badge(s.status)}</td>
        <td>${s.cpu ?? '-'}%</td>
        <td>${s.memory ? Math.round(s.memory / 1024 / 1024) + ' MB' : '-'}</td>
        <td>${s.restarts ?? 0}</td>
        <td class="row-actions">
          ${pub ? `<a class="btn small secondary" href="${UI.attr(pub)}" target="_blank" rel="noopener">Open</a>` : ''}
          <button type="button" class="btn small secondary" data-action="service" data-op="restart" data-name="${UI.attr(s.name)}">Restart</button>
          <button type="button" class="btn small secondary" data-action="service" data-op="stop" data-name="${UI.attr(s.name)}">Stop</button>
          <button type="button" class="btn small secondary" data-action="service" data-op="logs" data-name="${UI.attr(s.name)}">Logs</button>
          <button type="button" class="btn small danger" data-action="service" data-op="delete" data-name="${UI.attr(s.name)}">Delete</button>
        </td>
      </tr>`;
    }).join('');

    const cards = this.services.map((s) => `
      <div class="list-card">
        <div class="list-card-row"><strong>${UI.escapeHtml(s.name)}</strong>${UI.badge(s.status)}</div>
        <div class="list-card-row"><span class="list-card-label">CPU / Memory</span><span>${s.cpu ?? '-'}% / ${s.memory ? Math.round(s.memory / 1024 / 1024) + ' MB' : '-'}</span></div>
        <div class="row-actions">
          <button type="button" class="btn small secondary" data-action="service" data-op="restart" data-name="${UI.attr(s.name)}">Restart</button>
          <button type="button" class="btn small secondary" data-action="service" data-op="logs" data-name="${UI.attr(s.name)}">Logs</button>
        </div>
      </div>`).join('');

    el.innerHTML = UI.responsiveTable(
      ['Name', 'Status', 'CPU', 'Memory', 'Restarts', 'Actions'],
      [rows],
      () => cards
    );

    sel.innerHTML = '<option value="">Select service…</option>' +
      this.services.map((s) => `<option value="${UI.attr(s.name)}">${UI.escapeHtml(s.name)}</option>`).join('');
    pm2Sel.innerHTML = '<option value="">—</option>' +
      this.services.map((s) => `<option value="${UI.attr(s.name)}">${UI.escapeHtml(s.name)}</option>`).join('');
  },

  async serviceAction(action, name) {
    if (action === 'logs') {
      await this.loadLogs(name);
      document.getElementById('log-service-select').value = name;
      return;
    }
    if (action === 'delete' && !await UI.confirm('Delete service', `Remove PM2 service "${name}"?`)) return;
    try {
      if (action === 'delete') {
        await this.api(`/api/services/${name}`, { method: 'DELETE' });
      } else {
        await this.api(`/api/services/${action}`, { method: 'POST', body: JSON.stringify({ name }) });
      }
      UI.toast(`${action} ${name}`, 'success');
      await this.loadServices();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async loadLogs(name) {
    if (!name) return;
    document.getElementById('logs-output').textContent = 'Loading logs…';
    const data = await this.api(`/api/services/${name}/logs?lines=150`);
    document.getElementById('logs-output').textContent = data.stdout || data.stderr || data.error || 'No logs';
  },

  async loadProjects() {
    UI.showLoading('projects-list');
    const data = await this.api('/api/projects');
    this.projects = data.projects || [];
    const el = document.getElementById('projects-list');
    const cwdSel = document.getElementById('project-cwd-select');
    const baseDomain = document.getElementById('sidebar-domain')?.textContent || '';

    cwdSel.innerHTML = '<option value="">—</option>' +
      this.projects.map((p) => `<option value="${UI.attr(p.dir)}">${UI.escapeHtml(p.name)}</option>`).join('');

    if (!this.projects.length) {
      el.innerHTML = UI.emptyState('No projects yet', 'Use the wizard above to upload, clone, or create a project');
      return;
    }

    const rows = this.projects.map((p) => {
      const hostname = p.subdomain ? `${p.subdomain}.${baseDomain}` : `${p.name}.${baseDomain}`;
      const url = `https://${hostname}`;
      return `<tr>
      <td><strong>${UI.escapeHtml(p.name)}</strong></td>
      <td>${p.type}</td>
      <td>${p.port || '-'}</td>
      <td>${p.port ? `<a href="${UI.attr(url)}" target="_blank" rel="noopener">${UI.escapeHtml(hostname)}</a>` : '-'}</td>
      <td class="row-actions">
        ${p.port ? `<button type="button" class="btn small secondary" data-action="copy" data-copy="${UI.attr(url)}">Copy URL</button>` : ''}
        <button type="button" class="btn small secondary" data-action="project" data-op="install" data-name="${UI.attr(p.name)}">Install</button>
        <button type="button" class="btn small secondary" data-action="project" data-op="build" data-name="${UI.attr(p.name)}">Build</button>
        <button type="button" class="btn small" data-action="project" data-op="start" data-name="${UI.attr(p.name)}">Start</button>
        <button type="button" class="btn small danger" data-action="project" data-op="delete" data-name="${UI.attr(p.name)}">Delete</button>
      </td>
    </tr>`;
    }).join('');

    const cards = this.projects.map((p) => `
      <div class="list-card">
        <div class="list-card-row"><strong>${UI.escapeHtml(p.name)}</strong><span>${p.type}</span></div>
        <div class="list-card-row"><span class="list-card-label">Port</span><span>${p.port || '-'}</span></div>
        <div class="row-actions">
          <button type="button" class="btn small" data-action="project" data-op="start" data-name="${UI.attr(p.name)}">Start</button>
          <button type="button" class="btn small secondary" data-action="project" data-op="install" data-name="${UI.attr(p.name)}">Install</button>
          <button type="button" class="btn small danger" data-action="project" data-op="delete" data-name="${UI.attr(p.name)}">Delete</button>
        </div>
      </div>`).join('');

    el.innerHTML = UI.responsiveTable(['Name', 'Type', 'Port', 'Subdomain', 'Actions'], [rows], () => cards);
  },

  async projectAction(action, name) {
    if (action === 'delete' && !await UI.confirm('Delete project', `Remove project "${name}" and its files?`)) return;
    try {
      if (action === 'delete') {
        await this.api(`/api/projects/${name}`, { method: 'DELETE' });
      } else if (action === 'install') {
        await this.api(`/api/projects/${name}/install`, { method: 'POST', body: JSON.stringify({ preset: 'npm install' }) });
      } else {
        await this.api(`/api/projects/${name}/${action}`, { method: 'POST' });
      }
      UI.toast(`${action} ${name}`, 'success');
      await this.loadProjects();
      await this.loadServices();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async loadDomains() {
    UI.showLoading('domains-list');
    const data = await this.api('/api/domains');
    const el = document.getElementById('domains-list');

    if (!data.domains?.length) {
      el.innerHTML = UI.emptyState('No domains configured', 'Add a route above or create a project with a subdomain');
      return;
    }

    el.innerHTML = data.domains.map((d) => {
      const target = d.target || data.target;
      return `
      <div class="domain-card">
        <div class="domain-head">
          <div>
            <div class="domain-host">${UI.escapeHtml(d.hostname)}</div>
            <div class="domain-badges">${UI.badge(d.status)} ${UI.badge(d.access_level || 'public')}</div>
          </div>
          <div class="row-actions">
            <button type="button" class="btn small secondary" data-action="verify-domain" data-hostname="${UI.attr(d.hostname)}">Verify DNS</button>
            <a class="btn small secondary" href="https://${UI.attr(d.hostname)}" target="_blank" rel="noopener">Open</a>
          </div>
        </div>
        <div class="kv-row"><span class="kv-label">Mapping</span><span>${UI.escapeHtml(d.hostname)} → ${UI.escapeHtml(d.local_service || `http://127.0.0.1:${d.port}`)}</span></div>
        <div class="kv-row"><span class="kv-label">CNAME target</span><code class="mono">${UI.escapeHtml(target)}</code>
          <button type="button" class="btn secondary small" data-action="copy" data-copy="${UI.attr(target)}">Copy</button>
        </div>
      </div>`;
    }).join('');
  },

  async verifyDomain(hostname) {
    try {
      await this.api(`/api/domains/verify/${encodeURIComponent(hostname)}`);
      UI.toast(`Verified ${hostname}`, 'success');
      await this.loadDomains();
      await this.loadSetupStatus();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async verifyAllDomains() {
    try {
      await this.api('/api/domains/verify-all');
      UI.toast('Domains verified', 'success');
      await this.loadDomains();
      await this.loadSetupStatus();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async loadDatabases(options = {}) {
    const { silent = false } = options;
    const el = document.getElementById('databases-list');
    if (!el) return;

    try {
      if (!silent) UI.showLoading('databases-list');
      const data = await this.api('/api/databases');
      const signature = App.dbSignature(data);

      if (silent && signature === App.lastDbSignature) return;

      const endpoint = data.ngrok?.ok ? `${data.ngrok.host}:${data.ngrok.port}` : null;
      if (silent && endpoint && App.lastNgrokEndpoint && App.lastNgrokEndpoint !== endpoint) {
        UI.toast('ngrok restarted — remote URLs updated', 'success');
      }
      App.lastNgrokEndpoint = endpoint;
      App.lastDbSignature = signature;

      const rows = data.stored || [];
      const justCreated = (() => {
        try {
          return JSON.parse(sessionStorage.getItem('db-created') || 'null');
        } catch {
          return null;
        }
      })();

      const statusEl = document.getElementById('db-provider-status');
      if (statusEl) {
        if (!data.live?.ok) {
          statusEl.textContent = data.live?.error || 'Start PostgreSQL: pg_ctl -D ~/postgres-data start';
        } else if (data.remoteMode === 'ngrok' && data.ngrok?.ok) {
          statusEl.innerHTML = `PostgreSQL on this phone. Remote via ngrok at <code>${UI.escapeHtml(data.ngrok.host)}:${data.ngrok.port}</code> — URLs auto-update when ngrok restarts.`;
        } else if (data.remoteMode === 'ngrok') {
          statusEl.innerHTML = `PostgreSQL running. Start ngrok: <code>bash ~/pocket-server/scripts/setup-ngrok.sh</code>`;
        } else {
          statusEl.innerHTML = `Set <code>NGROK_ENABLED=true</code> in ~/dash/.env for standalone remote Postgres URLs.`;
        }
      }

      if (!rows.length) {
        el.innerHTML = UI.emptyState('No databases yet', 'Create one above — remote + local URLs appear here');
        return;
      }

      el.innerHTML = rows.map((d) => {
        const remote = d.connection_url || '';
        const local = d.local_connection_url || remote;
        const showPassword = justCreated?.dbname === d.dbname && justCreated?.password;
        return `
      <div class="domain-card db-card">
        <div class="domain-head db-card-head">
          <div>
            <div class="domain-host db-name">${UI.escapeHtml(d.dbname)}</div>
            <div class="domain-badges db-meta">
              ${UI.badge('active')}
              <span class="hint">${UI.escapeHtml(d.username)}</span>
              ${d.host ? `<span class="hint">${UI.escapeHtml(d.remote_port ? `${d.host}:${d.remote_port}` : d.host)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn small danger" data-action="delete-db" data-dbname="${UI.attr(d.dbname)}">Delete</button>
        </div>
        ${d.remote_error ? `<p class="hint" style="color:#b45309">Remote URL unavailable: ${UI.escapeHtml(d.remote_error)}</p>` : ''}
        ${showPassword ? `
        <div class="db-secret">
          <div class="db-field-main">
            <p class="db-field-label">Password (save now)</p>
            <code class="db-value">${UI.escapeHtml(justCreated.password)}</code>
          </div>
          <button type="button" class="btn secondary small" data-action="copy" data-copy="${UI.attr(justCreated.password)}">Copy</button>
        </div>` : ''}
        <div class="db-field">
          <div class="db-field-main">
            <p class="db-field-label">Remote (standalone — Mac / Vercel / anywhere)</p>
            <code class="db-value">${UI.escapeHtml(remote)}</code>
          </div>
          <button type="button" class="btn secondary small" data-action="copy" data-copy="${UI.attr(remote)}">Copy</button>
        </div>
        <div class="db-field">
          <div class="db-field-main">
            <p class="db-field-label">Local (phone apps)</p>
            <code class="db-value">${UI.escapeHtml(local)}</code>
          </div>
          <button type="button" class="btn secondary small" data-action="copy" data-copy="${UI.attr(local)}">Copy</button>
        </div>
      </div>`;
      }).join('');
    } catch (e) {
      el.innerHTML = UI.emptyState('Failed to load databases', e.message);
      UI.toast(e.message, 'error');
    }
  },

  async deleteDb(dbname) {
    if (!await UI.confirm('Delete database', `Drop database "${dbname}"? This cannot be undone.`)) return;
    try {
      await this.api(`/api/databases/${dbname}`, { method: 'DELETE' });
      UI.toast(`Deleted ${dbname}`, 'success');
      await this.loadDatabases();
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async loadPresets() {
    const data = await this.api('/api/terminal/presets');
    document.getElementById('preset-select').innerHTML =
      data.commands.map((c) => `<option value="${UI.attr(c)}">${UI.escapeHtml(c)}</option>`).join('');
  },

  async runBackup() {
    try {
      const result = await this.api('/api/setup/backup', { method: 'POST' });
      UI.toast(result.ok ? 'Backup started' : (result.error || 'Backup failed'), result.ok ? 'success' : 'error');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  },

  async refreshAll() {
    document.getElementById('refresh-indicator').textContent = 'Refreshing…';
    try {
      await Promise.all([
        this.loadSetupStatus(),
        this.loadHealth(),
        this.loadServices(),
        this.loadProjects(),
        this.loadDomains(),
        this.loadDatabases(),
      ]);
    } catch (e) {
      UI.toast(e.message, 'error');
    }
    document.getElementById('refresh-indicator').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  },

  bindForms() {
    document.getElementById('project-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      try {
        if (App.sourceType === 'git' && body.gitUrl) {
          await App.api('/api/projects/clone', { method: 'POST', body: JSON.stringify(body) });
        } else if (App.sourceType === 'upload' && fd.get('archive')?.size) {
          await App.api('/api/projects/upload', { method: 'POST', body: fd });
        } else {
          await App.api('/api/projects/create', { method: 'POST', body: JSON.stringify(body) });
        }
        UI.toast('Project created', 'success');
        e.target.reset();
        App.sourceType = 'upload';
        await App.loadProjects();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    });

    document.getElementById('domain-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await App.api('/api/domains/add', {
          method: 'POST',
          body: JSON.stringify({
            hostname: fd.get('hostname'),
            port: fd.get('port') || undefined,
            serviceName: fd.get('serviceName') || fd.get('hostname'),
          }),
        });
        UI.toast('Domain added', 'success');
        e.target.reset();
        await App.loadDomains();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    });

    document.getElementById('db-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const result = await App.api('/api/databases/create', {
          method: 'POST',
          body: JSON.stringify(Object.fromEntries(fd.entries())),
        });
        sessionStorage.setItem('db-created', JSON.stringify({
          dbname: result.dbname,
          password: result.password,
          ts: Date.now(),
        }));
        UI.toast('Database created — copy URLs below', 'success');
        e.target.reset();
        await App.loadDatabases();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    });

    document.getElementById('terminal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const result = await App.api('/api/terminal/run', {
          method: 'POST',
          body: JSON.stringify({ preset: fd.get('preset'), cwd: fd.get('cwd') || undefined }),
        });
        document.getElementById('terminal-output').textContent =
          result.stdout || result.stderr || result.error || JSON.stringify(result, null, 2);
      } catch (err) {
        document.getElementById('terminal-output').textContent = err.message;
      }
    });

    document.getElementById('pm2-restart-btn').addEventListener('click', async () => {
      const serviceName = document.getElementById('pm2-service-select').value;
      if (!serviceName) { UI.toast('Select a service', 'error'); return; }
      try {
        const result = await App.api('/api/terminal/run', {
          method: 'POST',
          body: JSON.stringify({ action: 'pm2-restart', serviceName }),
        });
        document.getElementById('terminal-output').textContent =
          result.stdout || result.stderr || result.error || 'Restarted';
        UI.toast(`Restarted ${serviceName}`, 'success');
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    });

    document.getElementById('project-cwd-select').addEventListener('change', (e) => {
      document.getElementById('cwd-input').value = e.target.value;
    });

    document.getElementById('log-service-select').addEventListener('change', (e) => {
      if (e.target.value) App.loadLogs(e.target.value);
    });

    document.getElementById('auto-refresh')?.addEventListener('change', (e) => {
      clearInterval(App.autoRefreshTimer);
      if (e.target.checked) {
        App.autoRefreshTimer = setInterval(() => App.loadServices(), 15000);
      }
    });
  },

  async init() {
    try {
      await App.api('/api/auth/me');
    } catch {
      window.location.href = '/login.html';
      return;
    }
    App.initNav();
    App.initActions();
    App.initWizard();
    App.bindForms();
    await App.loadPresets();
    await App.refreshAll();
    App.syncDbPolling();
  },
};

App.init();
