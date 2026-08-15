interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    // Mirrors the platform's own Promise contract: a rejection reason is
    // anything that can be thrown.
    reject: (reason?: any) => void;
  };
}
