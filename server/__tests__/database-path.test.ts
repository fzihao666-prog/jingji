import { describe, expect, it } from 'vitest';
import { getDatabasePath, getDatabaseBackupDirectory } from '../core/database-path.ts';

describe('database paths', () => {
  it('uses one default database location under the project data directory', () => {
    expect(getDatabasePath('/srv/jingji')).toBe('/srv/jingji/data/training-monitor.db');
  });

  it('resolves configured database paths and places backups beside that database', () => {
    const databasePath = getDatabasePath('/srv/jingji', 'var/runtime.db');

    expect(databasePath).toBe('/srv/jingji/var/runtime.db');
    expect(getDatabaseBackupDirectory(databasePath)).toBe('/srv/jingji/var/backups');
  });
});
