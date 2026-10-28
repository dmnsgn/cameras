/* eslint-disable @typescript-eslint/no-explicit-any */
// `importHelpers` requires tslib for native #private fields below ESNext, although no helper is emitted.
// See https://github.com/microsoft/TypeScript/issues/63728
declare module "tslib" {
  function __classPrivateFieldGet(a: any, b: any, c: any, d?: any): any;
  function __classPrivateFieldSet(a: any, b: any, c: any, d: any, e?: any): any;
  function __classPrivateFieldIn(a: any, b: any): boolean;
}
