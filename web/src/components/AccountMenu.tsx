import { BookOutlined, CrownFilled, HistoryOutlined, KeyOutlined, LoginOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Dropdown, Form, Input, Modal, Tag, message, type MenuProps } from 'antd';
import { useState } from 'react';
import { useAccount } from '../lib/accountContext';
import { changePassword } from '../lib/api';

interface Props {
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useAccount();
  const [form] = Form.useForm<{ currentPassword: string; newPassword: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageApi, holder] = message.useMessage();

  const submit = async (values: { currentPassword: string; newPassword: string }) => {
    setBusy(true);
    setError(null);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      await account.refresh();
      void messageApi.success('Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đổi được mật khẩu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {holder}
      <Modal open={open} onCancel={onClose} title="Đổi mật khẩu" footer={null} centered destroyOnHidden width={400} afterClose={() => { form.resetFields(); setError(null); }}>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => void submit(v)} disabled={busy}>
          <Form.Item name="currentPassword" label="Mật khẩu hiện tại" rules={[{ required: true, message: 'Nhập mật khẩu hiện tại.' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="Mật khẩu mới" rules={[{ required: true, message: 'Nhập mật khẩu mới.' }, { min: 8, message: 'Mật khẩu cần ít nhất 8 ký tự.' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          {error && <div role="alert" style={{ color: '#cf1322', marginBottom: 12 }}>{error}</div>}
          <Button type="primary" htmlType="submit" block loading={busy}>
            Đổi mật khẩu
          </Button>
        </Form>
      </Modal>
    </>
  );
}

/** Nút đăng nhập, hoặc menu tài khoản (thư viện, lịch sử, nâng cấp, đổi mật khẩu, đăng xuất). Ẩn khi máy chủ tắt tính năng tài khoản. */
export function AccountMenu({ onOpenLibrary, onOpenHistory }: Props) {
  const account = useAccount();
  const [passwordOpen, setPasswordOpen] = useState(false);
  if (!account.enabled) return null;

  if (!account.user) {
    return (
      <Button className="pf-account-btn" icon={<LoginOutlined />} onClick={() => account.openAuth('login')}>
        Đăng nhập
      </Button>
    );
  }

  const user = account.user;
  const items: MenuProps['items'] = [
    {
      key: 'info',
      disabled: true,
      label: (
        <div className="pf-account-info">
          <strong>{user.email}</strong>
          <span>{user.isPro && user.proUntil ? `Gói Pro đến ${new Date(user.proUntil).toLocaleDateString('vi-VN')}` : 'Gói miễn phí'}</span>
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'library', icon: <BookOutlined />, label: 'Thư viện của tôi', onClick: onOpenLibrary },
    { key: 'history', icon: <HistoryOutlined />, label: 'Lịch sử tìm kiếm', onClick: onOpenHistory },
    { key: 'upgrade', icon: <CrownFilled style={{ color: '#d4a017' }} />, label: user.isPro ? 'Gia hạn gói Pro' : 'Nâng cấp Pro', onClick: () => account.openUpgrade() },
    { type: 'divider' },
    { key: 'password', icon: <KeyOutlined />, label: 'Đổi mật khẩu', onClick: () => setPasswordOpen(true) },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: () => void account.logout() },
  ];

  return (
    <>
      <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
        <Button className="pf-account-btn" icon={<UserOutlined />} aria-label="Menu tài khoản">
          <span className="pf-account-email">{user.email}</span>
          {user.isPro && (
            <Tag color="gold" style={{ marginInlineEnd: 0 }} icon={<CrownFilled />}>
              Pro
            </Tag>
          )}
        </Button>
      </Dropdown>
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
}
