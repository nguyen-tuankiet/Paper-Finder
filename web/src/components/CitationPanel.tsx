import { BookOutlined } from '@ant-design/icons';
import { Button, Checkbox, Select, Typography } from 'antd';
import type { PaperRecord } from '../../../shared/types';
import { CITATION_STYLE_LABELS, formatReference, type CitationStyle } from '../lib/citation';

const STYLE_HELP: Record<CitationStyle, string> = {
  ieee: 'đánh số [1], [2]... (kiểu hay dùng trong kỹ thuật, công nghệ)',
  apa: 'xếp theo tên tác giả, ghi (năm) sau tên (kiểu hay dùng trong giáo dục, xã hội)',
  basic: 'Tác giả, Tên bài, Tạp chí (tập), số, năm, trang',
};

interface Props {
  style: CitationStyle;
  onStyleChange: (style: CitationStyle) => void;
  includeDoi: boolean;
  onIncludeDoiChange: (value: boolean) => void;
  /** Các bài sẽ được sao chép. */
  targets: PaperRecord[];
  /** true: người dùng đã tick chọn bài; false: sao chép toàn bộ kết quả đang lọc. */
  fromSelection: boolean;
  onCopy: () => void;
}

/** Khu vực "Sao chép tài liệu tham khảo": chọn kiểu, xem trước một ví dụ, rồi bấm sao chép. */
export function CitationPanel({ style, onStyleChange, includeDoi, onIncludeDoiChange, targets, fromSelection, onCopy }: Props) {
  const example = targets[0] ? formatReference(targets[0], { style, includeDoi }) : '';

  return (
    <div className="pf-cite" role="group" aria-label="Sao chép tài liệu tham khảo">
      <div className="pf-cite-head">
        <BookOutlined /> <b>Sao chép tài liệu tham khảo</b>
        <Typography.Text type="secondary"> — để dán vào báo cáo, luận văn</Typography.Text>
      </div>

      <div className="pf-cite-row">
        <label htmlFor="pf-cite-style" className="pf-cite-label">
          1. Chọn kiểu ghi
        </label>
        <Select<CitationStyle>
          id="pf-cite-style"
          value={style}
          onChange={onStyleChange}
          style={{ minWidth: 260 }}
          optionLabelProp="shortLabel"
          options={(Object.keys(CITATION_STYLE_LABELS) as CitationStyle[]).map((value) => ({
            value,
            shortLabel: CITATION_STYLE_LABELS[value],
            label: (
              <div>
                <b>{CITATION_STYLE_LABELS[value]}</b>
                <div style={{ fontSize: 12, color: '#6b7785', whiteSpace: 'normal' }}>{STYLE_HELP[value]}</div>
              </div>
            ),
          }))}
        />
        {style === 'basic' && (
          <Checkbox checked={includeDoi} onChange={(e) => onIncludeDoiChange(e.target.checked)}>
            Kèm DOI ở cuối
          </Checkbox>
        )}
      </div>

      <div className="pf-cite-row">
        <span className="pf-cite-label">Ví dụ kiểu này</span>
        <div className="pf-cite-example">{example || 'Chưa có bài nào để xem trước.'}</div>
      </div>

      <div className="pf-cite-row">
        <span className="pf-cite-label">2. Sao chép</span>
        <Button type="primary" icon={<BookOutlined />} disabled={targets.length === 0} onClick={onCopy}>
          {fromSelection ? `Sao chép ${targets.length} bài đã chọn` : `Sao chép ${targets.length} bài đang lọc`}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          {fromSelection ? 'Bỏ chọn hết để sao chép toàn bộ kết quả đang lọc.' : 'Muốn chỉ lấy một số bài: tick chọn các bài trong bảng bên dưới.'}
        </Typography.Text>
      </div>
    </div>
  );
}
