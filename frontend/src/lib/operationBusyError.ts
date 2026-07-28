export class OperationBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationBusyError'
  }
}

export function isOperationBusyError(error: unknown): error is OperationBusyError {
  return error instanceof OperationBusyError
}
