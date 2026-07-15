(() => {
  "use strict";

  const CONFIG = window.VERICORE_CONFIG;
  if (!CONFIG) {
    throw new Error("VERICORE_CONFIG is missing.");
  }

  const TEST_PROFILE = Object.freeze({
    fullName: "Demo User",
    dob: "1990-01-15",
    ssn: "000-12-3456",
    email: "demo@example.com"
  });

  const $ = (selector) => document.querySelector(selector);
  const form = $("#verifyForm");
  const fullNameInput = $("#fullName");
  const dobInput = $("#dob");
  const ssnInput = $("#ssn");
  const emailInput = $("#email");
  const stateInput = $("#state");
  const purposeInput = $("#purpose");
  const submitButton = $("#submitButton");
  const buttonLabel = $(".button-label");
  const buttonLoader = $(".button-loader");
  const errorBanner = $("#errorBanner");
  const apiStatus = $("#apiStatus");
  const resultEmpty = $("#resultEmpty");
  const resultContent = $("#resultContent");
  const resultStatus = $("#resultStatus");
  const resultActions = $("#resultActions");
  const printButton = $("#printButton");
  const exportButton = $("#exportButton");
  const themeToggle = $("#themeToggle");
  const clearButton = $("#clearButton");
  const turnstileState = $("#turnstileState");

  let turnstileWidgetId = null;
  let turnstileToken = "";
  let currentSafeReport = null;
  let apiOnline = false;

  init();

  function init() {
    applySavedTheme();
    setDateLimit();
    bindEvents();
    clearSensitiveFields();
    checkHealth();
  }

  function bindEvents() {
    ssnInput.addEventListener("input", () => {
      ssnInput.value = formatSsn(ssnInput.value);
    });

    form.addEventListener("submit", handleSubmit);
    themeToggle.addEventListener("click", toggleTheme);
    clearButton.addEventListener("click", resetAll);
    printButton.addEventListener("click", () => window.print());
    exportButton.addEventListener("click", exportSafeJson);
  }

  function setDateLimit() {
    const today = new Date();
    dobInput.max = today.toISOString().slice(0, 10);
  }

  function applySavedTheme() {
    const saved = localStorage.getItem("vericore-theme");
    const theme = saved === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    themeToggle.textContent = theme === "dark" ? "☾" : "☀";
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("vericore-theme", next);
    themeToggle.textContent = next === "dark" ? "☾" : "☀";
    renderTurnstile();
  }

  function formatSsn(value) {
    const digits = String(value).replace(/\D/g, "").slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  function clearSensitiveFields() {
    fullNameInput.value = "";
    dobInput.value = "";
    ssnInput.value = "";
    emailInput.value = "";
  }

  function resetAll() {
    form.reset();
    stateInput.value = "TX";
    purposeInput.value = "self_check";
    clearSensitiveFields();
    hideError();
    currentSafeReport = null;
    resultContent.hidden = true;
    resultContent.innerHTML = "";
    resultEmpty.hidden = false;
    resultActions.hidden = true;
    setResultStatus("Ожидание", "neutral");
    resetTurnstile();
  }

  async function checkHealth() {
    setApiStatus("Проверяем API…", "checking");

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/api/health?v=4`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "API health check failed.");
      }

      apiOnline = true;
      const auditLabel = data.auditDatabaseConnected ? "D1 online" : "D1 не подключена";
      setApiStatus(`API ${data.version} · ${auditLabel}`, "online");
    } catch (error) {
      apiOnline = false;
      setApiStatus("API недоступен", "offline");
      showError("Cloudflare Worker недоступен. Проверь адрес API и активное развёртывание.");
    }
  }

  function setApiStatus(text, state) {
    apiStatus.className = `status-pill status-${state}`;
    apiStatus.querySelector("span:last-child").textContent = text;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    hideError();

    if (!apiOnline) {
      showError("API сейчас недоступен. Обнови страницу после проверки Worker.");
      return;
    }

    if (!form.reportValidity()) {
      return;
    }

    if (!turnstileToken) {
      showError("Сначала пройди Cloudflare Turnstile.");
      return;
    }

    const checkType = new FormData(form).get("checkType");
    const payload = {
      requestId: createRequestId(),
      fullName: fullNameInput.value.trim(),
      dob: dobInput.value,
      ssn: ssnInput.value,
      email: emailInput.value.trim().toLowerCase(),
      state: stateInput.value,
      purpose: purposeInput.value,
      checkType,
      selfCheck: $("#selfCheck").checked,
      consentAccepted: $("#consentAccepted").checked,
      sandboxConfirmed: $("#sandboxConfirmed").checked,
      turnstileToken,
      consentTimestamp: new Date().toISOString()
    };

    const localError = validateSandboxPayload(payload);
    if (localError) {
      showError(localError);
      resetTurnstile();
      return;
    }

    setLoading(true);

    // Поля очищаются до сетевого запроса. В памяти остаётся только payload этой операции.
    clearSensitiveFields();

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/api/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-VeriCore-Client": CONFIG.CLIENT_VERSION,
          "X-Request-Id": payload.requestId
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });

      const data = await response.json().catch(() => ({
        ok: false,
        error: "Worker returned an unreadable response."
      }));

      if (!response.ok || !data.ok) {
        const retryText = data.retryAfter ? ` Повтори через ${data.retryAfter} сек.` : "";
        throw new Error(`${data.error || "Verification failed."}${retryText}`);
      }

      currentSafeReport = sanitizeReport(data);
      renderReport(currentSafeReport);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Неизвестная ошибка.");
      setResultStatus("Ошибка", "danger");
    } finally {
      payload.ssn = "";
      payload.fullName = "";
      payload.dob = "";
      payload.email = "";
      setLoading(false);
      resetTurnstile();
    }
  }

  function validateSandboxPayload(payload) {
    if (
      payload.fullName !== TEST_PROFILE.fullName ||
      payload.dob !== TEST_PROFILE.dob ||
      payload.ssn !== TEST_PROFILE.ssn ||
      payload.email !== TEST_PROFILE.email
    ) {
      return "V4 Sandbox принимает только Demo User / 1990-01-15 / 000-12-3456 / demo@example.com. Настоящие данные заблокированы.";
    }

    if (!payload.selfCheck || !payload.consentAccepted || !payload.sandboxConfirmed) {
      return "Поставь все три обязательные галочки.";
    }

    return "";
  }

  function createRequestId() {
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    }

    const random = crypto.getRandomValues(new Uint32Array(4));
    return `vc-${Array.from(random).map((n) => n.toString(16)).join("-")}`;
  }

  function sanitizeReport(data) {
    return {
      reference: String(data.reference || ""),
      createdAt: String(data.createdAt || ""),
      providerMode: String(data.providerMode || "sandbox"),
      subject: {
        label: String(data.subject?.label || "D*** U***"),
        dobMasked: String(data.subject?.dobMasked || "****-**-**"),
        maskedSsn: String(data.subject?.maskedSsn || "***-**-****")
      },
      identity: data.identity
        ? {
            match: Boolean(data.identity.match),
            confidence: Number(data.identity.confidence || 0),
            deathIndicator: Boolean(data.identity.deathIndicator),
            source: String(data.identity.source || "Sandbox")
          }
        : null,
      credit: data.credit
        ? {
            available: Boolean(data.credit.available),
            score: Number(data.credit.score || 0),
            rating: String(data.credit.rating || "—"),
            model: String(data.credit.model || "—"),
            source: String(data.credit.source || "Sandbox")
          }
        : null,
      risk: {
        level: String(data.risk?.level || "Unknown"),
        signals: Number(data.risk?.signals || 0)
      },
      consentReceipt: String(data.consentReceipt || ""),
      audit: {
        id: String(data.audit?.id || ""),
        stored: Boolean(data.audit?.stored),
        reason: String(data.audit?.reason || "")
      },
      disclaimer: String(data.disclaimer || "")
    };
  }

  function renderReport(report) {
    resultEmpty.hidden = true;
    resultContent.hidden = false;
    resultActions.hidden = false;
    setResultStatus("Готово", "success");

    const identityValue = report.identity
      ? report.identity.match
        ? "Matched"
        : "No match"
      : "Not requested";

    const creditValue = report.credit?.available
      ? String(report.credit.score)
      : "Not requested";

    resultContent.innerHTML = `
      <div class="report-highlight">
        <div>
          <span>Identity match</span>
          <strong>${escapeHtml(identityValue)}</strong>
        </div>
        <div>
          <span>Credit score</span>
          <strong>${escapeHtml(creditValue)}</strong>
        </div>
      </div>

      <dl class="report-list">
        <div><dt>Subject</dt><dd>${escapeHtml(report.subject.label)}</dd></div>
        <div><dt>Date of birth</dt><dd>${escapeHtml(report.subject.dobMasked)}</dd></div>
        <div><dt>SSN</dt><dd>${escapeHtml(report.subject.maskedSsn)}</dd></div>
        <div><dt>Death indicator</dt><dd>${report.identity ? (report.identity.deathIndicator ? "Yes" : "No") : "Not requested"}</dd></div>
        <div><dt>Credit model</dt><dd>${escapeHtml(report.credit?.model || "Not requested")}</dd></div>
        <div><dt>Risk level</dt><dd>${escapeHtml(report.risk.level)}</dd></div>
        <div><dt>Reference</dt><dd class="mono">${escapeHtml(report.reference)}</dd></div>
        <div><dt>Server audit</dt><dd class="mono">${escapeHtml(report.audit.id || "Not created")}</dd></div>
        <div><dt>Audit stored</dt><dd>${report.audit.stored ? "Yes" : "No"}</dd></div>
      </dl>

      <div class="receipt-box">
        <span>Consent receipt</span>
        <code>${escapeHtml(shorten(report.consentReceipt, 64))}</code>
      </div>

      <p class="report-disclaimer">${escapeHtml(report.disclaimer)}</p>
    `;
  }

  function setResultStatus(text, state) {
    resultStatus.textContent = text;
    resultStatus.className = `result-status ${state}`;
  }

  function setLoading(isLoading) {
    submitButton.disabled = isLoading;
    buttonLabel.hidden = isLoading;
    buttonLoader.hidden = !isLoading;
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.hidden = false;
  }

  function hideError() {
    errorBanner.hidden = true;
    errorBanner.textContent = "";
  }

  function exportSafeJson() {
    if (!currentSafeReport) return;

    const blob = new Blob([JSON.stringify(currentSafeReport, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vericore-${currentSafeReport.reference || "report"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function shorten(value, max) {
    if (!value || value.length <= max) return value || "—";
    return `${value.slice(0, max)}…`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function resetTurnstile() {
    turnstileToken = "";
    turnstileState.textContent = "Ожидает проверки";

    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }

  function renderTurnstile() {
    if (!window.turnstile) return;

    if (turnstileWidgetId !== null) {
      window.turnstile.remove(turnstileWidgetId);
      turnstileWidgetId = null;
    }

    turnstileToken = "";
    turnstileState.textContent = "Ожидает проверки";

    turnstileWidgetId = window.turnstile.render("#turnstileMount", {
      sitekey: CONFIG.TURNSTILE_SITEKEY,
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      callback(token) {
        turnstileToken = token;
        turnstileState.textContent = "Проверка пройдена";
      },
      "expired-callback"() {
        turnstileToken = "";
        turnstileState.textContent = "Токен истёк";
      },
      "error-callback"() {
        turnstileToken = "";
        turnstileState.textContent = "Ошибка Turnstile";
        showError("Cloudflare Turnstile не загрузился. Обнови страницу.");
      }
    });
  }

  window.onTurnstileLoad = renderTurnstile;
})();
