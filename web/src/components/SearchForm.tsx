import { SearchOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Checkbox, Col, Input, InputNumber, Row, Segmented, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { MAX_RESULT_OPTIONS, type SearchRequest, type SourceId } from '../../../shared/types';
import { DEFAULT_SOURCES, SOURCE_HINTS, SOURCE_LABELS, parseKeywords } from '../lib/records';

const EXAMPLES = [
  'Artificial intelligence in education',
  'Machine learning in healthcare',
  'Deep learning for crop disease detection',
  'Large language models in software engineering',
];
const MAX_KEYWORDS = 10;
const THIS_YEAR = new Date().getFullYear();

interface Props {
  searching: boolean;
  disabled: boolean;
  /** Các nguồn máy chủ đang bật. */
  available: SourceId[];
  onSearch: (request: SearchRequest) => void;
  onCancel: () => void;
}

export function SearchForm({ searching, disabled, available, onSearch, onCancel }: Props) {
  const [multi, setMulti] = useState(false);
  const [text, setText] = useState('');
  // null = chưa chọn thủ công -> dùng TẤT CẢ nguồn đang bật (kể cả nguồn bật muộn sau khi kiểm tra kết nối xong).
  const [chosenSources, setChosenSources] = useState<SourceId[] | null>(null);
  // Chỉ dùng các nguồn máy chủ đang bật (vd. Semantic Scholar cần API key).
  const sources = (chosenSources ?? available).filter((s) => available.includes(s));
  const [maxResults, setMaxResults] = useState<SearchRequest['maxResults']>(50);
  const [yearFrom, setYearFrom] = useState<number | null>(null);
  const [yearTo, setYearTo] = useState<number | null>(null);
  const [onlyWithDoi, setOnlyWithDoi] = useState(true);
  const [touched, setTouched] = useState(false);

  const keywords = parseKeywords(text, multi);
  const keywordError =
    keywords.length === 0
      ? 'Nhập ít nhất một từ khóa.'
      : keywords.some((k) => k.length < 2)
        ? 'Mỗi từ khóa cần ít nhất 2 ký tự.'
        : keywords.length > MAX_KEYWORDS
          ? `Tối đa ${MAX_KEYWORDS} từ khóa mỗi lần tìm (đang có ${keywords.length}).`
          : keywords.some((k) => k.length > 200)
            ? 'Mỗi từ khóa tối đa 200 ký tự.'
            : null;
  const yearError = yearFrom !== null && yearTo !== null && yearFrom > yearTo ? 'Năm bắt đầu phải nhỏ hơn hoặc bằng năm kết thúc.' : null;
  const sourceError = sources.length === 0 ? 'Chọn ít nhất một nguồn dữ liệu.' : null;
  const error = keywordError ?? sourceError ?? yearError;
  const doiWarning =
    onlyWithDoi && sources.includes('arxiv')
      ? 'Lưu ý: nhiều bài trên arXiv là preprint chưa có DOI nên có thể ít kết quả từ arXiv. Bỏ chọn “Chỉ lấy bài có DOI” nếu muốn lấy thêm.'
      : null;

  const submit = () => {
    setTouched(true);
    if (error || disabled || searching) return;
    onSearch({
      keywords,
      sources,
      maxResults,
      ...(yearFrom !== null ? { yearFrom } : {}),
      ...(yearTo !== null ? { yearTo } : {}),
      onlyWithDoi,
    });
  };

  const changeMode = (value: string) => {
    const nextMulti = value === 'multi';
    // Đổi chế độ không làm mất từ khóa đã nhập.
    if (nextMulti && !multi) setText((t) => t.trim());
    if (!nextMulti && multi) setText((t) => t.split(/\r?\n/).filter(Boolean).join(' '));
    setMulti(nextMulti);
  };

  return (
    <section className="pf-panel" aria-label="Tìm kiếm">
      <h2 className="pf-panel-title">
        Tìm kiếm tài liệu <small>Tối đa {MAX_KEYWORDS} từ khóa mỗi lần tìm</small>
      </h2>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text strong>Từ khóa nghiên cứu</Typography.Text>
          <Segmented
            value={multi ? 'multi' : 'single'}
            onChange={(v) => changeMode(String(v))}
            options={[
              { label: 'Một từ khóa', value: 'single' },
              { label: 'Nhiều từ khóa', value: 'multi' },
            ]}
            disabled={searching}
          />
        </Space>

        {multi ? (
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder={'Mỗi từ khóa trên một dòng, ví dụ:\nMachine learning in healthcare\nDeep learning for crop disease detection'}
            disabled={searching}
            status={touched && keywordError ? 'error' : undefined}
            aria-label="Danh sách từ khóa, mỗi dòng một từ khóa"
          />
        ) : (
          <Input
            size="large"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[\r\n]+/g, ' '))}
            onPressEnter={submit}
            placeholder="Ví dụ: Artificial intelligence in education"
            prefix={<SearchOutlined />}
            allowClear
            disabled={searching}
            status={touched && keywordError ? 'error' : undefined}
            aria-label="Từ khóa nghiên cứu"
          />
        )}
        {touched && error && <Typography.Text type="danger">{error}</Typography.Text>}

        <Space size={[4, 4]} wrap>
          <Typography.Text type="secondary">Gợi ý:</Typography.Text>
          {EXAMPLES.map((example) => (
            <Tag
              key={example}
              className="pf-example"
              onClick={() => {
                if (searching) return;
                setText((current) => (multi ? [current.trim(), example].filter(Boolean).join('\n') : example));
              }}
            >
              {example}
            </Tag>
          ))}
        </Space>

        <Row gutter={[16, 12]}>
          <Col xs={24} lg={8}>
            <label className="pf-label" htmlFor="pf-source">
              Nguồn dữ liệu ({sources.length}/{available.length})
            </label>
            <Select<SourceId[]>
              id="pf-source"
              mode="multiple"
              value={sources}
              onChange={setChosenSources}
              disabled={searching}
              style={{ width: '100%' }}
              maxTagCount="responsive"
              status={touched && sourceError ? 'error' : undefined}
              optionLabelProp="shortLabel"
              placeholder="Chọn nguồn"
              options={available.map((id) => ({
                value: id,
                shortLabel: SOURCE_LABELS[id],
                label: (
                  <span>
                    {SOURCE_LABELS[id]} <Typography.Text type="secondary">— {SOURCE_HINTS[id]}</Typography.Text>
                  </span>
                ),
              }))}
              popupRender={(menu) => (
                <>
                  {menu}
                  <div style={{ padding: 8, borderTop: '1px solid #f0f0f0' }}>
                    <Button size="small" type="link" onClick={() => setChosenSources(null)}>
                      Chọn tất cả
                    </Button>
                    <Button size="small" type="link" onClick={() => setChosenSources(DEFAULT_SOURCES)}>
                      Chỉ Crossref + OpenAlex
                    </Button>
                  </div>
                </>
              )}
            />
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <label className="pf-label" htmlFor="pf-max">Số kết quả tối đa (mỗi từ khóa, mỗi nguồn)</label>
            <Select
              id="pf-max"
              value={maxResults}
              onChange={setMaxResults}
              disabled={searching}
              style={{ width: '100%' }}
              options={MAX_RESULT_OPTIONS.map((n) => ({ value: n, label: `${n} kết quả` }))}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <label className="pf-label" htmlFor="pf-year-from">Năm xuất bản</label>
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber id="pf-year-from" placeholder="Từ năm" min={1000} max={THIS_YEAR + 1} value={yearFrom} onChange={setYearFrom} disabled={searching} style={{ width: '50%' }} controls={false} />
              <InputNumber placeholder="Đến năm" min={1000} max={THIS_YEAR + 1} value={yearTo} onChange={setYearTo} disabled={searching} style={{ width: '50%' }} controls={false} aria-label="Đến năm" status={yearError ? 'error' : undefined} />
            </Space.Compact>
          </Col>
          <Col xs={24} sm={12} lg={5}>
            <label className="pf-label">Bài không có DOI</label>
            <Checkbox checked={onlyWithDoi} onChange={(e) => setOnlyWithDoi(e.target.checked)} disabled={searching}>
              Chỉ lấy bài có DOI
            </Checkbox>
          </Col>
        </Row>

        {doiWarning && <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{doiWarning}</Typography.Text>}

        <Space>
          {searching ? (
            <Button danger icon={<StopOutlined />} onClick={onCancel} size="large">
              Hủy tìm kiếm
            </Button>
          ) : (
            <Button type="primary" icon={<SearchOutlined />} onClick={submit} size="large" disabled={disabled}>
              Tìm bài báo
            </Button>
          )}
          {disabled && !searching && <Typography.Text type="secondary">Cần có kết nối mạng để tìm kiếm.</Typography.Text>}
        </Space>
      </Space>
    </section>
  );
}
