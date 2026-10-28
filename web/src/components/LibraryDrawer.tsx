import { BookOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, Input, Popconfirm, Select, Space, Spin, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExportFormat, LibraryItem } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { ApiError, exportRecords, fetchLibrary, removeFromLibrary } from '../lib/api';
import { formatReferenceList } from '../lib/citation';
import { useCitationStyle, useCustomCitation } from '../lib/citationStyle';
import { copyText } from '../lib/clipboard';
import { authorsShort, doiUrl, exportFileName } from '../lib/records';

const PAGE = 20;

function authorLine(item: LibraryItem): string {
  const { shown, extra } = authorsShort(item.record.authors);
  return extra > 0 ? `${shown} và ${extra} tác giả khác` : shown;
}

/** Thư viện cá nhân (Pro): bài đã lưu, lọc theo thư mục, sao chép trích dẫn, xóa, xuất BibTeX/RIS/Excel. */
export function LibraryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useAccount();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [citationStyle] = useCitationStyle();
  const [customCitation] = useCustomCitation();
  const [messageApi, holder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchLibrary());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được thư viện.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && account.isPro) void load();
  }, [open, account.isPro, load]);

  const folders = useMemo(() => [...new Set(items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [items]);
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return items.filter((i) => (!folder || i.folder === folder) && (!q || `${i.record.title} ${i.record.authors.map((a) => a.name).join(' ')} ${i.record.journal} ${i.record.doi}`.toLowerCase().includes(q)));
  }, [items, folder, text]);

  const remove = async (key: string) => {
    try {
      await removeFromLibrary(key);
      setItems((prev) => prev.filter((i) => i.key !== key));
    } catch (err) {
      void messageApi.error(err instanceof Error ? err.message : 'Không xóa được.');
    }
  };

  const copyOne = async (item: LibraryItem) => {
    const ref = formatReferenceList([item.record], { style: citationStyle, includeDoi: true, custom: customCitation });
    void (await copyText(ref).then((ok) => (ok ? messageApi.success('Đã sao chép tài liệu tham khảo.') : messageApi.error('Không sao chép được.'))));
  };

  const download = async (format: ExportFormat) => {
    try {
      await exportRecords(format, shown.map((i) => i.record), exportFileName(format));
      void messageApi.success(`Đã xuất ${shown.length} bài.`);
    } catch (err) {
      void messageApi.error(err instanceof ApiError || err instanceof Error ? err.message : 'Xuất file thất bại.');
    }
  };

  return (
    <Drawer open={open} onClose={onClose} size={640} title="Thư viện của tôi" destroyOnHidden>
      {holder}
      {!account.user ? (
        <Alert type="info" showIcon title="Đăng nhập để dùng thư viện" action={<Button size="small" onClick={() => account.openAuth('login')}>Đăng nhập</Button>} />
      ) : !account.isPro ? (
        <Alert
          type="info"
          showIcon
          title="Thư viện cá nhân là tính năng của gói Pro"
          description="Lưu bài vào thư mục riêng và dùng trên mọi thiết bị. Dữ liệu đã lưu được giữ nguyên, sẽ xem lại được khi bạn gia hạn Pro."
          action={<Button size="small" type="primary" onClick={() => account.openUpgrade('Thư viện cá nhân dành cho gói Pro.')}>Nâng cấp</Button>}
        />
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <div className="pf-toolbar">
            <Input.Search allowClear placeholder="Tìm trong thư viện..." value={text} onChange={(e) => setText(e.target.value)} className="pf-toolbar-search" />
            <Select
              value={folder}
              onChange={setFolder}
              style={{ minWidth: 160 }}
              aria-label="Lọc theo thư mục"
              options={[{ value: '', label: 'Mọi thư mục' }, ...folders.map((f) => ({ value: f, label: f }))]}
            />
          </div>
          <Space wrap>
            <Button icon={<DownloadOutlined />} disabled={shown.length === 0} onClick={() => void download('bibtex')}>BibTeX</Button>
            <Button icon={<DownloadOutlined />} disabled={shown.length === 0} onClick={() => void download('ris')}>RIS</Button>
            <Button icon={<DownloadOutlined />} disabled={shown.length === 0} onClick={() => void download('xlsx')}>Excel</Button>
            <Typography.Text type="secondary">{shown.length}/{items.length} bài</Typography.Text>
          </Space>
          {error && <Alert type="error" showIcon title={error} />}
          <Spin spinning={loading}>
            {shown.length === 0 && !loading ? (
              <Empty description={items.length === 0 ? 'Chưa có bài nào. Bấm “Lưu” ở cột Thao tác trong kết quả tìm kiếm.' : 'Không có bài khớp bộ lọc.'} />
            ) : (
              <div className="pf-rows">
                {shown.slice(0, visible).map((item) => (
                  <div key={item.key} className="pf-row">
                    <Typography.Text strong>
                      {item.record.originalUrl || item.record.doi ? (
                        <a href={item.record.originalUrl || doiUrl(item.record.doi)} target="_blank" rel="noopener noreferrer">
                          {item.record.title || '(Chưa có tiêu đề)'}
                        </a>
                      ) : (
                        item.record.title || '(Chưa có tiêu đề)'
                      )}
                    </Typography.Text>
                    <div>
                      <Typography.Text type="secondary">{[authorLine(item), item.record.publicationYear, item.record.journal].filter(Boolean).join(' · ')}</Typography.Text>
                    </div>
                    {item.folder && <Tag style={{ marginTop: 4 }}>{item.folder}</Tag>}
                    <Space size={8} style={{ marginTop: 8 }}>
                      <Button size="small" icon={<BookOutlined />} onClick={() => void copyOne(item)}>
                        Trích dẫn
                      </Button>
                      <Popconfirm title="Xóa bài này khỏi thư viện?" okText="Xóa" cancelText="Hủy" onConfirm={() => void remove(item.key)}>
                        <Button size="small" danger icon={<DeleteOutlined />}>
                          Xóa
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                ))}
                {shown.length > visible && (
                  <Button block onClick={() => setVisible((n) => n + PAGE)}>
                    Hiển thị thêm ({shown.length - visible})
                  </Button>
                )}
              </div>
            )}
          </Spin>
        </Space>
      )}
    </Drawer>
  );
}
