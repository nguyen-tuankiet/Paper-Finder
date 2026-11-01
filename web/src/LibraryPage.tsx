import { BookOutlined, DeleteOutlined, DownloadOutlined, FolderOpenOutlined, FolderOutlined } from '@ant-design/icons';
import { Alert, Button, Dropdown, Empty, Input, Popconfirm, Space, Table, Tag, Typography, message, type MenuProps, type TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExportFormat, LibraryItem } from '../../shared/types';
import { AccountPageShell, FeatureGate } from './components/AccountPageShell';
import { Panel } from './components/Panel';
import { useAccount } from './lib/accountContext';
import { ApiError, exportRecords, fetchLibrary, removeFromLibrary } from './lib/api';
import { formatReferenceList } from './lib/citation';
import { useCitationStyle, useCustomCitation } from './lib/citationStyle';
import { copyText } from './lib/clipboard';
import { authorsShort, doiUrl, exportFileName } from './lib/records';

/** Mục "Chưa phân loại" trong danh sách thư mục (bài được lưu không chọn thư mục). */
const NO_FOLDER = '\u0000none';

function authorLine(item: LibraryItem): string {
  const { shown, extra } = authorsShort(item.record.authors);
  return extra > 0 ? `${shown} và ${extra} tác giả khác` : shown;
}

