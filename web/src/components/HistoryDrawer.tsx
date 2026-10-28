import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import type { HistoryEntry, SearchRequest } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { clearHistory, fetchHistory } from '../lib/api';
import { SOURCE_LABELS } from '../lib/records';

function describe(request: SearchRequest): string {
  const parts: string[] = [];
  if (request.yearFrom || request.yearTo) parts.push(`năm ${request.yearFrom ?? '…'}–${request.yearTo ?? '…'}`);
  parts.push(request.onlyWithDoi ? 'chỉ bài có DOI' : 'cả bài chưa có DOI');
  parts.push(`tối đa ${request.maxResults}/nguồn`);
  return parts.join(' · ');
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Chạy lại một lần tìm trước đó. */
  onRerun: (request: SearchRequest) => void;
}

/** Lịch sử tìm kiếm (Pro): lưu điều kiện tìm (không lưu kết quả), chạy lại bằng một lần bấm. */
export function HistoryDrawer({ open, onClose, onRerun }: Props) {
  const account = useAccount();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được lịch sử.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && account.isPro) void load();
  }, [open, account.isPro, load]);

  const clear = async () => {
    try {
      await clearHistory();
      setItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được lịch sử.');
    }
  };

  return (
    <Drawer open={open} onClose={onClose} size={560} title="Lịch sử tìm kiếm" destroyOnHidden>
      {!account.user ? (
        <Alert type="info" showIcon title="Đăng nhập để xem lịch sử" action={<Button size="small" onClick={() => account.openAuth('login')}>Đăng nhập</Button>} />
      ) : !account.isPro ? (
        <Alert
          type="info"
          showIcon
          title="Lịch sử tìm kiếm là tính năng của gói Pro"
          description="Pro lưu lại 50 lần tìm gần nhất để bạn chạy lại nhanh. Chỉ lưu điều kiện tìm, không lưu kết quả."
          action={<Button size="small" type="primary" onClick={() => account.openUpgrade('Lịch sử tìm kiếm dành cho gói Pro.')}>Nâng cấp</Button>}
        />
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Space style={{ justifyContent: 'space-between', width: '100%' }}>
            <Typography.Text type="secondary">{items.length} lần tìm gần nhất</Typography.Text>
            <Popconfirm title="Xóa toàn bộ lịch sử?" okText="Xóa" cancelText="Hủy" onConfirm={() => void clear()} disabled={items.length === 0}>
              <Button size="small" danger icon={<DeleteOutlined />} disabled={items.length === 0}>Xóa lịch sử</Button>
            </Popconfirm>
          </Space>
          {error && <Alert type="error" showIcon title={error} />}
          <Spin spinning={loading}>
            {items.length === 0 && !loading ? (
              <Empty description="Chưa có lần tìm nào được lưu." />
            ) : (
              <div className="pf-rows">
                {items.map((entry) => (
                  <div key={entry.id} className="pf-row">
                    <Typography.Text strong>{entry.request.keywords.join(' · ')}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary">
                        {new Date(entry.at).toLocaleString('vi-VN')} · {entry.total} bài
                      </Typography.Text>
                    </div>
                    <div>
                      <Typography.Text type="secondary">{describe(entry.request)}</Typography.Text>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      {entry.request.sources.map((s) => (
                        <Tag key={s}>{SOURCE_LABELS[s]}</Tag>
                      ))}
                    </div>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<ReloadOutlined />}
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        onRerun(entry.request);
                        onClose();
                      }}
                    >
                      Tìm lại
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Spin>
        </Space>
      )}
    </Drawer>
  );
}
