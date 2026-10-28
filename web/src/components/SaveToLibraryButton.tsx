import { StarOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Popover, Space, Typography, message } from 'antd';
import { useState } from 'react';
import type { PaperRecord } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { ApiError, fetchLibrary, saveToLibrary } from '../lib/api';

/** Nút "Lưu" trong cột Thao tác: lưu bài vào thư viện cá nhân (Pro), có thể chọn hoặc gõ tên thư mục. Ẩn khi tài khoản tắt. */
export function SaveToLibraryButton({ record }: { record: PaperRecord }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [messageApi, holder] = message.useMessage();

  if (!account.enabled) return null;

  const onOpenChange = (next: boolean) => {
    if (next && !account.user) {
      account.openAuth('register');
      return;
    }
    if (next && !account.isPro) {
      account.openUpgrade('Thư viện cá nhân (lưu bài, chia thư mục) dành cho gói Pro.');
      return;
    }
    setOpen(next);
    if (next) {
      // Gợi ý các thư mục đã có.
      fetchLibrary()
        .then((items) => setFolders([...new Set(items.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'))))
        .catch(() => undefined);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const result = await saveToLibrary(record, folder.trim());
      void messageApi.success(result.status === 'saved' ? 'Đã lưu vào thư viện.' : 'Bài đã có trong thư viện; đã cập nhật thư mục.');
      setOpen(false);
      setFolder('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pro_required') account.openUpgrade(err.message);
      else void messageApi.error(err instanceof Error ? err.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {holder}
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        trigger="click"
        placement="left"
        title="Lưu vào thư viện"
        content={
          <Space orientation="vertical" size={8} style={{ width: 220 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Thư mục (tùy chọn)
            </Typography.Text>
            <AutoComplete
              value={folder}
              onChange={setFolder}
              options={folders.map((f) => ({ value: f }))}
              placeholder="Ví dụ: Luận văn chương 2"
              maxLength={60}
              style={{ width: '100%' }}
            />
            <Button type="primary" block loading={busy} onClick={() => void save()}>
              Lưu
            </Button>
          </Space>
        }
      >
        <Button size="small" icon={<StarOutlined />}>
          Lưu
        </Button>
      </Popover>
    </>
  );
}
