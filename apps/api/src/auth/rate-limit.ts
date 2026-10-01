export function createLoginLimiter(now: () => number = Date.now, maxKeys = 10000) {
  const clients = new Map<string, { count: number; resetAt: number }>();
  return (ip: string): number => {
    const time = now();
    // Prune expired entries; refuse new keys at capacity rather than evicting active limits.
    for (const [key, value] of clients) if (value.resetAt <= time) clients.delete(key);
    let entry = clients.get(ip);
    if (!entry) {
      if (clients.size >= maxKeys) return 60;
      entry = { count: 0, resetAt: time + 60000 };
      clients.set(ip, entry);
    }
    if (entry.count >= 10) return Math.max(1, Math.ceil((entry.resetAt - time) / 1000));
    entry.count++;
    return 0;
  };
}
