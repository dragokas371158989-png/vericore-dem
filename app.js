(() => {
  'use strict';

  const STORAGE_REPORTS = 'vericore_demo_reports_v2';
  const STORAGE_AUDIT = 'vericore_demo_audit_v2';
  const STORAGE_THEME = 'vericore_demo_theme_v2';
  const OLD_REPORTS = 'vericore_demo_reports_v1';
  const OLD_AUDIT = 'vericore_demo_audit_v1';
  const DEMO_SSN_DIGITS = '000123456';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const form = $('#verificationForm');
  const modal = $('#reportModal');
  const formMessage = $('#formMessage');
  const reportList = $('#reportList');
  const clientList = $('#clientList');
  const auditList = $('#auditList');
  const workspaceTitle = $('#workspaceTitle');
  const toast = $('#toast');

  let currentReportId = null;
  let toastTimer = null;

  function readStorage(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      showToast('Не удалось сохранить данные в браузере.');
      return false;
    }
  }

  function migrateV1() {
    if (!localStorage.getItem(STORAGE_REPORTS)) {
      const oldReports = readStorage(OLD_REPORTS);
      if (oldReports.length) {
        const migrated = oldReports.map((row, index) => ({
          id: row.id || `legacy-${index}-${Date.now()}`,
          reference: row.reference || makeReference(),
          name: row.name || 'Legacy Demo Client',
          email: `legacy.demo.${index + 1}@example.com`,
          dob: '1990-01-15',
          ssn: row.ssn || '***-**-0000',
          address: 'Imported from V1',
          city: 'Demo City',
          state: 'TX',
          zip: '00000',
          purpose: 'user_request',
          type: row.type || 'ssn',
          typeLabel: row.typeLabel || 'SSN Verification',
          identityScore: 92,
          creditScore: 742,
          risk: 'Low',
          createdAt: row.createdAt || new Date().toISOString(),
          migrated: true
        }));
        writeStorage(STORAGE_REPORTS, migrated);
      }
    }

    if (!localStorage.getItem(STORAGE_AUDIT)) {
      const oldAudit = readStorage(OLD_AUDIT);
      if (oldAudit.length) writeStorage(STORAGE_AUDIT, oldAudit);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    }[char]));
  }

  function makeId() {
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function makeReference() {
    const stamp = Date.now().toString().slice(-7);
    return `DEMO-VC-${stamp}`;
  }

  function maskSSN(value) {
    const last4 = String(value).replace(/\D/g, '').slice(-4);
    return `***-**-${last4 || '0000'}`;
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        dateStyle:'medium',
        timeStyle:'short'
      }).format(new Date(iso));
    } catch {
      return '—';
    }
  }

  function formatDateOnly(iso) {
    try {
      return new Intl.DateTimeFormat('ru-RU', { dateStyle:'medium' }).format(new Date(iso));
    } catch {
      return '—';
    }
  }

  function sameLocalDay(first, second) {
    const a = new Date(first);
    const b = new Date(second);
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function initials(name) {
    return String(name || 'DC')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() || '')
      .join('') || 'DC';
  }

  function purposeLabel(value) {
    return {
      user_request:'Запрос пользователя',
      tenant:'Проверка арендатора',
      employment:'Проверка кандидата',
      lending:'Кредитная заявка'
    }[value] || 'Demo purpose';
  }

  function addAudit(action, detail = '') {
    const rows = readStorage(STORAGE_AUDIT);
    rows.unshift({ id:makeId(), time:new Date().toISOString(), action, detail });
    writeStorage(STORAGE_AUDIT, rows.slice(0, 100));
    renderAudit();
    renderOverview();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function switchView(viewName) {
    $$('.side-item').forEach(button => {
      button.classList.toggle('active', button.dataset.view === viewName);
    });
    $$('.view').forEach(view => view.classList.remove('active'));
    $(`#view-${viewName}`)?.classList.add('active');

    const titles = {
      overview:'Обзор',
      'new-check':'Новая проверка',
      reports:'Отчёты',
      clients:'Клиенты',
      audit:'Audit log'
    };
    workspaceTitle.textContent = titles[viewName] || 'Workspace';

    if (viewName === 'overview') renderOverview();
    if (viewName === 'reports') renderReports();
    if (viewName === 'clients') renderClients();
    if (viewName === 'audit') renderAudit();
  }

  function generateDemoScores(type) {
    const values = {
      ssn:{ identityScore:94, creditScore:null, risk:'Low' },
      credit:{ identityScore:88, creditScore:731, risk:'Low' },
      full:{ identityScore:92, creditScore:742, risk:'Low' }
    };
    return values[type] || values.full;
  }

  function validateDemo(formData) {
    const rawSSN = String(formData.get('ssn') || '').replace(/\D/g, '');
    if (rawSSN !== DEMO_SSN_DIGITS) {
      return 'Разрешён только невозможный тестовый SSN 000-12-3456.';
    }
    if (!$('#consent').checked || !$('#demoConfirm').checked) {
      return 'Подтверди согласие владельца данных и демонстрационный режим.';
    }
    if (!form.checkValidity()) {
      return 'Заполни все обязательные поля.';
    }
    return '';
  }

  function createReport(formData) {
    const type = String(formData.get('checkType') || 'ssn');
    const typeLabel = {
      ssn:'SSN Verification',
      credit:'Credit Insights',
      full:'Full Identity Report'
    }[type] || 'Verification';
    const scores = generateDemoScores(type);

    return {
      id:makeId(),
      reference:makeReference(),
      name:String(formData.get('fullName') || '').trim(),
      email:String(formData.get('email') || '').trim().toLowerCase(),
      dob:String(formData.get('dob') || ''),
      ssn:maskSSN(formData.get('ssn')),
      address:String(formData.get('address') || '').trim(),
      city:String(formData.get('city') || '').trim(),
      state:String(formData.get('state') || ''),
      zip:String(formData.get('zip') || ''),
      purpose:String(formData.get('purpose') || ''),
      type,
      typeLabel,
      ...scores,
      createdAt:new Date().toISOString()
    };
  }

  function renderOverview() {
    const reports = readStorage(STORAGE_REPORTS);
    const audits = readStorage(STORAGE_AUDIT);
    const clients = getClients(reports);
    const today = reports.filter(report => sameLocalDay(report.createdAt, new Date())).length;

    $('#statReports').textContent = String(reports.length);
    $('#statClients').textContent = String(clients.length);
    $('#statToday').textContent = String(today);
    $('#reportsBadge').textContent = String(reports.length);
    $('#clientsBadge').textContent = String(clients.length);

    const recent = audits.slice(0, 5);
    $('#overviewActivity').innerHTML = recent.length
      ? recent.map(row => `
        <div class="activity-row">
          <span class="activity-icon">${row.action.includes('completed') ? '✓' : '•'}</span>
          <div><strong>${escapeHtml(row.action)}</strong><span>${escapeHtml(row.detail || '—')}</span></div>
          <time>${formatDate(row.time)}</time>
        </div>`).join('')
      : '<div class="empty-state">Активности пока нет. Создай первый демо-отчёт.</div>';
  }

  function getFilteredReports() {
    const query = ($('#reportSearch')?.value || '').trim().toLowerCase();
    const type = $('#reportTypeFilter')?.value || 'all';
    return readStorage(STORAGE_REPORTS).filter(report => {
      const matchesType = type === 'all' || report.type === type;
      const haystack = `${report.name} ${report.email} ${report.reference} ${report.ssn}`.toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  }

  function renderReports() {
    const reports = getFilteredReports();
    if (!reports.length) {
      reportList.innerHTML = '<div class="empty-state">По выбранным условиям отчётов нет.</div>';
      renderOverview();
      return;
    }

    reportList.innerHTML = reports.map(report => `
      <div class="report-item">
        <div><strong>${escapeHtml(report.name)}</strong><br><span>${escapeHtml(report.reference)} · ${escapeHtml(report.ssn)}</span></div>
        <div><strong>${escapeHtml(report.typeLabel)}</strong><br><span>${formatDate(report.createdAt)}</span></div>
        <div><strong style="color:var(--accent)">${escapeHtml(report.risk || 'Low')} risk</strong><br><span>${report.creditScore ? `Score ${escapeHtml(report.creditScore)}` : 'Identity demo'}</span></div>
        <div class="report-actions">
          <button class="report-open" type="button" data-open-report="${escapeHtml(report.id)}">Открыть</button>
          <button class="report-delete" type="button" data-delete-report="${escapeHtml(report.id)}">Удалить</button>
        </div>
      </div>`).join('');

    renderOverview();
  }

  function getClients(reports = readStorage(STORAGE_REPORTS)) {
    const map = new Map();
    for (const report of reports) {
      const key = report.email || report.name.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          name:report.name,
          email:report.email || '—',
          ssn:report.ssn,
          city:report.city,
          state:report.state,
          reports:1,
          lastCheck:report.createdAt
        });
      } else {
        existing.reports += 1;
        if (new Date(report.createdAt) > new Date(existing.lastCheck)) existing.lastCheck = report.createdAt;
      }
    }
    return [...map.values()].sort((a, b) => new Date(b.lastCheck) - new Date(a.lastCheck));
  }

  function renderClients() {
    const clients = getClients();
    if (!clients.length) {
      clientList.innerHTML = '<div class="empty-state">Клиентов пока нет. Они появятся после первой демо-проверки.</div>';
      renderOverview();
      return;
    }

    clientList.innerHTML = clients.map(client => `
      <article class="client-card">
        <div class="client-avatar">${escapeHtml(initials(client.name))}</div>
        <h4>${escapeHtml(client.name)}</h4>
        <p>${escapeHtml(client.email)}</p>
        <div class="client-meta">
          <div><span>SSN</span><strong>${escapeHtml(client.ssn)}</strong></div>
          <div><span>Локация</span><strong>${escapeHtml(`${client.city || '—'}, ${client.state || '—'}`)}</strong></div>
          <div><span>Отчётов</span><strong>${escapeHtml(client.reports)}</strong></div>
          <div><span>Последняя проверка</span><strong>${formatDateOnly(client.lastCheck)}</strong></div>
        </div>
      </article>`).join('');

    renderOverview();
  }

  function renderAudit() {
    const rows = readStorage(STORAGE_AUDIT);
    if (!rows.length) {
      auditList.innerHTML = '<div class="empty-state">Журнал пока пуст.</div>';
      renderOverview();
      return;
    }

    auditList.innerHTML = rows.map(row => `
      <div class="audit-item">
        <span>${formatDate(row.time)}</span>
        <div><strong>${escapeHtml(row.action)}</strong><br><span>${escapeHtml(row.detail || '—')}</span></div>
        <span>Local demo</span>
      </div>`).join('');

    renderOverview();
  }

  function sampleReport() {
    return {
      id:null,
      reference:'DEMO-VC-SAMPLE',
      name:'Alex Demo',
      email:'alex.demo@example.com',
      dob:'1990-01-15',
      ssn:'***-**-3456',
      address:'100 Demo Avenue',
      city:'Austin',
      state:'TX',
      zip:'78701',
      purpose:'user_request',
      type:'full',
      typeLabel:'Full Identity Report',
      identityScore:92,
      creditScore:742,
      risk:'Low',
      createdAt:new Date().toISOString()
    };
  }

  function resultRow(label, value, ok = false) {
    return `<div class="result-row"><span>${escapeHtml(label)}</span><strong${ok ? ' class="ok"' : ''}>${escapeHtml(value)}</strong></div>`;
  }

  function buildReportSections(report) {
    const identity = `
      <section>
        <h3>Identity verification</h3>
        ${resultRow('Name & date of birth', 'Simulated match', true)}
        ${resultRow('SSN pattern', 'Invalid-for-real demo pattern', true)}
        ${resultRow('Address match', 'Simulated confirmed', true)}
        ${resultRow('Consent record', purposeLabel(report.purpose), true)}
      </section>`;

    const credit = `
      <section>
        <h3>Credit indicators</h3>
        ${resultRow('Generated score', report.creditScore || 'Not requested')}
        ${resultRow('Open accounts', report.creditScore ? '7' : '—')}
        ${resultRow('Utilization', report.creditScore ? '24%' : '—')}
        ${resultRow('Hard inquiries', report.creditScore ? '1' : '—')}
      </section>`;

    const security = `
      <section>
        <h3>Demo security record</h3>
        ${resultRow('Stored SSN', report.ssn, true)}
        ${resultRow('Full SSN stored', 'No', true)}
        ${resultRow('External provider', 'Not connected')}
        ${resultRow('Data source', 'Browser-generated demo')}
      </section>`;

    if (report.type === 'ssn') return identity + security;
    if (report.type === 'credit') return credit + security;
    return identity + credit;
  }

  function openReport(reportId = null) {
    const report = reportId
      ? readStorage(STORAGE_REPORTS).find(row => row.id === reportId)
      : sampleReport();

    if (!report) {
      showToast('Отчёт не найден.');
      return;
    }

    currentReportId = report.id;
    $('#reportTitle').textContent = report.typeLabel;
    $('#reportReference').textContent = `Reference: ${report.reference} · ${formatDate(report.createdAt)}`;
    $('#reportIdentityScore').textContent = `${report.identityScore ?? 92}%`;
    $('#reportCreditScore').textContent = report.creditScore ?? 'N/A';
    $('#reportRisk').textContent = report.risk || 'Low';
    $('#reportPerson').innerHTML = `
      <div><strong>${escapeHtml(report.name)}</strong><span>${escapeHtml(report.email)}</span></div>
      <div><strong>${escapeHtml(report.ssn)}</strong><span>${escapeHtml(`${report.city || '—'}, ${report.state || '—'} ${report.zip || ''}`)}</span></div>`;
    $('#reportColumns').innerHTML = buildReportSections(report);
    $('#deleteReportBtn').hidden = !report.id;

    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  }

  function closeReport() {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
    currentReportId = null;
  }

  function deleteReport(reportId) {
    const reports = readStorage(STORAGE_REPORTS);
    const report = reports.find(row => row.id === reportId);
    if (!report) return;

    writeStorage(STORAGE_REPORTS, reports.filter(row => row.id !== reportId));
    addAudit('Demo report deleted', report.reference);
    renderReports();
    renderClients();
    showToast('Отчёт удалён из браузера.');
  }

  function exportReports() {
    const reports = readStorage(STORAGE_REPORTS).map(report => ({
      ...report,
      notice:'SIMULATED DATA ONLY — no credit bureau or SSN provider used.'
    }));

    if (!reports.length) {
      showToast('Нет отчётов для экспорта.');
      return;
    }

    const blob = new Blob([JSON.stringify(reports, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vericore-demo-reports-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addAudit('Demo reports exported', `${reports.length} record(s)`);
    showToast('JSON-файл подготовлен.');
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_THEME, theme);
    $('#themeToggleBtn').textContent = theme === 'light' ? '◑' : '◐';
  }

  $$('input[name="checkType"]').forEach(input => {
    input.addEventListener('change', () => {
      $$('.type-card').forEach(card => {
        const radio = $('input[name="checkType"]', card);
        card.classList.toggle('selected', Boolean(radio?.checked));
      });
    });
  });

  $('#ssn').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 9);
    const groups = [];
    if (digits.length) groups.push(digits.slice(0, 3));
    if (digits.length > 3) groups.push(digits.slice(3, 5));
    if (digits.length > 5) groups.push(digits.slice(5, 9));
    event.target.value = groups.join('-');
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    formMessage.textContent = '';
    const data = new FormData(form);
    const error = validateDemo(data);

    if (error) {
      formMessage.textContent = error;
      form.reportValidity();
      return;
    }

    const report = createReport(data);
    const reports = readStorage(STORAGE_REPORTS);
    reports.unshift(report);
    writeStorage(STORAGE_REPORTS, reports.slice(0, 100));
    addAudit('Verification completed', `${report.reference} · ${report.typeLabel} · ${report.ssn}`);

    const submitButton = $('.submit-btn');
    submitButton.disabled = true;
    $('span', submitButton).textContent = 'Генерация отчёта…';

    setTimeout(() => {
      submitButton.disabled = false;
      $('span', submitButton).textContent = 'Запустить демо-проверку';
      renderReports();
      renderClients();
      openReport(report.id);
      showToast('Демо-отчёт создан.');
    }, 550);
  });

  $$('.side-item').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  $$('[data-view-jump]').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.viewJump));
  });

  $('#openDashboardBtn').addEventListener('click', () => {
    $('#workspace').scrollIntoView({ behavior:'smooth' });
    switchView('overview');
  });

  $('#viewSampleBtn').addEventListener('click', () => {
    addAudit('Sample report opened', 'Landing page');
    openReport();
  });

  $('#themeToggleBtn').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  });

  $('#closeModalBtn').addEventListener('click', closeReport);
  $('#doneReportBtn').addEventListener('click', closeReport);
  $('#printReportBtn').addEventListener('click', () => window.print());
  $('#exportReportsBtn').addEventListener('click', exportReports);
  $('#reportSearch').addEventListener('input', renderReports);
  $('#reportTypeFilter').addEventListener('change', renderReports);

  $('#clearAuditBtn').addEventListener('click', () => {
    if (!window.confirm('Очистить локальный audit log?')) return;
    writeStorage(STORAGE_AUDIT, []);
    renderAudit();
    showToast('Audit log очищен.');
  });

  reportList.addEventListener('click', event => {
    const openButton = event.target.closest('[data-open-report]');
    const deleteButton = event.target.closest('[data-delete-report]');
    if (openButton) openReport(openButton.dataset.openReport);
    if (deleteButton && window.confirm('Удалить этот демо-отчёт?')) deleteReport(deleteButton.dataset.deleteReport);
  });

  $('#deleteReportBtn').addEventListener('click', () => {
    if (!currentReportId || !window.confirm('Удалить открытый демо-отчёт?')) return;
    const id = currentReportId;
    closeReport();
    deleteReport(id);
  });

  modal.addEventListener('click', event => {
    if (event.target === modal) closeReport();
  });

  migrateV1();
  applyTheme(localStorage.getItem(STORAGE_THEME) || 'dark');
  renderOverview();
  renderReports();
  renderClients();
  renderAudit();
  console.info('VeriCore Demo V2.1 loaded');
})();
