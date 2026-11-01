import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Input, Popconfirm, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HistoryEntry, SearchRequest } from '../../shared/types';
import { AccountPageShell, FeatureGate } from './components/AccountPageShell';
import { Panel } from './components/Panel';
import { useAccount } from './lib/accountContext';
import { clearHistory, fetchHistory } from './lib/api';
import { RERUN_KEY } from './lib/rerun';
import { SOURCE_LABELS } from './lib/records';

function conditions(request: SearchRequest): string {
  const parts: string[] = [];
  if (request.yearFrom || request.yearTo) parts.push(`năm ${request.yearFrom ?? '…'}–${request.yearTo ?? '…'}`);
  parts.push(request.onlyWithDoi ? 'chỉ bài có DOI' : 'cả bài chưa có DOI');
  parts.push(`tối đa ${request.maxResults}/nguồn`);
  return parts.join(' · ');
}

/** Chạy lại một lần tìm: lưu điều kiện vào phiên trình duyệt rồi về trang tìm kiếm, nơi nó được chạy ngay. */
function rerun(request: SearchRequest): void {
  try {
    sessionStorage.setItem(RERUN_KEY, JSON.stringify(request));
  } catch {
    /* trình duyệt chặn lưu trữ: chỉ về trang tìm kiếm */
  }
  window.location.assign('/');
}

function History() {
  const account = useAccount();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');

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
    void load();
  }, [load]);

  const clear = async () => {
    try {
      await clearHistory();
      setItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được lịch sử.');
    }
  };

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return q ? items.filter((e) => e.request.keywords.join(' ').toLowerCase().includes(q)) : items;
  }, [items, text]);

  const columns: TableColumnsType<HistoryEntry> = [
    {
      title: 'Lần tìm',
      key: 'search',
      render: (_v, entry) => (
        <div>
          <Typography.Text strong>{entry.request.keywords.join(' · ')}</Typography.Text>
          <div>
            <Typography.Text type="secondary">{conditions(entry.request)}</Typography.Text>
          </div>
          <div style={{ marginTop: 4 }}>
            {entry.request.sources.map((s) => (
              <Tag key={s}>{SOURCE_LABELS[s]}</Tag>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: 'Kết quả',
      key: 'result',
      width: 170,
      render: (_v, entry) => (
        <div>
          <Typography.Text strong>{entry.total} bài</Typography.Text>
          <div>
            <Typography.Text type="secondary">{new Date(entry.at).toLocaleString('vi-VN')}</Typography.Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      render: (_v, entry) => (
        <Button type="primary" ghost icon={<ReloadOutlined />} onClick={() => rerun(entry.request)}>
          Tìm lại
        </Button>
      ),
    },
  ];

  return (
    <Panel title="Lịch sử tìm kiếm" extra={`${shown.length}/${items.length} lần tìm, tối đa ${account.entitlements.historyMax} gần nhất`}>
      <div className="pf-toolbar">
        <Input.Search allowClear placeholder="Tìm theo từ khóa..." value={text} onChange={(e) => setText(e.target.value)} className="pf-toolbar-search" />
        <Popconfirm title="Xóa toàn bộ lịch sử?" okText="Xóa" cancelText="Hủy" onConfirm={() => void clear()} disabled={items.length === 0}>
          <Button danger icon={<DeleteOutlined />} disabled={items.length === 0}>
            Xóa lịch sử
          </Button>
        </Popconfirm>
      </div>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} action={<Button size="small" onClick={() => void load()}>Thử lại</Button>} />}
      <Table<HistoryEntry>
        size="middle"
        rowKey="id"
        loading={loading}
        dataSource={shown}
        columns={columns}
        pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{ emptyText: <Empty description={items.length === 0 ? 'Chưa có lần tìm nào được lưu.' : 'Không có lần tìm nào khớp.'} /> }}
      />
      <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
        Chỉ lưu điều kiện tìm (từ khóa, nguồn, khoảng năm), không lưu kết quả. “Tìm lại” sẽ chạy lại đúng điều kiện đó và tính một lượt tìm.
      </Typography.Paragraph>
    </Panel>
  );
}

export default function HistoryPage() {
  return (
    <AccountPageShell subtitle="Lịch sử tìm kiếm">
      <FeatureGate feature="history" title="Lịch sử tìm kiếm" pitch="Lưu lại các lần tìm gần nhất (20 với Tiêu chuẩn, 50 với Pro) để chạy lại nhanh.">
        <History />
      </FeatureGate>
    </AccountPageShell>
  );
}
