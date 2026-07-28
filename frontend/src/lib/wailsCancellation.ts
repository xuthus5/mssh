interface SignalCancellablePromise<T> extends Promise<T> {
  cancelOn?: (signal: AbortSignal) => Promise<T>
}

export function bindWailsCallToSignal<T>(call: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return call
  const cancellable = call as SignalCancellablePromise<T>
  return cancellable.cancelOn ? cancellable.cancelOn(signal) : call
}
