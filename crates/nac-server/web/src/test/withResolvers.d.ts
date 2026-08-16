interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    // Rejection reasons cross an unchecked boundary, so represent the
    // platform's unrestricted value without weakening type safety.
    reject: (reason?: unknown) => void;
  };
}
