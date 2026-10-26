import { BookOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Input, InputNumber, Select, Space, Tag, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useRef } from 'react';
import type { PaperRecord } from '../../../shared/types';
import { CITATION_STYLE_LABELS, formatReference, type CitationStyle } from '../lib/citation';
import { usePanelOpen } from '../lib/citationStyle';
import {
  AUTHOR_FORMAT_LABELS,
  AUTHOR_JOIN_LABELS,
  CUSTOM_FIELDS,
  CUSTOM_PRESETS,
  DEFAULT_CUSTOM,
  LIST_ORDER_LABELS,
  unknownPlaceholders,
  type AuthorFormat,
  type AuthorJoin,
  type CustomCitationConfig,
  type ListOrder,
} from '../lib/customCitation';

const STYLE_HELP: Record<CitationStyle, string> = {
  ieee: 'đánh số [1], [2]... (kỹ thuật, công nghệ)',
  apa: 'xếp theo tên tác giả, ghi (năm) sau tên (giáo dục, xã hội)',
  basic: 'Tác giả, Tên bài, Tạp chí (tập), số, năm, trang',
  custom: 'tự soạn mẫu bằng các trường {authors}, {title}...',
};

interface Props {
  style: CitationStyle;
  onStyleChange: (style: CitationStyle) => void;
  includeDoi: boolean;
  onIncludeDoiChange: (value: boolean) => void;
  custom: CustomCitationConfig;
  onCustomChange: (config: CustomCitationConfig) => void;
  /** Các bài sẽ được sao chép. */
  targets: PaperRecord[];
  /** true: người dùng đã tick chọn bài; false: sao chép toàn bộ kết quả đang lọc. */
  fromSelection: boolean;
  onCopy: () => void;
}

function CustomEditor({ custom, onCustomChange }: Pick<Props, 'custom' | 'onCustomChange'>) {
  const areaRef = useRef<TextAreaRef>(null);
  const unknown = unknownPlaceholders(custom.template);

  const setTemplate = (template: string) => onCustomChange({ ...custom, template });

  /** Chèn văn bản tại vị trí con trỏ trong ô soạn mẫu. `caretBack`: lùi con trỏ (vd. để đặt giữa [[ và ]]). */
  const insert = (text: string, caretBack = 0) => {
    const el = areaRef.current?.resizableTextArea?.textArea;
    const start = el?.selectionStart ?? custom.template.length;
    const end = el?.selectionEnd ?? custom.template.length;
    const next = custom.template.slice(0, start) + text + custom.template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + text.length - caretBack;
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="pf-cite-custom">
      <div className="pf-cite-field">
        <span className="pf-cite-label">Bắt đầu từ mẫu có sẵn</span>
        <Select
          placeholder="Chọn một mẫu để sửa tiếp..."
          style={{ minWidth: 320, maxWidth: '100%' }}
          value={null}
          options={CUSTOM_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => {
            const preset = CUSTOM_PRESETS.find((p) => p.id === id);
            if (preset) onCustomChange(preset.config);
          }}
        />
      </div>

      <div className="pf-cite-field">
        <span className="pf-cite-label">Mẫu của bạn</span>
        <Input.TextArea
          ref={areaRef}
          value={custom.template}
          onChange={(e) => setTemplate(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={2000}
          spellCheck={false}
          style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 13 }}
          aria-label="Mẫu trích dẫn tự soạn"
        />
        {unknown.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 6 }} message={`Không nhận ra: ${unknown.map((k) => `{${k}}`).join(', ')}. Hãy chọn trường trong danh sách bên dưới.`} />}
      </div>

      <div className="pf-cite-field">
        <span className="pf-cite-label">Bấm để chèn trường vào mẫu</span>
        <Space size={[4, 6]} wrap>
          {CUSTOM_FIELDS.map((f) => (
            <Tag key={f.key} className="pf-cite-chip" onClick={() => insert(`{${f.key}}`)} title={`Chèn {${f.key}}`}>
              {f.label}
            </Tag>
          ))}
          <Tag className="pf-cite-chip pf-cite-chip-group" onClick={() => insert('[[]]', 2)} title="Chèn nhóm tùy chọn: bỏ cả nhóm nếu thiếu dữ liệu">
            [[ nhóm tùy chọn ]]
          </Tag>
        </Space>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
          Phần đặt trong <code>[[ ]]</code> sẽ tự biến mất nếu bài không có dữ liệu của trường bên trong. Ví dụ <code>{'[[, tập {volume}]]'}</code> chỉ hiện khi bài có tập. Ký tự khác giữ nguyên.
        </Typography.Paragraph>
      </div>

      <div className="pf-cite-options">
        <div>
          <span className="pf-cite-label">Cách ghi tên tác giả</span>
          <Select<AuthorFormat>
            style={{ width: '100%' }}
            value={custom.authorFormat}
            onChange={(authorFormat) => onCustomChange({ ...custom, authorFormat })}
            options={(Object.keys(AUTHOR_FORMAT_LABELS) as AuthorFormat[]).map((v) => ({ value: v, label: AUTHOR_FORMAT_LABELS[v] }))}
          />
        </div>
        <div>
          <span className="pf-cite-label">Nối các tác giả</span>
          <Select<AuthorJoin>
            style={{ width: '100%' }}
            value={custom.authorJoin}
            onChange={(authorJoin) => onCustomChange({ ...custom, authorJoin })}
            options={(Object.keys(AUTHOR_JOIN_LABELS) as AuthorJoin[]).map((v) => ({ value: v, label: AUTHOR_JOIN_LABELS[v] }))}
          />
        </div>
        <div>
          <span className="pf-cite-label">Tối đa tác giả (rồi “et al.”)</span>
          <InputNumber min={1} max={50} style={{ width: '100%' }} value={custom.maxAuthors} onChange={(v) => onCustomChange({ ...custom, maxAuthors: v ?? DEFAULT_CUSTOM.maxAuthors })} />
        </div>
        <div>
          <span className="pf-cite-label">Thứ tự trong danh sách</span>
          <Select<ListOrder>
            style={{ width: '100%' }}
            value={custom.order}
            onChange={(order) => onCustomChange({ ...custom, order })}
            options={(Object.keys(LIST_ORDER_LABELS) as ListOrder[]).map((v) => ({ value: v, label: LIST_ORDER_LABELS[v] }))}
          />
        </div>
      </div>

      <Button size="small" onClick={() => onCustomChange(DEFAULT_CUSTOM)}>
        Dùng lại mẫu mặc định
      </Button>
    </div>
  );
}

