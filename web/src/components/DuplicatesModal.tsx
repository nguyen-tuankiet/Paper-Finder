import { Button, Empty, List, Modal, Space, Tag, Typography } from 'antd';
import type { PaperRecord, SuspectedDuplicate } from '../../../shared/types';
import { NO_DATA, SOURCE_LABELS, authorsShort, doiUrl } from '../lib/records';

export type DuplicateAction = 'keep-both' | 'remove-a' | 'remove-b';

interface Props {
  open: boolean;
  pairs: SuspectedDuplicate[];
  byId: Map<string, PaperRecord>;
  onClose: () => void;
  onResolve: (pair: SuspectedDuplicate, action: DuplicateAction) => void;
}

function Side({ label, record }: { label: string; record: PaperRecord }) {
  const { shown, extra } = authorsShort(record.authors, 4);
  return (
    <div className="pf-dup-side">
      <Tag color="blue">{label}</Tag>
      <Typography.Paragraph strong style={{ margin: '4px 0' }}>
        {record.originalUrl ? (
          <a href={record.originalUrl} target="_blank" rel="noopener noreferrer">
            {record.title}
          </a>
        ) : (
          record.title
        )}
      </Typography.Paragraph>
      <div>
        <Typography.Text type="secondary">DOI: </Typography.Text>
        {record.doi ? (
          <a href={doiUrl(record.doi)} target="_blank" rel="noopener noreferrer">
            {record.doi}
          </a>
        ) : (
          NO_DATA
        )}
      </div>
      <div>
        <Typography.Text type="secondary">Năm: </Typography.Text>
        {record.publicationYear ?? NO_DATA}
      </div>
      <div>
        <Typography.Text type="secondary">Tác giả: </Typography.Text>
        {record.authors.length ? `${shown}${extra ? ` +${extra}` : ''}` : NO_DATA}
      </div>
      <div>
        <Typography.Text type="secondary">Tạp chí: </Typography.Text>
        {record.journal || NO_DATA}
      </div>
      <div>
        <Typography.Text type="secondary">Nguồn: </Typography.Text>
        {record.sources.map((s) => SOURCE_LABELS[s]).join(', ')}
      </div>
    </div>
  );
}

export function DuplicatesModal({ open, pairs, byId, onClose, onResolve }: Props) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Đóng</Button>}
      width={900}
      centered
      title={`Bài nghi trùng (${pairs.length})`}
      // Chiều cao cố định theo màn hình; nội dung dài thì cuộn bên trong, tiêu đề và nút Đóng luôn thấy.
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 } }}
    >
      <Typography.Paragraph type="secondary">
        Các cặp dưới đây có cùng tiêu đề nhưng chưa đủ bằng chứng để tự động gộp (khác DOI, khác năm/tác giả hoặc thiếu dữ liệu). Hãy xem và quyết định.
        “Loại bỏ” chỉ ẩn bài khỏi danh sách và file xuất của lần tìm này.
      </Typography.Paragraph>
      {pairs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không còn cặp nghi trùng nào." />
      ) : (
        <List
          dataSource={pairs}
          renderItem={(pair) => {
            const a = byId.get(pair.recordIds[0]);
            const b = byId.get(pair.recordIds[1]);
            if (!a || !b) return null;
            return (
              <List.Item key={pair.recordIds.join('|')} style={{ display: 'block' }}>
                <Typography.Text type="warning">{pair.reason}</Typography.Text>
                <div className="pf-dup-pair">
                  <Side label="Bản A" record={a} />
                  <Side label="Bản B" record={b} />
                </div>
                <Space wrap style={{ marginTop: 8 }}>
                  <Button size="small" onClick={() => onResolve(pair, 'keep-both')}>
                    Giữ cả hai
                  </Button>
                  <Button size="small" danger onClick={() => onResolve(pair, 'remove-a')}>
                    Loại bỏ bản A
                  </Button>
                  <Button size="small" danger onClick={() => onResolve(pair, 'remove-b')}>
                    Loại bỏ bản B
                  </Button>
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </Modal>
  );
}
