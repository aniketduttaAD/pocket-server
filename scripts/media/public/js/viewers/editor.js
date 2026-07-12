import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
import { EditorState } from 'https://esm.sh/@codemirror/state@6.4.1';
import { javascript } from 'https://esm.sh/@codemirror/lang-javascript@6.2.2';
import { python } from 'https://esm.sh/@codemirror/lang-python@6.1.6';
import { html } from 'https://esm.sh/@codemirror/lang-html@6.4.9';
import { css } from 'https://esm.sh/@codemirror/lang-css@6.2.1';
import { json } from 'https://esm.sh/@codemirror/lang-json@6.0.1';
import { markdown } from 'https://esm.sh/@codemirror/lang-markdown@6.2.5';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6.1.2';

const data = document.getElementById('viewer-data');
const container = document.getElementById('editor-container');
const fallback = document.getElementById('editor-fallback');
const saveBtn = document.getElementById('save-btn');
const modeView = document.getElementById('mode-view');
const modeEdit = document.getElementById('mode-edit');

if (data && container) {
  const path = data.dataset.path;
  const ext = data.dataset.ext || '.txt';
  const editable = data.dataset.editable === '1';
  let content = '';
  let view = null;
  let readOnly = true;

  function langForExt(extName) {
    const map = {
      '.js': javascript(), '.jsx': javascript(), '.ts': javascript(), '.tsx': javascript(),
      '.py': python(), '.html': html(), '.css': css(), '.json': json(), '.md': markdown(),
    };
    return map[extName] || null;
  }

  function isDark() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function useFallback(text, editing) {
    if (view) { view.destroy(); view = null; }
    container.innerHTML = '';
    fallback.hidden = false;
    fallback.value = text;
    fallback.readOnly = !editing;
    fallback.style.display = 'block';
    readOnly = !editing;
    modeView?.toggleAttribute('hidden', !editing);
    modeEdit?.toggleAttribute('hidden', editing);
    if (saveBtn) saveBtn.toggleAttribute('hidden', !editing);
  }

  function initEditor(editing) {
    readOnly = !editing;
    fallback.hidden = true;
    fallback.style.display = 'none';
    if (view) view.destroy();

    const extensions = [
      basicSetup,
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' },
      }),
    ];
    const lang = langForExt(ext);
    if (lang) extensions.push(lang);
    if (isDark()) extensions.push(oneDark);

    view = new EditorView({
      state: EditorState.create({ doc: content, extensions }),
      parent: container,
    });

    modeView?.toggleAttribute('hidden', !editing);
    modeEdit?.toggleAttribute('hidden', editing);
    if (saveBtn) saveBtn.toggleAttribute('hidden', !editing);
  }

  async function loadContent() {
    try {
      const res = await fetch(data.dataset.raw);
      content = await res.text();
    } catch (e) {
      content = fallback?.value || '';
    }
    try {
      initEditor(false);
    } catch (e) {
      useFallback(content, false);
    }
  }

  modeView?.addEventListener('click', function () {
    try { initEditor(false); } catch (e) { useFallback(content, false); }
  });
  modeEdit?.addEventListener('click', function () {
    if (!editable) return;
    try { initEditor(true); } catch (e) { useFallback(content, true); }
  });

  saveBtn?.addEventListener('click', async function () {
    const text = view ? view.state.doc.toString() : fallback?.value || '';
    saveBtn.disabled = true;
    try {
      const res = await fetch(path + '?save=1', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: text,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Save failed');
      content = text;
      (window.MediaLib || window.Media)?.toast?.('Saved successfully');
    } catch (e) {
      (window.MediaLib || window.Media)?.toast?.(e.message || 'Save failed');
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && !readOnly) {
      e.preventDefault();
      saveBtn?.click();
    }
  });

  if (saveBtn) saveBtn.toggleAttribute('hidden', true);
  loadContent();
}
