import { CopyOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Space, Tag, Typography, message } from 'antd';
import type { PaperRecord } from '../../../shared/types';
import { copyText } from '../lib/clipboard';
import { NO_DATA, SOURCE_LABELS, docTypeLabel, doiUrl } from '../lib/records';

const muted = (text: string) => <Typography.Text type="secondary">{text}</Typography.Text>;

export function DetailDrawer({ record, onClose }: { record: PaperRecord | null; onClose: () => void }) {
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
