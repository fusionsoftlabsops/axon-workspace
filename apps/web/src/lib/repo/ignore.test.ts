import { describe, expect, it } from 'vitest';
import {
  isIgnoredDir,
  isIgnoredFile,
  looksBinary,
  DEFAULT_IGNORE_DIRS,
  DOTFILE_WHITELIST,
} from './ignore';

describe('isIgnoredDir', () => {
  it.each([
    ['.git', true],
    ['node_modules', true],
    ['dist', true],
    ['target', true],
    ['vendor', true],
    ['.terraform', true],
    ['src', false],
    ['lib', false],
    ['app', false],
  ])('%s -> %s', (name, expected) => {
    expect(isIgnoredDir(name)).toBe(expected);
  });

  it('matches every entry in DEFAULT_IGNORE_DIRS', () => {
    for (const d of DEFAULT_IGNORE_DIRS) expect(isIgnoredDir(d)).toBe(true);
  });
});

describe('isIgnoredFile', () => {
  it.each([
    // soft-ignore lockfiles
    ['pnpm-lock.yaml', true],
    ['package-lock.json', true],
    ['Cargo.lock', true],
    // binary / media extensions
    ['logo.png', true],
    ['photo.JPG', true], // case-insensitive
    ['archive.zip', true],
    ['cert.pem', true],
    ['.env', true],
    // generated
    ['bundle.min.js', true],
    ['styles.min.css', true],
    ['app.js.map', true],
    // text files kept
    ['index.ts', false],
    ['README.md', false],
    ['Dockerfile', false], // no extension
    ['main.go', false],
  ])('%s -> %s', (name, expected) => {
    expect(isIgnoredFile(name)).toBe(expected);
  });

  it('returns false for a name with no dot and not soft-ignored', () => {
    expect(isIgnoredFile('Makefile')).toBe(false);
  });

  it('does not ignore whitelisted-style dotfiles by extension', () => {
    // .gitignore has no "extension" past the leading dot beyond 'gitignore'
    expect(isIgnoredFile('.gitignore')).toBe(false);
    expect(DOTFILE_WHITELIST.has('.gitignore')).toBe(true);
  });
});

describe('looksBinary', () => {
  it('returns false for an empty buffer', () => {
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });

  it('returns false for plain ascii text (with tabs/newlines)', () => {
    expect(looksBinary(Buffer.from('hello\tworld\nfoo bar\r\n'))).toBe(false);
  });

  it('returns true when a null byte is present', () => {
    expect(looksBinary(Buffer.from([0x68, 0x69, 0x00, 0x69]))).toBe(true);
  });

  it('returns true when more than 30% of bytes are non-printable', () => {
    // half control chars (0x01) — well over the 30% threshold
    const bytes = Buffer.from([0x41, 0x01, 0x42, 0x01, 0x43, 0x01]);
    expect(looksBinary(bytes)).toBe(true);
  });

  it('returns false when only a few non-printables are present', () => {
    const bytes = Buffer.from([0x41, 0x42, 0x43, 0x44, 0x45, 0x01]); // ~16%
    expect(looksBinary(bytes)).toBe(false);
  });
});
