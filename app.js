(() => {
  'use strict';

  const config = window.VERICORE_CONFIG || {};
  const API_BASE_URL = String(config.API_BASE_URL || '').replace(/\/$/, '');
  const CLIENT_VERSION = String(config.CLIENT_VERSION || 'web-v3.3');
  const TURNSTILE_SITEKEY = String(config.TURNSTILE_SITEKEY || '');
  const STORAGE_REPORTS = 'vericore_v33_reports';
  const STORAGE_AUDIT = 'vericore_v33_audit';
  const STORAGE_THEME = 'vericore_v3_theme';
  const LEGACY_STORAGE_KEYS = ['vericore_v3_reports', 'vericore_v3_audit', 'vericore_v32_reports', 'vericore_v32_audit'];
  const TEST_PROFILE = Object.freeze({
    fullName: 'Demo User',
    dob: '1990-01-15',
    ssn: '000-12-3456',
    email: 'demo@example.com',
    purpose: 'self_check',
    state: 'TX'
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const form = $('#verificationForm');
  const formMessage = $('#formMessage');
  const submitButton = $('#submitButton');
  const reportModal = $('#reportModal');
  const modalContent = $('#modalContent');
  const toast = $('#toast');

  let apiOnline = false;
  let apiMode = 'unknown';
  let toastTimer = null;
  let turnstileToken = '';
  let turnstileWidgetId = null;
  let turnstileReady = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function makeId() {
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      showToast('Браузер не разрешил сохранить локальную историю.');
      return false;
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch {
      return '—';
    }
  }

  function formatSsnInput(value) {
    const digits = String(value).replace(/\D/g, '').slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  function addAudit(action, detail = '') {
    const rows = readArray(STORAGE_AUDIT);
    rows.unshift({ id: makeId(), action, detail, createdAt: new Date().toISOString() });
    writeArray(STORAGE_AUDIT, rows.slice(0, 100));
    renderAudit();
  }

  function updateTurnstileStatus(message, state = '') {
    const status = $('#turnstileStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function renderTurnstile() {
    if (turnstileReady || !TURNSTILE_SITEKEY || !window.turnstile) return;

    try {
      turnstileWidgetId = window.turnstile.render('#turnstileWidget', {
        sitekey: TURNSTILE_SITEKEY,
        theme: 'auto',
        size: 'flexible',
        action: 'vericore_sandbox_verify',
        callback: token => {
          turnstileToken = String(token || '');
          turnstileReady = Boolean(turnstileToken);
          updateTurnstileStatus('Проверка пройдена. Токен действует 5 минут.', 'success');
        },
        'expired-callback': () => {
          turnstileToken = '';
          turnstileReady = false;
          updateTurnstileStatus('Токен истёк. Пройди проверку ещё раз.', 'warning');
        },
        'error-callback': () => {
          turnstileToken = '';
          turnstileReady = false;
          updateTurnstileStatus('Turnstile не загрузился. Обнови страницу.', 'error');
        }
      });
      updateTurnstileStatus('Ожидаем anti-bot проверку…');
    } catch (error) {
      console.warn('Turnstile render error:', error);
      updateTurnstileStatus('Не удалось запустить Turnstile.', 'error');
    }
  }

  function resetTurnstile() {
    turnstileToken = '';
    turnstileReady = false;
    if (window.turnstile && turnstileWidgetId !== null) {
      try {
        window.turnstile.reset(turnstileWidgetId);
        updateTurnstileStatus('Ожидаем новую anti-bot проверку…');
      } catch (error) {
        console.warn('Turnstile reset error:', error);
      }
    }
  }

  function isApiConfigured() {
    return /^https:\/\/.+/.test(API_BASE_URL) && !API_BASE_URL.includes('PASTE_YOUR_WORKER_URL_HERE');
  }

  function setApiStatus(status, mode = 'unknown', message = '') {
    apiOnline = status === 'online';
    apiMode = mode;

    const dot = $('#apiDot');
    dot.classList.remove('online', 'offline');
    if (status === 'online') dot.classList.add('online');
    if (status === 'offline') dot.classList.add('offline');

    $('#apiStatusText').textContent = status === 'online' ? `API подключён • ${mode}` : 'API не подключён';
    $('#apiCardTitle').textContent = status === 'online' ? 'Sandbox API online' : 'Sandbox API offline';
    $('#apiCardSubtitle').textContent = message || (status === 'online' ? API_BASE_URL.replace(/^https:\/\//, '') : 'Укажи URL Worker в config.js');
    $('#statApi').textContent = status === 'online' ? 'Online' : 'Offline';
    $('#statApiNote').textContent = status === 'online' ? `${mode} provider` : 'нужен Cloudflare Worker';
    $('#statMode').textContent = mode === 'sandbox' ? 'Sandbox' : mode === 'live' ? 'Live' : '—';
  }

  async function checkApi() {
    if (!isApiConfigured()) {
      setApiStatus('offline', 'unknown', 'Вставь адрес Worker в config.js');
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-VeriCore-Client': CLIENT_VERSION },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'Health check failed');
      const dbNote = data.auditDatabaseConnected ? 'D1 audit online' : 'D1 audit not connected';
      setApiStatus('online', data.mode || 'sandbox', `${API_BASE_URL.replace(/^https:\/\//, '')} • ${dbNote}`);
    } catch (error) {
      setApiStatus('offline', 'unknown', 'Worker не отвечает или CORS не настроен');
      console.warn('VeriCore API health error:', error);
    }
  }

  function switchView(viewName) {
    $$('.side-link').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
    $$('.view').forEach(view => view.classList.remove('active'));
    $(`#view-${viewName}`)?.classList.add('active');

    const titles = {
      overview: 'Обзор',
      'new-check': 'Новая проверка',
      reports: 'Отчёты',
      audit: 'Audit log'
    };
    $('#workspaceTitle').textContent = titles[viewName] || 'Workspace';

    if (viewName === 'overview') renderOverview();
    if (viewName === 'reports') renderReports();
    if (viewName === 'audit') renderAudit();

    document.querySelector('#workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fillDemoForm(openView = true) {
    if (openView) switchView('new-check');
    $('#fullName').value = TEST_PROFILE.fullName;
    $('#dob').value = TEST_PROFILE.dob;
    $('#ssn').value = TEST_PROFILE.ssn;
    $('#email').value = TEST_PROFILE.email;
    $('#purpose').value = TEST_PROFILE.purpose;
    $('#state').value = TEST_PROFILE.state;
    $('#selfCheck').checked = true;
    $('#consent').checked = true;
    $('#sandboxConfirm').checked = true;
    formMessage.textContent = '';
    formMessage.classList.remove('success');
  }

  function validatePayload(payload) {
    if (!form.checkValidity()) return 'Заполни все обязательные поля.';
    if (!payload.selfCheck || !payload.consentAccepted || !payload.sandboxConfirmed) {
      return 'Подтверди все три пункта согласия.';
    }

    if (!payload.turnstileToken) {
      return 'Сначала пройди anti-bot проверку Turnstile.';
    }

    const normalized = payload.ssn.replace(/\D/g, '');
    if (apiMode !== 'live' && normalized !== '000123456') {
      return 'В sandbox разрешён только тестовый SSN 000-12-3456.';
    }

    if (apiMode !== 'live' && (
      payload.fullName.trim().toLowerCase() !== 'demo user' ||
      payload.dob !== TEST_PROFILE.dob
    )) {
      return 'Для sandbox используй тестовый профиль Demo User / 1990-01-15.';
    }

    return '';
  }

  function makePayload(formData) {
    return {
      requestId: makeId(),
      checkType: String(formData.get('checkType') || 'identity'),
      fullName: String(formData.get('fullName') || '').trim(),
      dob: String(formData.get('dob') || ''),
      ssn: String(formData.get('ssn') || '').trim(),
      email: String(formData.get('email') || '').trim().toLowerCase(),
      purpose: String(formData.get('purpose') || ''),
      state: String(formData.get('state') || ''),
      selfCheck: $('#selfCheck').checked,
      consentAccepted: $('#consent').checked,
      sandboxConfirmed: $('#sandboxConfirm').checked,
      consentTimestamp: new Date().toISOString(),
      turnstileToken
    };
  }

  function saveReport(apiResult, checkType) {
    const report = {
      id: apiResult.reportId || makeId(),
      reference: apiResult.reference || `VC-${Date.now().toString().slice(-8)}`,
      providerMode: apiResult.providerMode || apiResult.mode || 'sandbox',
      checkType,
      subjectLabel: apiResult.subject?.label || 'Masked subject',
      dobMasked: apiResult.subject?.dobMasked || '****-**-**',
      maskedSsn: apiResult.maskedSsn || apiResult.subject?.maskedSsn || '***-**-****',
      consentReceipt: apiResult.consentReceipt || '',
      serverAuditId: apiResult.audit?.id || '',
      auditStored: apiResult.audit?.stored === true,
      identity: apiResult.identity ? {
        ...apiResult.identity,
        match: apiResult.identity.match ?? apiResult.identity.verified ?? null
      } : null,
      credit: apiResult.credit || null,
      risk: apiResult.risk || { level: 'Unknown' },
      createdAt: apiResult.createdAt || new Date().toISOString(),
      disclaimer: apiResult.disclaimer || 'Sandbox result'
    };

    const reports = readArray(STORAGE_REPORTS);
    reports.unshift(report);
    writeArray(STORAGE_REPORTS, reports.slice(0, 100));
    return report;
  }

  function clearSensitiveFields() {
    ['fullName', 'dob', 'ssn', 'email'].forEach(id => {
      const field = $(`#${id}`);
      if (field) field.value = '';
    });
  }

  async function submitVerification(event) {
    event.preventDefault();
    formMessage.textContent = '';
    formMessage.classList.remove('success');

    if (!apiOnline) {
      formMessage.textContent = 'Cloudflare Worker пока не подключён. Сначала выполни шаги из START-HERE.txt.';
      return;
    }

    const payload = makePayload(new FormData(form));
    const validationError = validatePayload(payload);
    if (validationError) {
      formMessage.textContent = validationError;
      form.reportValidity();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Проверяем…';

    const checkType = payload.checkType;
    const requestId = payload.requestId;
    let requestBody = JSON.stringify(payload);

    // Поле очищается до сетевого ответа. Значение не пишется в localStorage или журнал.
    $('#ssn').value = '';
    payload.fullName = '';
    payload.dob = '';
    payload.ssn = '';
    payload.email = '';

    try {
      const response = await fetch(`${API_BASE_URL}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-VeriCore-Client': CLIENT_VERSION,
          'X-Request-Id': requestId
        },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: requestBody
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryText = response.status === 429 && data.retryAfter
          ? ` Повтори через ${data.retryAfter} сек.`
          : '';
        throw new Error(`${data.error || `HTTP ${response.status}`}${retryText}`);
      }

      const report = saveReport(data, checkType);
      addAudit('Sandbox verification completed', `${report.reference} • ${report.maskedSsn}`);
      const auditText = report.auditStored ? ' Серверный audit сохранён в D1.' : ' D1 пока не подключена — серверный audit не сохранён.';
      formMessage.textContent = `Проверка завершена. В браузере сохранены только маски и итог.${auditText}`;
      formMessage.classList.add('success');
      clearSensitiveFields();
      resetTurnstile();
      openReport(report);
      renderOverview();
      renderReports();
    } catch (error) {
      formMessage.textContent = `Ошибка API: ${error.message}`;
      addAudit('Verification failed', 'Request rejected or unavailable');
      resetTurnstile();
    } finally {
      requestBody = '';
      submitButton.disabled = false;
      submitButton.textContent = 'Запустить sandbox-проверку';
    }
  }

  function renderOverview() {
    const reports = readArray(STORAGE_REPORTS);
    const today = new Date().toDateString();
    $('#statReports').textContent = String(reports.length);
    $('#statToday').textContent = String(reports.filter(row => new Date(row.createdAt).toDateString() === today).length);

    const container = $('#recentReports');
    if (!reports.length) {
      container.className = 'empty-state';
      container.textContent = 'Пока нет отчётов.';
      return;
    }

    container.className = '';
    container.innerHTML = reports.slice(0, 4).map(reportRowHtml).join('');
    bindReportButtons(container);
  }

  function reportRowHtml(report) {
    const identityStatus = report.identity?.match === true ? 'Match' : report.identity?.match === false ? 'No match' : '—';
    const creditScore = report.credit?.score ?? '—';
    return `
      <div class="report-row">
        <div class="report-main"><strong>${escapeHtml(report.subjectLabel || 'Masked subject')}</strong><span>${escapeHtml(report.reference)} • ${escapeHtml(report.maskedSsn)}</span></div>
        <div class="report-cell"><span>Identity</span><strong>${escapeHtml(identityStatus)}</strong></div>
        <div class="report-cell"><span>Credit</span><strong>${escapeHtml(creditScore)}</strong></div>
        <button class="report-action" type="button" data-report-id="${escapeHtml(report.id)}">Открыть</button>
      </div>`;
  }

  function renderReports() {
    const reports = readArray(STORAGE_REPORTS);
    const container = $('#reportList');
    if (!reports.length) {
      container.className = 'report-list empty-state';
      container.textContent = 'Пока нет отчётов.';
      return;
    }
    container.className = 'report-list';
    container.innerHTML = reports.map(reportRowHtml).join('');
    bindReportButtons(container);
  }

  function bindReportButtons(root) {
    $$('[data-report-id]', root).forEach(button => {
      button.addEventListener('click', () => {
        const report = readArray(STORAGE_REPORTS).find(row => row.id === button.dataset.reportId);
        if (report) openReport(report);
      });
    });
  }

  function renderAudit() {
    const rows = readArray(STORAGE_AUDIT);
    const container = $('#auditList');
    if (!rows.length) {
      container.className = 'audit-list empty-state';
      container.textContent = 'Пока нет событий.';
      return;
    }
    container.className = 'audit-list';
    container.innerHTML = rows.map(row => `
      <div class="audit-row">
        <span>${escapeHtml(formatDate(row.createdAt))}</span>
        <div><strong>${escapeHtml(row.action)}</strong><p>${escapeHtml(row.detail || '—')}</p></div>
      </div>`).join('');
  }

  function openReport(report) {
    const identity = report.identity || {};
    const credit = report.credit || {};
    const matchText = identity.match === true ? 'Matched' : identity.match === false ? 'Not matched' : 'Not requested';
    const deathText = identity.deathIndicator === true ? 'Yes' : identity.deathIndicator === false ? 'No' : '—';
    const creditText = credit.score ?? 'Not requested';

    modalContent.innerHTML = `
      <span class="micro-label">${escapeHtml(String(report.providerMode || 'sandbox').toUpperCase())} REPORT</span>
      <h2 class="modal-title">Verification result</h2>
      <p class="modal-subtitle">${escapeHtml(report.reference)} • ${escapeHtml(formatDate(report.createdAt))}</p>

      <div class="modal-score-grid">
        <div class="modal-score"><span>Identity match</span><strong>${escapeHtml(matchText)}</strong><small>Confidence: ${escapeHtml(identity.confidence ?? '—')}%</small></div>
        <div class="modal-score"><span>Credit score</span><strong>${escapeHtml(creditText)}</strong><small>${escapeHtml(credit.model || 'Not requested')}</small></div>
      </div>

      <div class="details-grid">
        <div><span>Subject</span><strong>${escapeHtml(report.subjectLabel || 'Masked subject')}</strong></div>
        <div><span>SSN</span><strong>${escapeHtml(report.maskedSsn)}</strong></div>
        <div><span>Date of birth</span><strong>${escapeHtml(report.dobMasked || '****-**-**')}</strong></div>
        <div><span>Death indicator</span><strong>${escapeHtml(deathText)}</strong></div>
        <div><span>Risk level</span><strong>${escapeHtml(report.risk?.level || '—')}</strong></div>
        <div><span>Provider</span><strong>${escapeHtml(identity.source || credit.source || 'Sandbox')}</strong></div>
        <div><span>Consent receipt</span><strong>${escapeHtml(report.consentReceipt ? report.consentReceipt.slice(0, 16) + '…' : '—')}</strong></div>
        <div><span>Server audit</span><strong>${escapeHtml(report.auditStored ? (report.serverAuditId ? report.serverAuditId.slice(0, 16) + '…' : 'Stored') : 'Not stored')}</strong></div>
      </div>

      <div class="notice warning" style="margin-top:20px">
        <strong>Sandbox disclaimer</strong>
        <span>${escapeHtml(report.disclaimer || 'This result is simulated and is not sourced from SSA or a consumer reporting agency.')}</span>
      </div>`;

    if (typeof reportModal.showModal === 'function') reportModal.showModal();
  }

  function showSampleReport() {
    openReport({
      id: 'sample',
      reference: 'VC-SAMPLE-3001',
      providerMode: 'sandbox',
      subjectLabel: 'D*** U***',
      dobMasked: '1990-**-**',
      maskedSsn: '***-**-3456',
      identity: { match: true, confidence: 94, deathIndicator: false, source: 'VeriCore Sandbox' },
      credit: { score: 742, model: 'DemoScore 3.2', source: 'VeriCore Sandbox' },
      risk: { level: 'Low' },
      createdAt: new Date().toISOString(),
      auditStored: true,
      serverAuditId: 'AUD-SAMPLE-3001',
      disclaimer: 'Simulated result. Not returned by SSA, Experian, Equifax, TransUnion, or any consumer reporting agency.'
    });
  }

  function applyTheme(theme) {
    document.body.classList.toggle('light', theme === 'light');
    localStorage.setItem(STORAGE_THEME, theme);
  }

  function bindEvents() {
    $$('.side-link').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-view-link]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewLink)));
    $('#newCheckTopButton').addEventListener('click', () => switchView('new-check'));
    $('#fillDemoButton').addEventListener('click', () => fillDemoForm(true));
    $('#sampleReportButton').addEventListener('click', showSampleReport);
    $('#closeModalButton').addEventListener('click', () => reportModal.close());
    reportModal.addEventListener('click', event => {
      if (event.target === reportModal) reportModal.close();
    });
    $('#ssn').addEventListener('input', event => { event.target.value = formatSsnInput(event.target.value); });
    form.addEventListener('submit', submitVerification);
    window.addEventListener('pagehide', clearSensitiveFields);
    window.addEventListener('beforeunload', clearSensitiveFields);
    window.addEventListener('vericore-turnstile-ready', renderTurnstile);

    $('#clearReportsButton').addEventListener('click', () => {
      if (!confirm('Удалить локальную историю отчётов?')) return;
      localStorage.removeItem(STORAGE_REPORTS);
      addAudit('Local report history cleared');
      renderReports();
      renderOverview();
      showToast('История отчётов очищена.');
    });

    $('#clearAuditButton').addEventListener('click', () => {
      if (!confirm('Очистить журнал действий?')) return;
      localStorage.removeItem(STORAGE_AUDIT);
      renderAudit();
      showToast('Audit log очищен.');
    });

    $('#themeToggle').addEventListener('click', () => {
      applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
    });
  }

  function init() {
    // Удаляем старые локальные записи при переходе на V3.3.
    LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
    applyTheme(localStorage.getItem(STORAGE_THEME) || 'dark');
    bindEvents();
    renderOverview();
    renderReports();
    renderAudit();
    checkApi();
    if (window.turnstile) renderTurnstile();
  }

  init();
})();
