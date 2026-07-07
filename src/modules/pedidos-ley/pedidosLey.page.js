function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPedidosSinLiberacionPage({ user } = {}) {
  const username = escapeHtml(user?.nombre || user?.correo || 'Admin');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pedidos sin liberacion</title>
  <style>
    :root {
      --bg:#07111d; --panel:rgba(11,18,32,.92); --panel2:rgba(18,28,48,.92); --line:rgba(148,163,184,.18);
      --text:#e7effc; --muted:#93a4bd; --accent:#67d391; --accent2:#60a5fa; --danger:#f87171; --warn:#fbbf24;
    }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Segoe UI, Aptos, sans-serif; color:var(--text);
      background: radial-gradient(circle at top left, rgba(96,165,250,.16), transparent 35%), radial-gradient(circle at top right, rgba(103,211,145,.14), transparent 30%), linear-gradient(180deg, #06101d, #0b1322 42%, #050a12); }
    .wrap { max-width: 1700px; margin:0 auto; padding:24px; }
    .status { position:sticky; top:12px; z-index:40; padding:14px 16px; margin-bottom:16px; border-radius:14px; border:1px solid var(--line); background:rgba(255,255,255,.05); backdrop-filter: blur(14px); color:var(--muted); white-space:pre-wrap; }
    .status.ok { color:#bbf7d0; border-color:rgba(34,197,94,.35); background:rgba(34,197,94,.12); }
    .status.err { color:#fecaca; border-color:rgba(248,113,113,.35); background:rgba(248,113,113,.12); }
    .hero { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; margin-bottom:18px; }
    .hero h1 { margin:0; font-size:clamp(26px, 3vw, 42px); letter-spacing:.08em; text-transform:uppercase; }
    .hero p { margin:8px 0 0; color:var(--muted); }
    .card { background:linear-gradient(180deg,var(--panel),var(--panel2)); border:1px solid var(--line); border-radius:18px; box-shadow:0 22px 70px rgba(0,0,0,.35); }
    .toolbar { display:grid; grid-template-columns: 1.1fr 1.1fr 1fr 1fr auto; gap:12px; padding:16px; }
    .field label { display:block; margin-bottom:8px; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
    .field input, .field select, .field textarea { width:100%; border:1px solid var(--line); border-radius:12px; background:rgba(255,255,255,.04); color:var(--text); padding:12px 14px; font-size:14px; outline:none; }
    .field textarea { min-height:82px; resize:vertical; }
    .btn { border:0; border-radius:12px; padding:12px 16px; font-weight:700; cursor:pointer; transition:transform .12s ease, opacity .12s ease; }
    .btn:hover { transform:translateY(-1px); }
    .btn.primary { background:linear-gradient(135deg,var(--accent2),var(--accent)); color:#08111d; }
    .btn.secondary { background:rgba(255,255,255,.06); color:var(--text); border:1px solid var(--line); }
    .btn.danger { background:rgba(248,113,113,.16); color:#fecaca; border:1px solid rgba(248,113,113,.28); }
    .meta { display:flex; gap:10px; flex-wrap:wrap; padding:0 16px 16px; color:var(--muted); font-size:12px; }
    .pill { padding:7px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid var(--line); }
    .tabs { display:flex; gap:10px; padding:0 16px 16px; flex-wrap:wrap; }
    .tab { padding:10px 14px; border-radius:999px; border:1px solid var(--line); background:rgba(255,255,255,.05); color:var(--text); cursor:pointer; font-weight:700; }
    .tab.active { background:rgba(96,165,250,.18); border-color:rgba(96,165,250,.45); }
    .content { padding:0 16px 16px; }
    .group { margin-bottom:18px; border:1px solid var(--line); border-radius:16px; overflow:hidden; }
    .group-head { padding:12px 14px; background:rgba(255,255,255,.04); display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .group-head strong { font-size:13px; text-transform:uppercase; letter-spacing:.08em; }
    .group-head span { color:var(--muted); font-size:12px; }
    table { width:100%; border-collapse:collapse; min-width: 1280px; }
    th, td { border-top:1px solid var(--line); padding:10px 12px; vertical-align:top; font-size:13px; }
    th { position:sticky; top:0; background:rgba(7,13,24,.98); text-transform:uppercase; letter-spacing:.08em; font-size:11px; color:var(--muted); z-index:1; }
    .badge { display:inline-flex; align-items:center; gap:6px; border-radius:999px; padding:6px 10px; font-size:11px; font-weight:700; background:rgba(255,255,255,.06); border:1px solid var(--line); }
    .badge.ok { color:#b7f7d0; }
    .badge.warn { color:#fde68a; }
    .badge.err { color:#fecaca; }
    .row-title { font-weight:800; }
    .muted { color:var(--muted); }
    .files { display:grid; gap:8px; min-width:320px; }
    .file { display:grid; grid-template-columns: 18px 1fr auto; gap:10px; align-items:start; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:rgba(255,255,255,.03); }
    .file small { color:var(--muted); display:block; margin-top:3px; }
    .file a { color:#9ecbff; text-decoration:none; }
    .file a:hover { text-decoration:underline; }
    .actions-cell { display:grid; gap:8px; min-width: 200px; }
    .toolbar-actions { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; }
    .modal-backdrop { position:fixed; inset:0; background:rgba(2,6,23,.72); display:none; align-items:center; justify-content:center; padding:20px; z-index:100; }
    .modal-backdrop.open { display:flex; }
    .modal { width:min(520px,100%); background:linear-gradient(180deg, rgba(15,23,42,.98), rgba(9,17,31,.98)); border:1px solid var(--line); border-radius:18px; box-shadow:0 24px 80px rgba(0,0,0,.45); padding:20px; }
    .modal h2 { margin:0 0 10px; font-size:20px; }
    .modal p { margin:0 0 14px; color:var(--muted); line-height:1.45; }
    .modal-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
    @media (max-width: 1200px) { .toolbar { grid-template-columns: 1fr 1fr; } table { min-width: 1120px; } }
    @media (max-width: 760px) { .toolbar { grid-template-columns: 1fr; } .hero { flex-direction:column; align-items:flex-start; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="status" class="status">Cargando...</div>
    <div class="hero">
      <div>
        <h1>Pedidos sin liberacion</h1>
        <p>Administra pedidos, archivos de Drive por tienda y el remitente del correo.</p>
      </div>
      <div class="pill">Usuario: ${username}</div>
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="field">
          <label for="senderSelect">Remitente</label>
          <select id="senderSelect"></select>
        </div>
        <div class="field">
          <label for="toEmails">Correo destino</label>
          <textarea id="toEmails">SGIIREGION1@casaley.com.mx</textarea>
        </div>
        <div class="field">
          <label for="facturadorFilter">Facturador</label>
          <select id="facturadorFilter"></select>
        </div>
        <div class="field">
          <label for="searchBox">Buscar</label>
          <input id="searchBox" type="text" placeholder="pedido, tienda o descripcion">
        </div>
        <div class="toolbar-actions">
          <button class="btn primary" id="reloadBtn" type="button">Recargar</button>
          <button class="btn secondary" id="connectSenderBtn" type="button">Conectar remitente</button>
        </div>
      </div>
      <div class="meta" id="meta"></div>
      <div class="tabs">
        <button class="tab active" data-tab="pending" type="button">No enviados</button>
        <button class="tab" data-tab="sent" type="button">Enviados</button>
      </div>
      <div class="content" id="content"></div>
    </div>
  </div>

  <div id="resendBackdrop" class="modal-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="resendTitle">
      <h2 id="resendTitle">Pedido ya enviado</h2>
      <p id="resendMessage">Este pedido ya fue enviado. Si continúas, se reenviará con el remitente seleccionado.</p>
      <div class="modal-actions">
        <button class="btn secondary" id="resendCancelBtn" type="button">CANCELAR</button>
        <button class="btn danger" id="resendConfirmBtn" type="button">REENVIAR</button>
      </div>
    </div>
  </div>

  <script>
    const DEFAULT_RECIPIENTS = ['SGIIREGION1@casaley.com.mx'];
    const state = {
      rows: [],
      senderStatus: { accounts: [], activeEmail: '' },
      selectedFiles: new Map(),
      tab: 'pending',
      facturador: '',
      search: '',
      busy: new Set(),
      quota: null,
      backendBaseUrl: '',
    };

    const els = {
      status: document.getElementById('status'),
      meta: document.getElementById('meta'),
      content: document.getElementById('content'),
      senderSelect: document.getElementById('senderSelect'),
      toEmails: document.getElementById('toEmails'),
      facturadorFilter: document.getElementById('facturadorFilter'),
      searchBox: document.getElementById('searchBox'),
      reloadBtn: document.getElementById('reloadBtn'),
      connectSenderBtn: document.getElementById('connectSenderBtn'),
      resendBackdrop: document.getElementById('resendBackdrop'),
      resendMessage: document.getElementById('resendMessage'),
      resendCancelBtn: document.getElementById('resendCancelBtn'),
      resendConfirmBtn: document.getElementById('resendConfirmBtn'),
    };

    function esc(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function setStatus(message, kind) {
      els.status.className = 'status ' + (kind || '');
      els.status.textContent = message;
    }

    function setMeta(items) {
      els.meta.innerHTML = items.map((item) => '<span class="pill">' + esc(item) + '</span>').join('');
    }

    function sentState(row) {
      if (row.enviadoBool) return { kind: 'sent', label: 'ENVIADO' };
      return { kind: 'pending', label: 'PENDIENTE' };
    }

    function currentRows() {
      const facturador = String(state.facturador || '').trim();
      const search = String(state.search || '').trim().toLowerCase();
      return state.rows.filter((row) => {
        const sent = sentState(row).kind;
        if (state.tab === 'pending' && sent !== 'pending') return false;
        if (state.tab === 'sent' && sent !== 'sent') return false;
        if (facturador && String(row.facturadorId || '').trim() !== facturador) return false;
        if (search) {
          const haystack = [
            row.pedido, row.tienda, row.fecha, row.importe, row.descripcion, row.facturadorNombre,
          ].map((v) => String(v || '').toLowerCase()).join(' ');
          if (!haystack.includes(search)) return false;
        }
        return true;
      });
    }

    function groupRows(rows) {
      const groups = new Map();
      rows.forEach((row) => {
        const key = String(row.facturadorNombre || row.facturadorId || 'Sin facturador').trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      return Array.from(groups.entries()).map(([facturador, items]) => ({ facturador, items }));
    }

    function fileSelectionKey(row) {
      return String(row.pedido || '').trim();
    }

    function getSelectedFiles(row) {
      return state.selectedFiles.get(fileSelectionKey(row)) || [];
    }

    function setSelectedFiles(row, files) {
      state.selectedFiles.set(fileSelectionKey(row), Array.from(new Set(files)));
      render();
    }

    function renderFiles(row) {
      const selected = new Set(getSelectedFiles(row));
      const files = Array.isArray(row.matchedFiles) ? row.matchedFiles : [];
      if (!files.length) return '<span class="badge warn">Sin archivos</span>';
      return '<div class="files">' + files.map((file, index) => {
        const id = 'f-' + row.pedido + '-' + index;
        const key = file.id || file.relativePath || file.openUrl || file.downloadUrl || file.name;
        return '<label class="file" for="' + esc(id) + '">'
          + '<input id="' + esc(id) + '" type="checkbox" data-file-row="' + esc(row.pedido) + '" data-file-key="' + esc(key) + '"' + (selected.has(key) ? ' checked' : '') + '>'
          + '<span><span class="row-title">' + esc(file.name) + '</span><small>' + esc(file.mimeType || '') + ' · ' + esc(file.size || 0) + ' bytes</small></span>'
          + '<a href="' + esc(file.openUrl || file.downloadUrl || '#') + '" target="_blank" rel="noreferrer">Abrir</a>'
          + '</label>';
      }).join('') + '</div>';
    }

    function renderRow(row) {
      const busy = state.busy.has(row.pedido);
      const status = sentState(row);
      const buttonLabel = status.kind === 'pending' ? 'Enviar' : 'Reenviar';
      const selectedCount = getSelectedFiles(row).length;
      return '<tr data-pedido="' + esc(row.pedido) + '">'
        + '<td><span class="row-title">' + esc(row.pedido) + '</span></td>'
        + '<td>' + esc(row.tienda || row.establecimiento || '') + '</td>'
        + '<td>' + esc(row.fecha || '') + '</td>'
        + '<td>' + esc(row.importe || '') + '</td>'
        + '<td>' + esc(row.descripcion || '') + '</td>'
        + '<td><label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" data-toggle-enviado="' + esc(row.pedido) + '"' + (row.enviadoBool ? ' checked' : '') + '> <span class="badge ' + (row.enviadoBool ? 'ok' : 'warn') + '">' + esc(status.label) + '</span></label></td>'
        + '<td>' + renderFiles(row) + '</td>'
        + '<td>'
        + '<div class="actions-cell">'
        + '<button class="btn primary" type="button" data-send="' + esc(row.pedido) + '"' + (busy ? ' disabled' : '') + '>' + buttonLabel + '</button>'
        + '<button class="btn secondary" type="button" data-select-all="' + esc(row.pedido) + '"' + (busy ? ' disabled' : '') + '>Seleccionar todos</button>'
        + '<div class="muted">' + esc(selectedCount) + ' seleccionados</div>'
        + '</div>'
        + '</td>'
        + '</tr>';
    }

    function render() {
      const rows = currentRows();
      setMeta([
        'Pedidos: ' + rows.length,
        'Remitente: ' + (state.senderStatus.activeEmail || 'sin conectar'),
        'Correo destino: ' + (els.toEmails.value || DEFAULT_RECIPIENTS.join(', ')),
        'Tab: ' + (state.tab === 'pending' ? 'No enviados' : 'Enviados'),
      ]);

      const groups = groupRows(rows);
      if (!groups.length) {
        els.content.innerHTML = '<div class="muted">No hay registros para mostrar.</div>';
        return;
      }

      els.content.innerHTML = groups.map((group) => '<section class="group">'
        + '<div class="group-head"><strong>' + esc(group.facturador) + '</strong><span>' + esc(group.items.length) + ' pedidos</span></div>'
        + '<div style="overflow:auto;">'
        + '<table><thead><tr>'
        + '<th>Pedido</th><th>Tienda</th><th>Fecha</th><th>Importe</th><th>Descripcion</th><th>Enviado</th><th>Archivos</th><th>Acciones</th>'
        + '</tr></thead><tbody>'
        + group.items.map(renderRow).join('')
        + '</tbody></table></div></section>').join('');

      els.content.querySelectorAll('[data-send]').forEach((button) => {
        button.addEventListener('click', () => {
          const pedido = button.getAttribute('data-send');
          const row = rows.find((candidate) => String(candidate.pedido || '') === pedido);
          if (row) sendRow(row);
        });
      });

      els.content.querySelectorAll('[data-select-all]').forEach((button) => {
        button.addEventListener('click', () => {
          const pedido = button.getAttribute('data-select-all');
          const row = rows.find((candidate) => String(candidate.pedido || '') === pedido);
          if (!row) return;
          const files = Array.isArray(row.matchedFiles) ? row.matchedFiles : [];
          setSelectedFiles(row, files.map((file) => file.id || file.relativePath || file.openUrl || file.downloadUrl || file.name));
        });
      });

      els.content.querySelectorAll('[data-file-row]').forEach((input) => {
        input.addEventListener('change', () => {
          const pedido = input.getAttribute('data-file-row');
          const key = input.getAttribute('data-file-key');
          const row = rows.find((candidate) => String(candidate.pedido || '') === pedido);
          if (!row) return;
          const current = new Set(getSelectedFiles(row));
          if (input.checked) current.add(key);
          else current.delete(key);
          setSelectedFiles(row, Array.from(current));
        });
      });

      els.content.querySelectorAll('[data-toggle-enviado]').forEach((input) => {
        input.addEventListener('change', async () => {
          const pedido = input.getAttribute('data-toggle-enviado');
          const row = rows.find((candidate) => String(candidate.pedido || '') === pedido);
          if (!row) return;
          try {
            await api('/api/pedidos-ley/toggle-enviado', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pedido: row.pedido, enviado: input.checked }),
            });
            row.enviadoBool = input.checked;
            setStatus('Pedido ' + row.pedido + ' actualizado.', 'ok');
            await loadRows(false);
          } catch (error) {
            setStatus(error.message || 'No se pudo actualizar el envio', 'err');
            await loadRows(false);
          }
        });
      });
    }

    function openResendConfirm(message) {
      els.resendMessage.textContent = message;
      els.resendBackdrop.classList.add('open');
      els.resendBackdrop.setAttribute('aria-hidden', 'false');
      return new Promise((resolve) => {
        const accept = () => { cleanup(); resolve(true); };
        const cancel = () => { cleanup(); resolve(false); };
        function cleanup() {
          els.resendBackdrop.classList.remove('open');
          els.resendBackdrop.setAttribute('aria-hidden', 'true');
          els.resendConfirmBtn.removeEventListener('click', accept);
          els.resendCancelBtn.removeEventListener('click', cancel);
          els.resendBackdrop.removeEventListener('click', backdropClick);
          window.removeEventListener('keydown', escapeKey);
        }
        function backdropClick(event) { if (event.target === els.resendBackdrop) cancel(); }
        function escapeKey(event) { if (event.key === 'Escape') cancel(); }
        els.resendConfirmBtn.addEventListener('click', accept);
        els.resendCancelBtn.addEventListener('click', cancel);
        els.resendBackdrop.addEventListener('click', backdropClick);
        window.addEventListener('keydown', escapeKey);
      });
    }

    async function api(url, options) {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = {};
      if (text.trim()) {
        try { data = JSON.parse(text); } catch { throw new Error('El backend no devolvio JSON valido.'); }
      }
      if (!response.ok) {
        throw new Error(data.error || ('Backend fallo (' + response.status + ')'));
      }
      return data;
    }

    async function loadRows(showStatus = true) {
      if (showStatus) setStatus('Cargando pedidos...', '');
      const [config, senderStatus, data] = await Promise.all([
        api('/api/pedidos-ley/config'),
        api('/api/pedidos-ley/sender/status'),
        api('/api/pedidos-ley/sin-liberacion?includeSent=1&refresh=1'),
      ]);

      state.rows = Array.isArray(data.rows) ? data.rows : [];
      state.senderStatus = senderStatus || { accounts: [], activeEmail: '' };
      state.backendBaseUrl = '';

      const accounts = Array.isArray(state.senderStatus.accounts) ? state.senderStatus.accounts : [];
      els.senderSelect.innerHTML = '<option value="">-- Seleccionar remitente --</option>' + accounts.map((account) => {
        return '<option value="' + esc(account.email) + '"' + (account.email === state.senderStatus.activeEmail ? ' selected' : '') + '>' + esc(account.email) + '</option>';
      }).join('');

      els.facturadorFilter.innerHTML = '<option value="">Todos</option>' + Array.from(new Map(state.rows.map((row) => [String(row.facturadorId || '').trim(), row.facturadorNombre || row.facturadorId || 'Sin facturador']))).map(([id, label]) => '<option value="' + esc(id) + '">' + esc(label) + '</option>').join('');

      if (!els.toEmails.value.trim()) {
        els.toEmails.value = (config.defaultRecipients || DEFAULT_RECIPIENTS).join(', ');
      }

      render();
      if (showStatus) setStatus('Listo. Registros: ' + state.rows.length + '.', 'ok');
    }

    async function sendRow(row) {
      const to = String(els.toEmails.value || '').trim();
      if (!to) {
        setStatus('Agrega al menos un correo destino.', 'err');
        return;
      }

      const selected = getSelectedFiles(row);
      const files = selected.length
        ? (Array.isArray(row.matchedFiles) ? row.matchedFiles.filter((file) => selected.includes(file.id || file.relativePath || file.openUrl || file.downloadUrl || file.name)) : [])
        : (Array.isArray(row.matchedFiles) ? row.matchedFiles : []);

      if (!files.length) {
        setStatus('No hay archivos visibles disponibles para enviar.', 'err');
        return;
      }

      const status = sentState(row);
      if (status.kind === 'sent') {
        const confirmed = await openResendConfirm('El pedido ' + row.pedido + ' ya fue enviado. Si continúas, se reenviará.');
        if (!confirmed) {
          setStatus('Reenvio cancelado para el pedido ' + row.pedido + '.', '');
          return;
        }
      }

      state.busy.add(row.pedido);
      render();
      setStatus((status.kind === 'sent' ? 'Reenviando' : 'Enviando') + ' pedido ' + row.pedido + '...', '');
      try {
        const result = await api('/api/pedidos-ley/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pedido: row.pedido,
            to,
            fromEmail: els.senderSelect.value,
            facturadorNombre: row.facturadorNombre || '',
            files,
            textBody: 'Se adjunta informacion para el pedido ' + row.pedido + '.',
            htmlBody: '<p>Se adjunta informacion para el pedido <strong>' + esc(row.pedido) + '</strong>.</p>',
          }),
        });

        setStatus('Pedido ' + row.pedido + ' enviado correctamente desde ' + (result?.result?.from || els.senderSelect.value || 'remitente activo') + '.', 'ok');
        await loadRows(false);
      } catch (error) {
        setStatus(error.message || 'No se pudo enviar el pedido', 'err');
      } finally {
        state.busy.delete(row.pedido);
        render();
      }
    }

    els.tabs = Array.from(document.querySelectorAll('[data-tab]'));
    els.tabs.forEach((button) => {
      button.addEventListener('click', () => {
        els.tabs.forEach((tab) => tab.classList.toggle('active', tab === button));
        state.tab = button.getAttribute('data-tab') === 'sent' ? 'sent' : 'pending';
        render();
      });
    });

    els.facturadorFilter.addEventListener('change', () => {
      state.facturador = els.facturadorFilter.value;
      render();
    });
    els.searchBox.addEventListener('input', () => {
      state.search = els.searchBox.value;
      render();
    });
    els.senderSelect.addEventListener('change', async () => {
      try {
        if (!els.senderSelect.value) return;
        await api('/api/pedidos-ley/sender/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: els.senderSelect.value }),
        });
        state.senderStatus.activeEmail = els.senderSelect.value;
        setStatus('Remitente activo: ' + els.senderSelect.value, 'ok');
      } catch (error) {
        setStatus(error.message || 'No se pudo cambiar el remitente', 'err');
      }
    });
    els.reloadBtn.addEventListener('click', () => loadRows());
    els.connectSenderBtn.addEventListener('click', () => {
      window.location.href = '/pedidos-sin-liberacion/sender/connect?next=' + encodeURIComponent('/pedidos-sin-liberacion');
    });
    loadRows().catch((error) => setStatus(error.message || 'No se pudo iniciar la pantalla', 'err'));
  </script>
</body>
</html>`;
}
