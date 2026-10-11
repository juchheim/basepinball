/**
 * A short, timestamped event log for diagnosing render problems. It is shown on screen with
 * `?debug`, so a screenshot taken while the canvas is blank says what happened just before.
 */
export class DiagLog {
  private readonly events: string[] = [];
  private readonly t0 = performance.now();

  log(message: string): void {
    const t = ((performance.now() - this.t0) / 1000).toFixed(1).padStart(5);
    this.events.push(`${t}s ${message}`);
    if (this.events.length > 14) this.events.shift();
  }

  lines(): string[] {
    return [...this.events];
  }
}
