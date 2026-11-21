export function streamLifecycle(): {
  request(id: string): void;
  response(id: string, type: string, status: number): void;
  finished(id: string): void;
  failed(id: string, error: string): void;
  snapshot(active: Set<string>): {
    events: unknown[];
    truncated: boolean;
    active_count: number;
    active_requests: (number | "unknown")[];
  };
};
