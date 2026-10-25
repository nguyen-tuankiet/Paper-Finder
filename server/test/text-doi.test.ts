import { describe, expect, it } from 'vitest';
import { doiUrl, isValidDoi, normalizeDoi } from '../src/lib/doi.js';
import {
  abstractFromInvertedIndex,
  cleanAbstract,
  cleanText,
  normalizeTitle,
  safeHttpUrl,
} from '../src/lib/text.js';

describe('normalizeDoi', () => {
  it.each([
    ['10.1016/J.CAEAI.2021.100020', '10.1016/j.caeai.2021.100020'],
    ['https://doi.org/10.1016/j.caeai.2021.100020', '10.1016/j.caeai.2021.100020'],
    ['http://dx.doi.org/10.1016/j.caeai.2021.100020', '10.1016/j.caeai.2021.100020'],
    ['doi.org/10.1000/xyz', '10.1000/xyz'],
    ['doi: 10.1000/xyz', '10.1000/xyz'],
    ['  10.1000/xyz  ', '10.1000/xyz'],
    ['https://doi.org/10.1002%2F%28SICI%291097', '10.1002/(sici)1097'],
  ])('chuẩn hóa %s', (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
  });

  it.each([null, undefined, 42, '', '   ', 'không phải doi', '10.12/abc', '11.1000/abc', 'https://example.com/10.1000/abc', '10.1000/'])(
    'trả về rỗng cho DOI thiếu hoặc không hợp lệ: %s',
    (input) => {
      expect(normalizeDoi(input)).toBe('');
    },
  );

  it('không ném lỗi với chuỗi % sai định dạng', () => {
    expect(normalizeDoi('10.1000/abc%E0%A4%A')).toBe('10.1000/abc%e0%a4%a');
  });

  it('isValidDoi và doiUrl', () => {
    expect(isValidDoi('10.1000/xyz')).toBe(true);
    expect(isValidDoi('xyz')).toBe(false);
    expect(doiUrl('10.1000/a#b?c')).toBe('https://doi.org/10.1000/a%23b%3Fc');
  });
});

describe('cleanText / cleanAbstract', () => {
  it('bỏ khoảng trắng dư và thẻ nội tuyến mà không tách từ', () => {
    expect(cleanText('  CO<sub>2</sub>   capture \n in <i>soil</i>  ')).toBe('CO2 capture in soil');
  });

  it('giải mã entity sau khi bỏ thẻ để giữ ký tự < > thật', () => {
    expect(cleanText('x &lt; y &amp; z')).toBe('x < y & z');
    expect(cleanText('Tom &#38; Jerry &#x41;')).toBe('Tom & Jerry A');
  });

  it('giữ nguyên tiếng Việt và chuẩn hóa NFC', () => {
    expect(cleanText('Trí tuệ nhân tạo trong giáo dục'.normalize('NFD'))).toBe('Trí tuệ nhân tạo trong giáo dục');
  });

  it('trả về rỗng với kiểu dữ liệu sai', () => {
    expect(cleanText(undefined)).toBe('');
    expect(cleanText(123)).toBe('');
    expect(cleanText(null)).toBe('');
  });

  it('abstract JATS của Crossref: bỏ thẻ và nhãn Abstract', () => {
    const jats = '<jats:title>Abstract</jats:title><jats:p>AI is <jats:italic>changing</jats:italic> education.</jats:p><jats:p>Second.</jats:p>';
    expect(cleanAbstract(jats)).toBe('AI is changing education. Second.');
  });

  it('không cắt nhầm từ bắt đầu bằng "Abstract"', () => {
    expect(cleanAbstract('Abstractions matter')).toBe('Abstractions matter');
    expect(cleanAbstract('Abstract')).toBe('');
  });
});

describe('normalizeTitle', () => {
  it('bỏ dấu tiếng Việt, hoa/thường và ký tự đặc biệt', () => {
    expect(normalizeTitle('Ứng dụng Trí tuệ nhân tạo: Đánh giá!')).toBe('ung dung tri tue nhan tao danh gia');
  });

  it('xử lý ký tự đặc biệt trong tiêu đề', () => {
    expect(normalizeTitle('“AI” & ML — C++/Python (2.0)?')).toBe('ai ml c python 2 0');
  });
});

describe('abstractFromInvertedIndex', () => {
  it('dựng lại văn bản theo đúng vị trí từ', () => {
    expect(abstractFromInvertedIndex({ world: [1, 3], Hello: [0], again: [4], big: [2] })).toBe('Hello world big world again');
  });

  it.each([null, undefined, 'text', 42, [], { a: 'x' }, { a: [-1, 1.5, 'x'] }])('không ném lỗi với dữ liệu sai: %j', (input) => {
    expect(abstractFromInvertedIndex(input)).toBe('');
  });

  it('bỏ qua vị trí bị thiếu (khoảng trống) thay vì in "undefined"', () => {
    expect(abstractFromInvertedIndex({ a: [0], b: [3] })).toBe('a b');
  });
});

describe('safeHttpUrl', () => {
  it('chỉ chấp nhận http(s)', () => {
    expect(safeHttpUrl('https://doi.org/10.1000/x')).toBe('https://doi.org/10.1000/x');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl('ftp://x')).toBe('');
    expect(safeHttpUrl(null)).toBe('');
  });
});
