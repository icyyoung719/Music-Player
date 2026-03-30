function createNoopUnsubscribe() {
  return () => {}
}

export function createEventBus() {
  const listenersByEvent = new Map()
  const handlersByEvent = new Map()

  function on(eventName, listener) {
    if (typeof listener !== 'function') return createNoopUnsubscribe()
    const key = String(eventName || '').trim()
    if (!key) return createNoopUnsubscribe()

    const listeners = listenersByEvent.get(key) || new Set()
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

  function once(eventName, listener) {
    if (typeof listener !== 'function') return createNoopUnsubscribe()

    let unsubscribe = createNoopUnsubscribe()
    const wrapped = (payload) => {
      unsubscribe()
      listener(payload)
    }
    unsubscribe = on(eventName, wrapped)
    return unsubscribe
  }

  function emit(eventName, payload) {
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

  function handle(eventName, handler) {
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

  async function request(eventName, payload) {
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