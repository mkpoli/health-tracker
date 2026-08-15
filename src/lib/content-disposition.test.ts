import { describe, expect, it } from 'vitest';
import { attachmentContentDisposition } from './content-disposition';

describe('attachmentContentDisposition', () => {
  it('encodes Unicode and header delimiters', () => {
    expect(attachmentContentDisposition("運動 (最終)\n.csv")).toBe(
      "attachment; filename*=UTF-8''%E9%81%8B%E5%8B%95%20%28%E6%9C%80%E7%B5%82%29%0A.csv",
    );
  });

  it('replaces unpaired UTF-16 surrogates without losing valid pairs', () => {
    expect(attachmentContentDisposition(`hevy-\ud800-🏋️-\udc00.csv`)).toBe(
      "attachment; filename*=UTF-8''hevy-%EF%BF%BD-%F0%9F%8F%8B%EF%B8%8F-%EF%BF%BD.csv",
    );
  });
});
