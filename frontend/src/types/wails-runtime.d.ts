declare module '/wails/runtime.js' {
  export const Call: {
    ByName(methodName: string, ...args: any[]): Promise<any>
    ByID(methodID: number, ...args: any[]): Promise<any>
  }
  export const Events: {
    On(event: string, callback: (...args: any[]) => void): () => void
    Emit(event: string, ...args: any[]): void
    Off(event: string): void
  }
  export type CancellablePromise<T> = Promise<T> & { cancel(): void }
}
