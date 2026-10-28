import { LockOutlined, ProfileOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import { useAccount } from '../lib/accountContext';
import { ApiError, lookupDois, type LookupResponse } from '../lib/api';
import { Panel } from './Panel';

const PLACEHOLDER = 'Mỗi dòng một DOI, link doi.org, hoặc dán cả đoạn tài liệu tham khảo, ví dụ:\n10.1038/nature12373\nhttps://doi.org/10.1016/S0140-6736(97)11096-0';

interface Props {
  onResult: (response: LookupResponse) => void;
}

/**
 * Dán danh sách DOI (từ luận văn, bài báo...) để lấy thông tin đầy đủ và sao chép/xuất tài liệu tham khảo đúng chuẩn.
 * Hạng Tiêu chuẩn trở lên (khi máy chủ bật tài khoản); các hạng khác thấy khung bị khóa kèm lời mời nâng hạng.
 */
export function DoiLookupPanel({ onResult }: Props) {
  const account = useAccount();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const max = account.entitlements.doiLookupMax;
  const locked = account.enabled && max === 0;

  const unlock = () => {
    if (!account.user) account.openAuth('register');
    else account.openUpgrade('Dán danh sách DOI để lấy tài liệu tham khảo chuẩn dành cho hạng Tiêu chuẩn trở lên.', 'standard');
  };

  const run = async () => {
    if (locked) return unlock();
    if (!text.trim()) {
      setError('Hãy dán ít nhất một DOI.');
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      onResult(await lookupDois(text, controller.signal));
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.code === 'plan_required') account.openUpgrade(err.message, 'standard');
      else if (err instanceof ApiError && err.code === 'unauthorized') account.openAuth('login');
      else setError(err instanceof Error ? err.message : 'Không tra được danh sách DOI.');
    } finally {
      if (controllerRef.current === controller) setBusy(false);
    }
  };

  return (
    <Panel title="Chuẩn hóa danh sách DOI" extra={locked ? 'Hạng Tiêu chuẩn trở lên' : max > 0 ? `Tối đa ${max} DOI mỗi lần` : 'Dán DOI, nhận tài liệu tham khảo chuẩn'} aria-label="Tra cứu danh sách DOI">
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          Đã có sẵn danh sách DOI? Dán vào đây để lấy đầy đủ thông tin từng bài, rồi sao chép hoặc xuất tài liệu tham khảo theo IEEE, APA 7 hoặc mẫu tự soạn (kể cả file Word).
        </Typography.Text>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 10 }}
          placeholder={PLACEHOLDER}
          disabled={busy || locked}
          aria-label="Danh sách DOI cần tra"
        />
        {error && <Alert type="error" showIcon title={error} />}
        <Space wrap>
          {locked ? (
            <Button type="primary" icon={<LockOutlined />} onClick={unlock}>
              {account.user ? 'Mở khóa bằng gói Tiêu chuẩn' : 'Đăng nhập để dùng'}
            </Button>
          ) : (
            <Button type="primary" icon={<ProfileOutlined />} loading={busy} onClick={() => void run()}>
              Tra cứu và chuẩn hóa
            </Button>
          )}
          {busy && (
            <Button
              onClick={() => {
                controllerRef.current?.abort();
                setBusy(false);
              }}
            >
              Hủy
            </Button>
          )}
          {busy && <Typography.Text type="secondary">Đang tra từng DOI, có thể mất vài chục giây với danh sách dài...</Typography.Text>}
        </Space>
      </Space>
    </Panel>
  );
}
