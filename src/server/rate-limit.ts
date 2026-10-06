/**
 * In-memory limits for the public demo. One process, no accounts, so this is
 * deliberately simple: a sliding window per client IP plus a global daily cap
 * that bounds total spend whatever the traffic.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private day = "";
  private dayCount = 0;

  constructor(
    private perIpLimit: number,
    private windowMs: number,
    private dailyCap: number,
  ) {}

  check(ip: string, now = Date.now()): { ok: true } | { ok: false; reason: string; retryAfterSec: number } {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dayCount = 0;
    }
    if (this.dayCount >= this.dailyCap) {
      return { ok: false, reason: "The live demo has reached today's generation limit.", retryAfterSec: 3600 };
    }
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.perIpLimit) {
      const retryAfterSec = Math.ceil((this.windowMs - (now - recent[0]!)) / 1000);
      return { ok: false, reason: `You've run ${this.perIpLimit} live generations recently.`, retryAfterSec };
    }
    recent.push(now);
    this.hits.set(ip, recent);
    this.dayCount++;
    if (this.hits.size > 10_000) this.prune(now);
    return { ok: true };
  }

  private prune(now: number) {
    for (const [ip, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(ip);
    }
  }
}
