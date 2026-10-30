/**
 * Progress of a long run: done and total, the rate over the last few minutes (the first
 * clips of a run include loading the voice, and a shared GPU speeds up and slows down), and
 * the time left at that rate.
 */
export class Progress {
    private readonly marks: { at: number; done: number }[] = [];

    constructor(readonly total: number, public done = 0, private readonly windowMs = 5 * 60_000) {}

    tick(done: number, now: number): void {
        this.done = done;
        this.marks.push({ at: now, done });
        while (this.marks.length > 2 && now - this.marks[0].at > this.windowMs) this.marks.shift();
    }

    /** Items per second over the window, or 0 before there is any. */
    rate(): number {
        if (this.marks.length < 2) return 0;
        const first = this.marks[0];
        const last = this.marks[this.marks.length - 1];
        return last.at === first.at ? 0 : ((last.done - first.done) * 1000) / (last.at - first.at);
    }

    /** Seconds left at the current rate, or undefined until there is a rate. */
    secondsLeft(): number | undefined {
        const rate = this.rate();
        return rate > 0 ? (this.total - this.done) / rate : undefined;
    }
}

export function formatDuration(seconds: number | undefined): string {
    if (seconds === undefined || !Number.isFinite(seconds)) return 'estimating...';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m > 0) return `${m} min`;
    return `${s} s`;
}

export function formatProgressLine(progress: Progress, bytes: number): string {
    const pct = progress.total === 0 ? 100 : (100 * progress.done) / progress.total;
    return [
        `${progress.done.toLocaleString('en-US')} / ${progress.total.toLocaleString('en-US')} (${pct.toFixed(1)}%)`,
        `${progress.rate().toFixed(2)} clips/s`,
        `${formatDuration(progress.secondsLeft())} left`,
        `${(bytes / 1e6).toFixed(0)} MB on disk`,
    ].join('  ·  ');
}
