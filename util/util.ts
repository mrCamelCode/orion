export function waitFor(predicate: () => boolean, pollMs = 100): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);

        resolve();
      }
    }, pollMs);
  });
}

export function generateBase36Id(length = 5): string {
  return new Array(length)
    .fill(0)
    .map(() => randRange(0, 36).toString(36).toUpperCase())
    .join('');
}

function randRange(inclusiveMin = 0, exlusiveMax = 100) {
  const minCeiled = Math.ceil(inclusiveMin);
  const maxFloored = Math.floor(exlusiveMax);

  return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}
