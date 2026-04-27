// Юнит-тесты JWT логики в src/lib/onlyoffice/index.ts.
//
// Критичный модуль — эти JWT используются для:
//   1) Подписи конфига OnlyOffice editor (предотвращает подмену url файла)
//   2) Проверки callback'а от OO Document Server (только OO может сохранять)
//   3) ooToken для публичного скачивания docs (одноразовый, с exp)
//
// Без этой подписи любой может подделать callback и записать произвольный файл.
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

async function loadWith(secret: string | undefined) {
  if (secret === undefined) delete process.env.ONLYOFFICE_JWT_SECRET;
  else process.env.ONLYOFFICE_JWT_SECRET = secret;
  return import('@/lib/onlyoffice');
}

describe('signJwt: без секрета', () => {
  it('бросает явную ошибку (отказ работать вместо тихого change-me-in-production)', async () => {
    const { signJwt } = await loadWith(undefined);
    expect(() => signJwt({ k: 'v' }))
      .toThrow(/ONLYOFFICE_JWT_SECRET/);
  });

  it('verifyJwt без секрета возвращает null (не пропускает фейк-подпись)', async () => {
    const { verifyJwt } = await loadWith(undefined);
    expect(verifyJwt('a.b.c')).toBeNull();
  });
});

describe('signJwt + verifyJwt round-trip', () => {
  const SECRET = 'test-secret-32-bytes-aaaabbbbccccdddd';

  it('подписанный токен валидируется и payload распарсен', async () => {
    const { signJwt, verifyJwt } = await loadWith(SECRET);
    const token = signJwt({ p: '/api/files/docs/x.docx', exp: 9999999999 });
    const parsed = verifyJwt<{ p: string; exp: number }>(token);
    expect(parsed).toMatchObject({ p: '/api/files/docs/x.docx', exp: 9999999999 });
  });

  it('токен с другим секретом отвергается', async () => {
    const { signJwt }   = await loadWith(SECRET);
    const token = signJwt({ p: '/x' });

    // Сейчас перезагружаем модуль с другим секретом
    vi.resetModules();
    const { verifyJwt } = await loadWith('different-secret-aaaaaaaaaaaaaaaa');
    expect(verifyJwt(token)).toBeNull();
  });

  it('испорченный payload (изменённый после подписи) отвергается', async () => {
    const { signJwt, verifyJwt } = await loadWith(SECRET);
    const token = signJwt({ p: '/api/files/docs/legitimate.docx' });
    const [h, , s] = token.split('.');
    // Подменяем payload на другой путь — подпись останется старой
    const fakePayload = Buffer.from(JSON.stringify({ p: '/api/files/docs/../../../etc/passwd' }))
      .toString('base64url');
    const tampered = `${h}.${fakePayload}.${s}`;
    expect(verifyJwt(tampered)).toBeNull();
  });

  it('мусорная строка вместо токена не падает — возвращает null', async () => {
    const { verifyJwt } = await loadWith(SECRET);
    expect(verifyJwt('not.a.token')).toBeNull();
    expect(verifyJwt('garbage'    )).toBeNull();
    expect(verifyJwt('a.b'        )).toBeNull(); // одной части не хватает
    expect(verifyJwt(''           )).toBeNull();
  });

  it('подписи разной длины не ломают timingSafeEqual', async () => {
    const { verifyJwt } = await loadWith(SECRET);
    // h.payload.short_signature — подпись короче ожидаемой
    const fake = `aGVsbG8.${Buffer.from('{}').toString('base64url')}.short`;
    expect(verifyJwt(fake)).toBeNull(); // не throw, вернул null
  });
});

describe('getDocumentType / getFileExtension', () => {
  const SECRET = 'test-secret-32-bytes-aaaabbbbccccdddd';

  it('DOCX → word/docx', async () => {
    const { getDocumentType, getFileExtension } = await loadWith(SECRET);
    expect(getDocumentType('DOCX')).toBe('word');
    expect(getFileExtension('DOCX')).toBe('docx');
  });

  it('XLSX → cell/xlsx', async () => {
    const { getDocumentType, getFileExtension } = await loadWith(SECRET);
    expect(getDocumentType('XLSX')).toBe('cell');
    expect(getFileExtension('XLSX')).toBe('xlsx');
  });

  it('PPTX → slide/pptx', async () => {
    const { getDocumentType, getFileExtension } = await loadWith(SECRET);
    expect(getDocumentType('PPTX')).toBe('slide');
  });

  it('PDF → pdf/pdf', async () => {
    const { getDocumentType, getFileExtension } = await loadWith(SECRET);
    expect(getDocumentType('PDF')).toBe('pdf');
    expect(getFileExtension('PDF')).toBe('pdf');
  });
});
