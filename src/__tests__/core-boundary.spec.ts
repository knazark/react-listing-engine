import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d: Dirent) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
}

describe('core boundary', () => {
  it('no file under src/core imports react', () => {
    const offenders = walk('src/core')
      .filter(f => f.endsWith('.ts'))
      .filter(f => /from ['"]react['"]|from ['"]react-dom['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
