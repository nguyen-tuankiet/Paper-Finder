import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Loại ký tự điều khiển không hợp lệ trong XML (Word sẽ báo file hỏng nếu để lọt). */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const clean = (text: string) => text.replace(INVALID_XML, '').replace(/\s+/g, ' ').trim();

/**
 * File Word chứa danh sách tài liệu tham khảo đã được giao diện định dạng sẵn (IEEE, APA 7...):
 * tiêu đề giữa trang, mỗi tài liệu một đoạn, thụt dòng treo 1,27 cm, Times New Roman 13, giãn dòng 1,5.
 * Giữ nguyên thứ tự và đánh số mà giao diện đã làm; không tự thêm hay sửa nội dung trích dẫn.
 */
export async function buildReferencesDocx(lines: string[], title = 'TÀI LIỆU THAM KHẢO'): Promise<Buffer> {
  const font = 'Times New Roman';
  const paragraphs = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: title, bold: true, font, size: 26 })] }),
    ...lines
      .map(clean)
      .filter(Boolean)
      .map(
        (line) =>
          new Paragraph({
            indent: { left: 720, hanging: 720 },
            spacing: { after: 120, line: 360 },
            alignment: AlignmentType.JUSTIFIED,
            children: [new TextRun({ text: line, font, size: 26 })],
          }),
      ),
  ];
  const doc = new Document({
    creator: 'PaperFinder',
    title,
    styles: { default: { document: { run: { font, size: 26 } } } },
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}
