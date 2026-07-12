const UI = {
  toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast toast-${type}`;
    el.classList.remove('hidden');
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  },

  showLoading(id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div><span>Loading…</span></div>';
  },

  confirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      modal.classList.remove('hidden');

      const cleanup = (result) => {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const okBtn = document.getElementById('confirm-ok');
      const cancelBtn = document.getElementById('confirm-cancel');
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  },

  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      UI.toast('Copied to clipboard', 'success');
    } catch {
      UI.toast('Copy failed', 'error');
    }
  },

  escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  attr(str) {
    return UI.escapeHtml(String(str)).replace(/"/g, '&quot;');
  },

  badge(status) {
    const map = {
      online: 'online', up: 'up', active: 'active',
      stopped: 'stopped', down: 'down', error: 'error',
      pending: 'pending', unknown: 'pending',
    };
    return `<span class="badge ${map[status] || 'pending'}">${UI.escapeHtml(status || 'unknown')}</span>`;
  },

  emptyState(title, hint) {
    return `<div class="empty-state"><p class="empty-title">${UI.escapeHtml(title)}</p><p class="hint">${UI.escapeHtml(hint)}</p></div>`;
  },

  responsiveTable(headers, rows, cardRenderer) {
    const thead = headers.map((h) => `<th>${h}</th>`).join('');
    const tbody = rows.join('');
    const cards = cardRenderer ? cardRenderer() : '';
    return `
      <div class="table-wrap desktop-only"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>
      <div class="card-list mobile-only">${cards}</div>`;
  },
};
