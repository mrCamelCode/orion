export function waitFor(predicate: () => boolean, pollMs = 100): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        
        resolve();
      }
    }, pollMs);
  })
}