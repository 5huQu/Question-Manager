export type AutosaveState = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict'

export class TeachingDocumentAutosave<T> {
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight = false
  private queued = false
  private stopped = false
  private dirty = false

  constructor(
    private readonly read: () => T,
    private readonly write: (value: T) => Promise<void>,
    private readonly onState: (state: AutosaveState, error?: unknown) => void,
    private readonly delay = 800,
  ) {}

  changed() {
    if (this.stopped) return
    this.dirty = true
    this.onState('dirty')
    if (this.inFlight) {
      this.queued = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delay)
  }

  async flush() {
    if (this.stopped) return
    if (!this.dirty) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.inFlight) {
      this.queued = true
      return
    }
    this.inFlight = true
    this.dirty = false
    this.onState('saving')
    try {
      await this.write(this.read())
      if (this.queued) {
        this.queued = false
        this.inFlight = false
        await this.flush()
        return
      }
      this.onState('saved')
    } catch (error) {
      this.queued = false
      this.dirty = true
      const conflict = Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409)
      if (conflict) {
        this.stopped = true
        this.onState('conflict', error)
      } else {
        this.onState('failed', error)
      }
    } finally {
      this.inFlight = false
    }
  }

  resume() {
    this.stopped = false
  }

  dispose() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
