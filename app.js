(() => {
  'use strict';

  const STORAGE_REPORTS = 'vericore_demo_reports_v1';
  const STORAGE_AUDIT = 'vericore_demo_audit_v1';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const form = $('#verificationForm');
  const modal = $('#reportModal');
  const formMessage = $('#formMessage');
  const reportList = $('#reportList');
  const auditList = $('#auditList');
  const workspaceTitle = $('#workspaceTitle');

  function readStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  }

  function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function addAudit(action, detail = '') {
    const rows = readStorage(STORAGE_AUDIT);
    rows.unshift({ id: crypto.randomUUID?.() || String(Date.now()), time: new Date().toISOString(), action, detail });
    writeStorage(STORAGE_AUDIT, rows.slice(0, 60));
    renderAudit();
  }

  function makeReference() {
    const tail = String(Date.now()).slice(-6);
    return `DEMO-VC-${tail}`;
  }

  function maskSSN(value) {
    const last4 = String(value).replace(/\D/g, '').slice(-4);
    return `***-**-${last4 || '0000'}`;
  }

  function formatDate(iso) {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  }

  function switchView(viewName) {
    $$('.side-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewName));
    $$('.view').forEach(view => view.classList.remove('active'));
    $(`#view-${viewName}`)?.classList.add('active');
    const titles = { 'new-check': 'Новая проверка', reports: 'Отчёты', audit: 'Audit log' };
    workspaceTitle.textContent = titles[viewName] || 'Workspace';
    if (viewName === 'reports') renderReports();
    if (viewName === 'audit') renderAudit();
  }

  function openReport(reference = 'DEMO-VC-0001') {
    $('#reportReference').textContent = `Reference: ${reference}`;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  }

  function closeReport() {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  function renderReports() {
    const reports = readStorage(STORAGE_REPORTS);
    if (!reports.length) {
      reportList.innerHTML = '<div class="empty-state">Пока нет сохранённых демо-отчётов. Запусти первую проверку.</div>';
      return;
    }
    reportList.innerHTML = reports.map(row => `
      <div class="report-item">
        <div><strong>${escapeHtml(row.name)}</strong><br><span>${escapeHtml(row.reference)} · ${escapeHtml(row.ssn)}</span></div>
        <div><strong>${escapeHtml(row.typeLabel)}</strong><br><span>${formatDate(row.createdAt)}</span></div>
        <div><strong style="color:var(--accent)">Low risk</strong><br><span>Demo result</span></div>
        <button type="button" data-open-report="${escapeHtml(row.reference)}">Открыть</button>
      </div>`).join('');
  }

  function renderAudit() {
    const rows = readStorage(STORAGE_AUDIT);
    if (!rows.length) {
      auditList.innerHTML = '<div class="empty-state">Журнал пока пуст.</div>';
      return;
    }
    auditList.innerHTML = rows.map(row => `
      <div class="audit-item">
        <span>${formatDate(row.time)}</span>
        <div><strong>${escapeHtml(row.action)}</strong><br><span>${escapeHtml(row.detail || '—')}</span></div>
        <span>Demo user</span>
      </div>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  function validateDemo(formData) {
    const rawSSN = String(formData.get('ssn') || '').replace(/\D/g, '');
    if (rawSSN !== '123456789') return 'В демо-версии разрешён только тестовый SSN 123-45-6789.';
    if (!$('#consent').checked || !$('#demoConfirm').checked) return 'Подтверди согласие владельца данных и демонстрационный режим.';
    if (!form.checkValidity()) return 'Заполни все обязательные поля.';
    return '';
  }

  $$('input[name="checkType"]').forEach(input => {
    input.addEventListener('change', () => {
      $$('.type-card').forEach(card => card.classList.toggle('selected', card.contains(input) && input.checked));
    });
  });

  $('#ssn').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 9);
    event.target.value = digits.replace(/^(\d{3})(\d{0,2})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join('-'));
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

    const type = data.get('checkType');
    const typeLabel = { ssn: 'SSN Verification', credit: 'Credit Insights', full: 'Full Report' }[type] || 'Verification';
    const reference = makeReference();
    const report = {
      reference,
      name: String(data.get('fullName')),
      ssn: maskSSN(data.get('ssn')),
      type,
      typeLabel,
      createdAt: new Date().toISOString()
    };

    const reports = readStorage(STORAGE_REPORTS);
    reports.unshift(report);
    writeStorage(STORAGE_REPORTS, reports.slice(0, 30));
    addAudit('Verification completed', `${reference} · ${report.typeLabel} · ${report.ssn}`);

    const submitButton = $('.submit-btn');
    submitButton.disabled = true;
    submitButton.querySelector('span').textContent = 'Проверка завершена';
    setTimeout(() => {
      submitButton.disabled = false;
      submitButton.querySelector('span').textContent = 'Запустить проверку';
      openReport(reference);
    }, 450);
  });

  $$('.side-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#openDashboardBtn').addEventListener('click', () => document.querySelector('#workspace').scrollIntoView({ behavior: 'smooth' }));
  $('#viewSampleBtn').addEventListener('click', () => { addAudit('Sample report opened', 'Landing page'); openReport('DEMO-VC-SAMPLE'); });
  $('#closeModalBtn').addEventListener('click', closeReport);
  $('#doneReportBtn').addEventListener('click', closeReport);
  $('#printReportBtn').addEventListener('click', () => window.print());
  $('#newCheckFromReports').addEventListener('click', () => switchView('new-check'));
  $('#clearAuditBtn').addEventListener('click', () => { writeStorage(STORAGE_AUDIT, []); renderAudit(); });

  reportList.addEventListener('click', event => {
    const button = event.target.closest('[data-open-report]');
    if (button) openReport(button.dataset.openReport);
  });

  modal.addEventListener('click', event => {
    if (event.target === modal) closeReport();
  });

  renderReports();
  renderAudit();
  console.info('VeriCore MVP V1 loaded');
})();
