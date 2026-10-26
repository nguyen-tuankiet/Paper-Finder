import { BookOutlined, CopyOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Space, Tag, Typography, message } from 'antd';
import type { PaperRecord } from '../../../shared/types';
import { copyText } from '../lib/clipboard';
import { CITATION_STYLE_LABELS, formatApaInText, formatReference, type CitationStyle } from '../lib/citation';
import { PdfButton } from './PdfButton';
import { NO_DATA, SOURCE_LABELS, docTypeLabel, doiUrl, formatLicense, publisherUrl } from '../lib/records';

const muted = (text: string) => <Typography.Text type="secondary">{text}</Typography.Text>;

export function DetailDrawer({ record, citationStyle, onClose }: { record: PaperRecord | null; citationStyle: CitationStyle; onClose: () => void }) {
  const [messageApi, contextHolder] = message.useMessage();

  const copy = async (text: string, label: string) => {
    if (await copyText(text)) void messageApi.success(`Đã sao chép ${label}`);
    else void messageApi.error('Không sao chép được.');
  };

  return (
    <Drawer open={record !== null} onClose={onClose} width={680} title="Chi tiết metadata" destroyOnClose>
      {contextHolder}
      {record && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {record.title || '(Chưa có tiêu đề)'}
          </Typography.Title>
          <Space wrap>
            {record.originalUrl && (
              <Button type="primary" href={record.originalUrl} target="_blank" rel="noopener noreferrer">
                Mở trang bài báo
              </Button>
            )}
            {record.doi && (
              <Button icon={<CopyOutlined />} onClick={() => void copy(record.doi, 'DOI')}>
                Sao chép DOI
              </Button>
            )}
          </Space>
          <Descriptions column={1} bordered size="small" labelStyle={{ width: 150 }}>
            <Descriptions.Item label="DOI">
              {record.doi ? (
                <a href={doiUrl(record.doi)} target="_blank" rel="noopener noreferrer">
                  {record.doi}
                </a>
              ) : (
                muted('Nguồn không cung cấp DOI')
              )}
            </Descriptions.Item>
            <Descriptions.Item label={`Tác giả (${record.authors.length})`}>
              {record.authors.length === 0
                ? muted(NO_DATA)
                : record.authors.map((a, i) => (
                    <span key={`${a.name}-${i}`}>
                      {i > 0 && '; '}
                      {a.orcid ? (
                        <a href={a.orcid} target="_blank" rel="noopener noreferrer" title="ORCID">
                          {a.name}
                        </a>
                      ) : (
                        a.name
                      )}
                    </span>
                  ))}
            </Descriptions.Item>
            <Descriptions.Item label="Năm xuất bản">{record.publicationYear ?? muted(NO_DATA)}</Descriptions.Item>
            <Descriptions.Item label="Tạp chí / hội nghị">{record.journal || muted(NO_DATA)}</Descriptions.Item>
            <Descriptions.Item label="Nhà xuất bản">{record.publisher || muted(NO_DATA)}</Descriptions.Item>
            <Descriptions.Item label="Loại tài liệu">
              {record.documentType ? `${docTypeLabel(record.documentType)} (${record.documentType})` : muted(NO_DATA)}
              {record.isPreprint && (
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  Preprint — chưa chắc đã qua bình duyệt
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Truy cập">
              {record.isOpenAccess ? (
                <Space direction="vertical" size={4}>
                  <span>
                    <Tag color="green">Miễn phí (truy cập mở)</Tag>
                    {record.oaLicense && <span>Giấy phép: {formatLicense(record.oaLicense)}</span>}
                    {record.oaStatus && <Typography.Text type="secondary"> · loại: {record.oaStatus}</Typography.Text>}
                  </span>
                  <Space wrap>
                    {record.oaPdfUrl && <PdfButton record={record} ghost={false} />}
                    {record.oaUrl && (
                      <Button size="small" href={record.oaUrl} target="_blank" rel="noopener noreferrer">
                        Đọc toàn văn
                      </Button>
                    )}
                  </Space>
                </Space>
              ) : (
                <Space direction="vertical" size={4}>
                  <span>
                    <Tag>Chưa thấy bản miễn phí</Tag>
                    {record.oaStatus === 'closed' && <Typography.Text type="secondary">Nguồn ghi nhận là đóng (closed).</Typography.Text>}
                  </span>
                  {publisherUrl(record) && (
                    <Button size="small" href={publisherUrl(record)} target="_blank" rel="noopener noreferrer">
                      Trang nhà xuất bản
                    </Button>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Bài có thể mất phí, hoặc đọc được qua thư viện/trường học của bạn. Dữ liệu truy cập mở của các nguồn có thể chưa đầy đủ.
                  </Typography.Text>
                </Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Nguồn dữ liệu">
              <Space direction="vertical" size={2}>
                {record.sourceRefs.length === 0
                  ? record.sources.map((s) => SOURCE_LABELS[s]).join(', ')
                  : record.sourceRefs.map((ref) => (
                      <span key={`${ref.source}-${ref.sourceId}`}>
                        {SOURCE_LABELS[ref.source]}:{' '}
                        <a href={ref.url} target="_blank" rel="noopener noreferrer">
                          {ref.sourceId}
                        </a>
                      </span>
                    ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Từ khóa tìm thấy">{record.queryKeywords.length ? record.queryKeywords.join('; ') : muted(NO_DATA)}</Descriptions.Item>
            <Descriptions.Item label="URL gốc">
              {record.originalUrl ? (
                <a href={record.originalUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>
                  {record.originalUrl}
                </a>
              ) : (
                muted(NO_DATA)
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Thời điểm lấy dữ liệu">{new Date(record.retrievedAt).toLocaleString('vi-VN')}</Descriptions.Item>
          </Descriptions>
          <div>
            <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
              <Typography.Text strong>Tài liệu tham khảo ({CITATION_STYLE_LABELS[citationStyle]})</Typography.Text>
              <Button size="small" icon={<BookOutlined />} onClick={() => void copy(formatReference(record, { style: citationStyle }), 'tài liệu tham khảo')}>
                Sao chép
              </Button>
            </Space>
            <Typography.Paragraph style={{ marginTop: 8, background: '#f4f6f9', padding: 10, borderRadius: 6, userSelect: 'all' }}>
              {formatReference(record, { style: citationStyle })}
            </Typography.Paragraph>
            {citationStyle === 'apa' && (
              <Space style={{ marginBottom: 6 }} wrap>
                <Typography.Text type="secondary">Trích dẫn trong văn bản:</Typography.Text>
                <Typography.Text code>{formatApaInText(record)}</Typography.Text>
                <Button size="small" onClick={() => void copy(formatApaInText(record), 'trích dẫn trong văn bản')}>
                  Sao chép
                </Button>
              </Space>
            )}
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Đổi kiểu (IEEE, APA 7, Mẫu cơ bản) ở khung “Sao chép tài liệu tham khảo” phía trên bảng kết quả. Phần nào nguồn không có (tập, số, trang, biên tập viên, lần xuất bản...) sẽ bị bỏ qua; tên tạp chí/sách không in nghiêng được ở dạng văn bản thuần; hãy đối chiếu với bài gốc trước khi dùng.
              </Typography.Text>
            </div>
          </div>
          <div>
            <Typography.Text strong>Abstract</Typography.Text>
            <Typography.Paragraph style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
              {record.abstract || muted('Chưa có dữ liệu — nguồn không cung cấp abstract cho bài này.')}
            </Typography.Paragraph>
          </div>
        </Space>
      )}
    </Drawer>
  );
}