function Library() {
  const account = useAccount();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null); // null = mọi thư mục
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
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
    void load();
  }, [load]);

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.folder || NO_FOLDER, (counts.get(item.folder || NO_FOLDER) ?? 0) + 1);
    const named = [...counts.keys()].filter((f) => f !== NO_FOLDER).sort((a, b) => a.localeCompare(b, 'vi'));
    return { named, counts };
  }, [items]);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return items.filter((i) => {
      if (folder !== null && (i.folder || NO_FOLDER) !== folder) return false;
      return !q || `${i.record.title} ${i.record.authors.map((a) => a.name).join(' ')} ${i.record.journal} ${i.record.doi}`.toLowerCase().includes(q);
    });
  }, [items, folder, text]);

  // Bài đã chọn nhưng không còn nằm trong danh sách đang lọc thì bỏ chọn.
  const selectedItems = useMemo(() => shown.filter((i) => selected.includes(i.key)), [shown, selected]);
  const target = selectedItems.length > 0 ? selectedItems : shown;

  const remove = async (keys: string[]) => {
    try {
      for (const key of keys) await removeFromLibrary(key);
      setItems((prev) => prev.filter((i) => !keys.includes(i.key)));
      setSelected((prev) => prev.filter((k) => !keys.includes(k)));
      void messageApi.success(keys.length > 1 ? `Đã xóa ${keys.length} bài.` : 'Đã xóa bài khỏi thư viện.');
    } catch (err) {
      void messageApi.error(err instanceof Error ? err.message : 'Không xóa được.');
      void load();
    }
  };

  const cite = async (list: LibraryItem[]) => {
    const ref = formatReferenceList(list.map((i) => i.record), { style: citationStyle, includeDoi: true, custom: customCitation });
    const ok = await copyText(ref);
    if (ok) void messageApi.success(list.length > 1 ? `Đã sao chép ${list.length} tài liệu tham khảo.` : 'Đã sao chép tài liệu tham khảo.');
    else void messageApi.error('Không sao chép được.');
  };

  const download = async (format: ExportFormat) => {
    if ((format === 'bibtex' || format === 'ris') && !account.entitlements.referenceExport) {
      account.openUpgrade('Xuất BibTeX/RIS (Zotero, Mendeley, EndNote) chỉ có ở hạng Pro.', 'pro');
      return;
    }
    try {
      await exportRecords(format, target.map((i) => i.record), exportFileName(format));
      void messageApi.success(`Đã xuất ${target.length} bài.`);
    } catch (err) {
      void messageApi.error(err instanceof ApiError || err instanceof Error ? err.message : 'Xuất file thất bại.');
    }
  };

  const exportMenu: MenuProps = {
    items: [
      { key: 'xlsx', label: 'Excel (.xlsx)' },
      { key: 'csv', label: 'CSV' },
      { key: 'bibtex', label: account.entitlements.referenceExport ? 'BibTeX' : 'BibTeX (hạng Pro)' },
      { key: 'ris', label: account.entitlements.referenceExport ? 'RIS' : 'RIS (hạng Pro)' },
    ],
    onClick: ({ key }) => void download(key as ExportFormat),
  };

  const columns: TableColumnsType<LibraryItem> = [
    {
      title: 'Bài báo',
      key: 'paper',
      render: (_v, item) => (
        <div className="pf-lib-paper">
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
          {item.folder && folder === null && (
            <Tag icon={<FolderOutlined />} style={{ marginTop: 4 }}>
              {item.folder}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 210,
      render: (_v, item) => (
        <Space size={6} wrap>
          <Button size="small" icon={<BookOutlined />} onClick={() => void cite([item])}>
            Trích dẫn
          </Button>
          <Popconfirm title="Xóa bài này khỏi thư viện?" okText="Xóa" cancelText="Hủy" onConfirm={() => void remove([item.key])}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              Xóa
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const limit = account.entitlements.libraryMax;

  return (
    <>
      {holder}
      <div className="pf-lib">
        <Panel title="Thư mục" className="pf-lib-folders" extra={`${items.length}/${limit} bài`}>
          <div className="pf-folder-list" role="list">
            <button type="button" role="listitem" className={`pf-folder${folder === null ? ' is-active' : ''}`} onClick={() => setFolder(null)}>
              <FolderOpenOutlined /> <span className="pf-folder-name">Tất cả</span> <span className="pf-folder-count">{items.length}</span>
            </button>
            {folders.named.map((name) => (
              <button type="button" role="listitem" key={name} className={`pf-folder${folder === name ? ' is-active' : ''}`} onClick={() => setFolder(name)}>
                <FolderOutlined /> <span className="pf-folder-name">{name}</span> <span className="pf-folder-count">{folders.counts.get(name)}</span>
              </button>
            ))}
            {folders.counts.has(NO_FOLDER) && folders.named.length > 0 && (
              <button type="button" role="listitem" className={`pf-folder${folder === NO_FOLDER ? ' is-active' : ''}`} onClick={() => setFolder(NO_FOLDER)}>
                <FolderOutlined /> <span className="pf-folder-name">Chưa phân loại</span> <span className="pf-folder-count">{folders.counts.get(NO_FOLDER)}</span>
              </button>
            )}
          </div>
        </Panel>

        <Panel title="Bài đã lưu" extra={`${shown.length}/${items.length} bài`} className="pf-lib-main">
          <div className="pf-toolbar">
            <Input.Search allowClear placeholder="Tìm theo tiêu đề, tác giả, tạp chí, DOI..." value={text} onChange={(e) => setText(e.target.value)} className="pf-toolbar-search" />
            <Dropdown menu={exportMenu} trigger={['click']} disabled={target.length === 0}>
              <Button icon={<DownloadOutlined />}>{selectedItems.length > 0 ? `Xuất ${selectedItems.length} bài đã chọn` : `Xuất ${shown.length} bài`}</Button>
            </Dropdown>
            <Button icon={<BookOutlined />} disabled={target.length === 0} onClick={() => void cite(target)}>
              Sao chép trích dẫn
            </Button>
          </div>
          {selectedItems.length > 0 && (
            <div className="pf-lib-selection">
              <Typography.Text>Đã chọn {selectedItems.length} bài</Typography.Text>
              <Space>
                <Button size="small" type="link" onClick={() => setSelected([])}>
                  Bỏ chọn
                </Button>
                <Popconfirm title={`Xóa ${selectedItems.length} bài đã chọn?`} okText="Xóa" cancelText="Hủy" onConfirm={() => void remove(selectedItems.map((i) => i.key))}>
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    Xóa đã chọn
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          )}
          {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} action={<Button size="small" onClick={() => void load()}>Thử lại</Button>} />}
          <Table<LibraryItem>
            size="middle"
            rowKey="key"
            loading={loading}
            dataSource={shown}
            columns={columns}
            rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
            pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: <Empty description={items.length === 0 ? 'Chưa có bài nào. Bấm “Lưu” ở cột Thao tác trong kết quả tìm kiếm.' : 'Không có bài khớp bộ lọc.'} /> }}
          />
        </Panel>
      </div>
    </>
  );
}

export default function LibraryPage() {
  return (
    <AccountPageShell subtitle="Thư viện của tôi">
      <FeatureGate feature="library" title="Thư viện cá nhân" pitch="Lưu bài vào các thư mục riêng, xem lại và xuất trên mọi thiết bị.">
        <Library />
      </FeatureGate>
    </AccountPageShell>
  );
}
