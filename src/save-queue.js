// One writer, with a fresh snapshot after edits made while a write is in flight.
export class SaveQueue {
  constructor(snapshot, write, status = (_state) => {}) {
    this.snapshot = snapshot;
    this.write = write;
    this.status = status;
    this.version = 0;
    this.saved = 0;
    this.running = null;
  }
  mark() { this.version++; this.status('dirty'); }
  get dirty() { return this.saved < this.version; }
  async flush() {
    if (this.running) return this.running;
    this.running = this.drain();
    try { await this.running; } finally { this.running = null; }
  }
  async drain() {
    while (this.dirty) {
      const version = this.version;
      const value = structuredClone(this.snapshot());
      this.status('saving');
      try { await this.write(value); }
      catch (error) { this.status('error'); throw error; }
      this.saved = version;
    }
    this.status('saved');
  }
}