/**
 * Khung "Tài liệu tham khảo". Mặc định thu gọn thành MỘT dòng: chọn kiểu + nút sao chép.
 * Bấm "Xem trước & tùy chọn" để xem ví dụ, tick kèm DOI hoặc soạn mẫu tùy chỉnh.
 */
export function CitationPanel({ style, onStyleChange, includeDoi, onIncludeDoiChange, custom, onCustomChange, targets, fromSelection, onCopy }: Props) {
  const [open, setOpen] = usePanelOpen();
  const example = targets[0] ? formatReference(targets[0], { style, includeDoi, custom }) : '';

  return (
    <div className="pf-cite" role="group" aria-label="Sao chép tài liệu tham khảo">
      <div className="pf-cite-bar">
        <span className="pf-cite-title">
          <BookOutlined /> <b>Tài liệu tham khảo</b>
        </span>
        <Select<CitationStyle>
          size="small"
          aria-label="Kiểu ghi tài liệu tham khảo"
          value={style}
          onChange={(next) => {
            onStyleChange(next);
            if (next === 'custom') setOpen(true); // chọn Tùy chỉnh thì mở sẵn ô soạn mẫu
          }}
          style={{ minWidth: 130 }}
          popupMatchSelectWidth={false}
          optionLabelProp="shortLabel"
          options={(Object.keys(CITATION_STYLE_LABELS) as CitationStyle[]).map((value) => ({
            value,
            shortLabel: `Kiểu: ${CITATION_STYLE_LABELS[value]}`,
            label: (
              <div style={{ maxWidth: 300 }}>
                <b>{CITATION_STYLE_LABELS[value]}</b>
                <div style={{ fontSize: 12, color: '#6b7785', whiteSpace: 'normal' }}>{STYLE_HELP[value]}</div>
              </div>
            ),
          }))}
        />
        <Button size="small" type="primary" icon={<BookOutlined />} disabled={targets.length === 0} onClick={onCopy}>
          {fromSelection ? `Sao chép ${targets.length} bài đã chọn` : `Sao chép ${targets.length} bài đang lọc`}
        </Button>
        <Button type="link" size="small" onClick={() => setOpen(!open)} aria-expanded={open} icon={open ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
          {open ? 'Thu gọn' : style === 'custom' ? 'Soạn mẫu' : 'Xem trước & tùy chọn'}
        </Button>
      </div>

      {open && (
        <div className="pf-cite-more">
          <div className="pf-cite-field">
            <span className="pf-cite-label">Ví dụ kiểu này</span>
            <div className="pf-cite-example">{example || 'Chưa có bài nào để xem trước.'}</div>
          </div>
          {style === 'basic' && (
            <Checkbox checked={includeDoi} onChange={(e) => onIncludeDoiChange(e.target.checked)}>
              Kèm DOI ở cuối
            </Checkbox>
          )}
          {style === 'custom' && <CustomEditor custom={custom} onCustomChange={onCustomChange} />}
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {fromSelection ? 'Đang sao chép các bài bạn đã tick. Bỏ chọn hết để sao chép toàn bộ kết quả đang lọc.' : 'Muốn chỉ lấy một số bài: tick chọn các bài trong bảng bên dưới.'}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}
