import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  CATEGORY_ORDER,
  CATEGORY_LABEL,
  categorize,
  formatBytes,
} from './files';

describe('MAX_FILE_BYTES', () => {
  it('is 100 MB', () => {
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe('categorize', () => {
  it('classifies by mime media prefixes', () => {
    expect(categorize('image/png')).toBe('IMAGE');
    expect(categorize('audio/mpeg')).toBe('AUDIO');
    expect(categorize('video/mp4')).toBe('VIDEO');
  });

  it('classifies PDFs by mime and by extension', () => {
    expect(categorize('application/pdf')).toBe('PDF');
    expect(categorize('', 'report.PDF')).toBe('PDF');
  });

  it('classifies spreadsheets by mime and extension', () => {
    expect(categorize('application/vnd.ms-excel.spreadsheet')).toBe('SPREADSHEET');
    expect(categorize('text/csv')).toBe('SPREADSHEET');
    expect(categorize('', 'data.xlsx')).toBe('SPREADSHEET');
  });

  it('classifies presentations', () => {
    expect(categorize('application/vnd.ms-powerpoint.presentation')).toBe('PRESENTATION');
    expect(categorize('', 'deck.pptx')).toBe('PRESENTATION');
  });

  it('classifies documents by mime and extension', () => {
    expect(categorize('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      'DOCUMENT',
    );
    expect(categorize('application/msword')).toBe('DOCUMENT');
    expect(categorize('application/rtf')).toBe('DOCUMENT');
    expect(categorize('', 'notes.md')).toBe('DOCUMENT');
  });

  it('classifies archives by mime and extension', () => {
    expect(categorize('application/zip')).toBe('ARCHIVE');
    expect(categorize('application/x-compressed')).toBe('ARCHIVE');
    expect(categorize('application/x-tar')).toBe('ARCHIVE');
    expect(categorize('application/gzip')).toBe('ARCHIVE');
    expect(categorize('', 'bundle.7z')).toBe('ARCHIVE');
  });

  it('classifies code/text by mime and extension', () => {
    expect(categorize('application/json')).toBe('CODE');
    expect(categorize('text/plain')).toBe('CODE');
    expect(categorize('', 'main.ts')).toBe('CODE');
  });

  it('falls back to OTHER for unknown types', () => {
    expect(categorize('application/octet-stream', 'mystery.bin')).toBe('OTHER');
    expect(categorize('')).toBe('OTHER');
  });
});

describe('CATEGORY_ORDER / CATEGORY_LABEL', () => {
  it('lists all ten categories in order', () => {
    expect(CATEGORY_ORDER).toHaveLength(10);
    expect(CATEGORY_ORDER[0]).toBe('IMAGE');
    expect(CATEGORY_ORDER.at(-1)).toBe('OTHER');
  });

  it('has bilingual labels for every ordered category', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABEL[cat]).toHaveProperty('es');
      expect(CATEGORY_LABEL[cat]).toHaveProperty('en');
    }
  });
});

describe('formatBytes', () => {
  it('shows raw bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats KB with one decimal when below 10', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats MB and GB', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('drops the decimal when the value is 10 or more', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
  });

  it('caps the unit at GB for very large sizes', () => {
    expect(formatBytes(2048 * 1024 * 1024 * 1024)).toBe('2048 GB');
  });
});
