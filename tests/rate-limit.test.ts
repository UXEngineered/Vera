import { expect, test } from "bun:test";
import { RateLimiter } from "../src/server/rate-limit.ts";

test("limits per IP within the window, then frees up", () => {
  const rl = new RateLimiter(2, 60_000, 100);
  expect(rl.check("a", 0).ok).toBe(true);
  expect(rl.check("a", 1).ok).toBe(true);
  const blocked = rl.check("a", 2);
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) expect(blocked.retryAfterSec).toBe(60);
  expect(rl.check("b", 3).ok).toBe(true);
  expect(rl.check("a", 60_001).ok).toBe(true);
});

test("global daily cap applies across IPs and resets the next day", () => {
  const rl = new RateLimiter(10, 60_000, 2);
  expect(rl.check("a", 0).ok).toBe(true);
  expect(rl.check("b", 0).ok).toBe(true);
  expect(rl.check("c", 0).ok).toBe(false);
  expect(rl.check("c", 86_400_000).ok).toBe(true);
});
