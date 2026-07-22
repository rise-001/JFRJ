const { randomBytes } = require("node:crypto");

const COOKIE_NAME = "qingying_admin";

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, item) => {
    const separator = item.indexOf("=");
    if (separator < 0) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

class AdminAuth {
  constructor({ sessionHours = 12, cookieSecure = false } = {}) {
    this.sessionTtlMs = sessionHours * 60 * 60 * 1000;
    this.cookieSecure = cookieSecure;
    this.sessions = new Map();
    this.attempts = new Map();
  }

  getSession(request) {
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return { token, ...session };
  }

  isAuthenticated(request) {
    return Boolean(this.getSession(request));
  }

  createSession(response) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.sessionTtlMs;
    this.sessions.set(token, { expiresAt });
    const secure = this.cookieSecure ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionTtlMs / 1000)}${secure}`
    );
  }

  destroySession(request, response) {
    const session = this.getSession(request);
    if (session) this.sessions.delete(session.token);
    const secure = this.cookieSecure ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  }

  getAttemptState(ip) {
    const now = Date.now();
    const state = this.attempts.get(ip);
    if (!state || state.resetAt <= now) {
      const next = { count: 0, resetAt: now + 5 * 60 * 1000 };
      this.attempts.set(ip, next);
      return next;
    }
    return state;
  }

  canAttempt(ip) {
    const state = this.getAttemptState(ip);
    return { allowed: state.count < 5, retryAfter: Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000)) };
  }

  recordFailure(ip) {
    this.getAttemptState(ip).count += 1;
  }

  clearFailures(ip) {
    this.attempts.delete(ip);
  }
}

module.exports = { AdminAuth };
