type Listener<T> = (event: T) => void;

/** Same as `addEventListener` options. */
interface ListenerOptions {
  once?: boolean;
  signal?: AbortSignal;
}

/** Minimal typed event emitter. */
class Emitter<EventMap extends object> {
  #listeners: { [K in keyof EventMap]?: Set<Listener<EventMap[K]>> } = {};

  /**
   * Add a listener. Remove it with the returned function or an `AbortSignal`.
   *
   * @returns A function removing the listener.
   */
  public on<K extends keyof EventMap>(
    type: K,
    listener: Listener<EventMap[K]>,
    { once, signal }: ListenerOptions = {},
  ): () => void {
    if (signal?.aborted) return () => {};

    const listeners = (this.#listeners[type] ||= new Set());
    const off = () => {
      listeners.delete(wrapped);
      signal?.removeEventListener("abort", off);
    };
    const wrapped: Listener<EventMap[K]> = once
      ? (event) => {
          off();
          listener(event);
        }
      : listener;

    listeners.add(wrapped);
    signal?.addEventListener("abort", off, { once: true });

    return off;
  }

  protected emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    this.#listeners[type]?.forEach((listener) => listener(event));
  }

  protected removeAllListeners(): void {
    this.#listeners = {};
  }
}

export type { Listener, ListenerOptions };
export default Emitter;
