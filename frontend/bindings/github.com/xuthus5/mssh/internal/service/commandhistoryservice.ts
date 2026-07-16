import { Call as $Call, CancellablePromise as $CancellablePromise } from "@wailsio/runtime";
export function Add(sessionID: number, command: string): $CancellablePromise<any> { return $Call.ByName("github.com/xuthus5/mssh/internal/service.CommandHistoryService.Add", sessionID, command); }
export function List(sessionID: number, query: string): $CancellablePromise<any[]> { return $Call.ByName("github.com/xuthus5/mssh/internal/service.CommandHistoryService.List", sessionID, query); }
export function Delete(id: number): $CancellablePromise<void> { return $Call.ByName("github.com/xuthus5/mssh/internal/service.CommandHistoryService.Delete", id); }
export function Clear(sessionID: number): $CancellablePromise<void> { return $Call.ByName("github.com/xuthus5/mssh/internal/service.CommandHistoryService.Clear", sessionID); }
