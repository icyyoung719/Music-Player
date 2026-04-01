type Unsubscribe = () => void
type EventListener = (payload: unknown) => void
type EventHandler = (payload: unknown) => unknown | Promise<unknown>

function createNoopUnsubscribe(): Unsubscribe {
  return () => {}
}

export function createEventBus() {
  const listenersByEvent = new Map<string, Set<EventListener>>()
  const handlersByEvent = new Map<string, EventHandler>()

  function on(eventName: string, listener: EventListener): Unsubscribe {
    if (typeof listener !== 'function') return createNoopUnsubscribe()
    const key = String(eventName || '').trim()
    if (!key) return createNoopUnsubscribe()

    const listeners = listenersByEvent.get(key) || new Set<EventListener>()
    listeners.add(listener)
    listenersByEvent.set(key, listeners)

    return () => {
      const current = listenersByEvent.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        listenersByEvent.delete(key)
      }
    }
  }

  function once(eventName: string, listener: EventListener): Unsubscribe {
    if (typeof listener !== 'function') return createNoopUnsubscribe()

    let unsubscribe: Unsubscribe = createNoopUnsubscribe()
    const wrapped: EventListener = (payload: unknown) => {
      unsubscribe()
      listener(payload)
    }
    unsubscribe = on(eventName, wrapped)
    return unsubscribe
  }

  function emit(eventName: string, payload?: unknown): void {
    const key = String(eventName || '').trim()
    if (!key) return
    const listeners = listenersByEvent.get(key)
    if (!listeners || listeners.size === 0) return

    for (const listener of Array.from(listeners)) {
      try {
        listener(payload)
      } catch (err) {
        console.warn(`Event listener failed: ${key}`, err)
      }
    }
  }

  function handle(eventName: string, handler: EventHandler): Unsubscribe {
    if (typeof handler !== 'function') return createNoopUnsubscribe()
    const key = String(eventName || '').trim()
    if (!key) return createNoopUnsubscribe()

    handlersByEvent.set(key, handler)
    return () => {
      const current = handlersByEvent.get(key)
      if (current === handler) {
        handlersByEvent.delete(key)
      }
    }
  }

  async function request(eventName: string, payload?: unknown): Promise<unknown> {
    const key = String(eventName || '').trim()
    if (!key) return undefined
    const handler = handlersByEvent.get(key)
    if (typeof handler !== 'function') return undefined
    try {
      return await handler(payload)
    } catch (err) {
      console.warn(`Event request handler failed: ${key}`, err)
      return undefined
    }
  }

  return {
    on,
    once,
    emit,
    handle,
    request
  }
}
