export const migrations: string[];
export function runMigrations(
  pool: unknown,
  logger?: { log: (message: string) => void },
): Promise<void>;
