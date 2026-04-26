export type Unsubscribe = () => void
export type EventListener<TPayload = unknown> = (payload: TPayload) => void
export type EventHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => TResult | Promise<TResult>

export type EventBus = {
  on: <TPayload = unknown>(eventName: string, listener: EventListener<TPayload>) => Unsubscribe
  once: <TPayload = unknown>(eventName: string, listener: EventListener<TPayload>) => Unsubscribe
  emit: <TPayload = unknown>(eventName: string, payload?: TPayload) => void
  handle: <TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: EventHandler<TPayload, TResult>
  ) => Unsubscribe
  request: <TPayload = unknown, TResult = unknown>(eventName: string, payload?: TPayload) => Promise<TResult | undefined>
}

function createNoopUnsubscribe(): Unsubscribe {
  return () => {}
}

export function createEventBus(): EventBus {
  const listenersByEvent = new Map<string, Set<EventListener<unknown>>>()
  const handlersByEvent = new Map<string, EventHandler<unknown, unknown>>()

  function on<TPayload = unknown>(eventName: string, listener: EventListener<TPayload>): Unsubscribe {
    if (typeof listener !== 'function') return createNoopUnsubscribe()
    const key = String(eventName || '').trim()
    if (!key) return createNoopUnsubscribe()

    const listeners = listenersByEvent.get(key) || new Set<EventListener<unknown>>()
    listeners.add(listener as EventListener<unknown>)
    listenersByEvent.set(key, listeners)

    return () => {
      const current = listenersByEvent.get(key)
      if (!current) return
      current.delete(listener as EventListener<unknown>)
      if (current.size === 0) {
        listenersByEvent.delete(key)
      }
    }
  }

  function once<TPayload = unknown>(eventName: string, listener: EventListener<TPayload>): Unsubscribe {
    if (typeof listener !== 'function') return createNoopUnsubscribe()

    let unsubscribe: Unsubscribe = createNoopUnsubscribe()
    const wrapped: EventListener<TPayload> = (payload: TPayload) => {
      unsubscribe()
      listener(payload)
    }
    unsubscribe = on(eventName, wrapped)
    return unsubscribe
  }

  function emit<TPayload = unknown>(eventName: string, payload?: TPayload): void {
    const key = String(eventName || '').trim()
    if (!key) return
    const listeners = listenersByEvent.get(key)
    if (!listeners || listeners.size === 0) return

    for (const listener of Array.from(listeners)) {
      try {
        listener(payload as unknown)
      } catch (err) {
        console.warn(`Event listener failed: ${key}`, err)
      }
    }
  }

  function handle<TPayload = unknown, TResult = unknown>(
    eventName: string,
    handler: EventHandler<TPayload, TResult>
  ): Unsubscribe {
    if (typeof handler !== 'function') return createNoopUnsubscribe()
    const key = String(eventName || '').trim()
    if (!key) return createNoopUnsubscribe()

    handlersByEvent.set(key, handler as EventHandler<unknown, unknown>)
    return () => {
      const current = handlersByEvent.get(key)
      if (current === (handler as EventHandler<unknown, unknown>)) {
        handlersByEvent.delete(key)
      }
    }
  }

  async function request<TPayload = unknown, TResult = unknown>(
    eventName: string,
    payload?: TPayload
  ): Promise<TResult | undefined> {
    const key = String(eventName || '').trim()
    if (!key) return undefined
    const handler = handlersByEvent.get(key)
    if (typeof handler !== 'function') return undefined
    try {
      return (await handler(payload as unknown)) as TResult
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
