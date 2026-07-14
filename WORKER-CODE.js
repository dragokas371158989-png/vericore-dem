const APP_ORIGIN = "https://dragokas371158989-png.github.io";
const CLIENT_VERSION = "web-v3.2";
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const DEMO_PROFILE = Object.freeze({
  fullName: "Demo User",
  dob: "1990-01-15",
  ssnDigits: "000123456",
  email: "demo@example.com"
});

const ALLOWED_CHECK_TYPES = new Set(["identity", "credit", "full"]);
const ALLOWED_PURPOSES = new Set(["self_check", "credit_monitoring"]);
const ALLOWED_STATES = new Set(["CA", "FL", "NY", "TX"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = normalizeOrigin(request.headers.get("Origin"));
    const isAllowedOrigin = origin === APP_ORIGIN;
    const headers = securityHeaders(isAllowedOrigin ? origin : "");

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin) {
        return json({ ok: false, error: "Origin is not allowed." }, 403, headers);
      }

      return new Response(null, { status: 204, headers });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
      if (origin && !isAllowedOrigin) {
        return json({ ok: false, error: "Origin is not allowed." }, 403, headers);
      }

      return json({
        ok: true,
        service: "vericore-api",
        version: "3.2.0",
        mode: "sandbox",
        originLocked: true,
        allowedOrigin: APP_ORIGIN,
        rateLimit: `${RATE_LIMIT_MAX} requests / 10 minutes`,
        realSsnEnabled: false,
        creditBureauConnected: false,
        message: "VeriCore secure sandbox API is working.",
        timestamp: new Date().toISOString()
      }, 200, headers);
    }

    if (request.method === "POST" && url.pathname === "/api/verify") {
      if (!isAllowedOrigin) {
        return json({ ok: false, error: "Origin is not allowed." }, 403, headers);
      }

      if (request.headers.get("X-VeriCore-Client") !== CLIENT_VERSION) {
        return json({ ok: false, error: "Unsupported client version." }, 400, headers);
      }

      const rateLimit = await enforceRateLimit(request, env);
      if (!rateLimit.allowed) {
        return json({
          ok: false,
          error: "Too many verification attempts.",
          retryAfter: rateLimit.retryAfter
        }, 429, {
          ...headers,
          "Retry-After": String(rateLimit.retryAfter)
        });
      }

      return handleVerification(request, headers);
    }

    return json({ ok: false, error: "Route not found." }, 404, headers);
  }
};

async function handleVerification(request, headers) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Content-Type must be application/json." }, 415, headers);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 8192) {
    return json({ ok: false, error: "Request body is too large." }, 413, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON request." }, 400, headers);
  }

  const validationError = validateRequest(body, request);
  if (validationError) {
    return json({ ok: false, error: validationError }, 400, headers);
  }

  const checkType = String(body.checkType);
  const includeIdentity = checkType === "identity" || checkType === "full";
  const includeCredit = checkType === "credit" || checkType === "full";
  const createdAt = new Date().toISOString();
  const reportId = crypto.randomUUID();
  const reference = `VC-SBX-${Date.now().toString(36).toUpperCase()}`;
  const consentReceipt = await createConsentReceipt(body);

  return json({
    ok: true,
    reportId,
    reference,
    providerMode: "sandbox",
    createdAt,
    subject: {
      label: "D*** U***",
      dobMasked: "1990-**-**",
      maskedSsn: "***-**-3456"
    },
    identity: includeIdentity ? {
      verified: true,
      match: true,
      confidence: 96,
      deathIndicator: false,
      source: "VeriCore Sandbox"
    } : null,
    credit: includeCredit ? {
      available: true,
      score: 742,
      rangeMin: 300,
      rangeMax: 850,
      rating: "Very Good",
      model: "DemoScore 3.2",
      source: "VeriCore Sandbox"
    } : null,
    risk: {
      level: "Low",
      signals: 0
    },
    consentReceipt,
    disclaimer:
      "Simulated result. Not returned by SSA, Experian, Equifax, TransUnion, or any consumer reporting agency."
  }, 200, headers);
}

function validateRequest(body, request) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be an object.";
  }

  const requestIdHeader = String(request.headers.get("X-Request-Id") || "");
  const requestIdBody = String(body.requestId || "");
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestIdBody) || requestIdHeader !== requestIdBody) {
    return "Invalid request identifier.";
  }

  if (!ALLOWED_CHECK_TYPES.has(String(body.checkType))) {
    return "Unsupported check type.";
  }

  if (!ALLOWED_PURPOSES.has(String(body.purpose))) {
    return "Unsupported purpose.";
  }

  if (!ALLOWED_STATES.has(String(body.state))) {
    return "Unsupported state.";
  }

  if (body.selfCheck !== true || body.consentAccepted !== true || body.sandboxConfirmed !== true) {
    return "All consent confirmations are required.";
  }

  const fullName = String(body.fullName || "").trim();
  const dob = String(body.dob || "").trim();
  const ssnDigits = String(body.ssn || "").replace(/\D/g, "");
  const email = String(body.email || "").trim().toLowerCase();

  if (
    fullName !== DEMO_PROFILE.fullName ||
    dob !== DEMO_PROFILE.dob ||
    ssnDigits !== DEMO_PROFILE.ssnDigits ||
    email !== DEMO_PROFILE.email
  ) {
    return "Sandbox accepts only Demo User / 1990-01-15 / 000-12-3456 / demo@example.com. Real personal data is blocked.";
  }

  const consentDate = new Date(String(body.consentTimestamp || ""));
  if (!Number.isFinite(consentDate.getTime())) {
    return "Invalid consent timestamp.";
  }

  if (Math.abs(Date.now() - consentDate.getTime()) > 5 * 60 * 1000) {
    return "Consent timestamp is outside the allowed time window.";
  }

  return "";
}

async function enforceRateLimit(request, env) {
  const now = Date.now();
  const windowId = Math.floor(now / RATE_LIMIT_WINDOW_MS);
  const windowEnd = (windowId + 1) * RATE_LIMIT_WINDOW_MS;
  const retryAfter = Math.max(1, Math.ceil((windowEnd - now) / 1000));
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const userAgent = request.headers.get("User-Agent") || "unknown";
  const salt = String(env.RATE_LIMIT_SALT || "vericore-sandbox-v3.2");
  const fingerprint = await sha256Hex(`${salt}|${ip}|${userAgent}|${windowId}`);
  const workerOrigin = new URL(request.url).origin;
  const cacheKey = new Request(`${workerOrigin}/.__rate_limit/${fingerprint}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  const count = cached ? Number(await cached.text()) || 0 : 0;

  if (count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter };
  }

  await cache.put(cacheKey, new Response(String(count + 1), {
    headers: {
      "Cache-Control": `max-age=${retryAfter}`,
      "Content-Type": "text/plain; charset=utf-8"
    }
  }));

  return { allowed: true, retryAfter: 0 };
}

async function createConsentReceipt(body) {
  const canonical = JSON.stringify({
    requestId: String(body.requestId),
    checkType: String(body.checkType),
    purpose: String(body.purpose),
    state: String(body.state),
    consentTimestamp: String(body.consentTimestamp),
    subject: "D*** U***",
    dob: "1990-**-**",
    ssn: "***-**-3456"
  });

  return sha256Hex(canonical);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function securityHeaders(allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-VeriCore-Client, X-Request-Id",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }

  return headers;
}

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
