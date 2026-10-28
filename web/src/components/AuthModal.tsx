import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { useAccount } from '../lib/accountContext';

export type AuthTab = 'login' | 'register';

interface Props {
  open: boolean;
  tab: AuthTab;
  onTabChange: (tab: AuthTab) => void;
  onClose: () => void;
}

interface Values {
  email: string;
  password: string;
}

/**
 * Đăng nhập / tạo tài khoản chỉ với email + mật khẩu (có nút hiện mật khẩu nên không bắt nhập lại).
 * Tạo xong là đăng nhập luôn, và trình duyệt được nhớ ~6 tháng (tự gia hạn khi còn dùng).
 */
export function AuthModal({ open, tab, onTabChange, onClose }: Props) {
  const account = useAccount();
  const [form] = Form.useForm<Values>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = account.plans?.tiers.find((t) => t.tier === 'free');

  const submit = async (values: Values) => {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') await account.login(values.email, values.password);
      else await account.register(values.email, values.password);
      form.resetFields();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={420} destroyOnHidden title={null} afterClose={() => { form.resetFields(); setError(null); }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {tab === 'login' ? 'Đăng nhập PaperFinder' : 'Tạo tài khoản PaperFinder'}
      </Typography.Title>
      {tab === 'register' && (
        <Typography.Paragraph type="secondary">
          Chỉ cần email và mật khẩu. Tạo xong là đăng nhập luôn
          {free?.dailySearches ? `, có ${free.dailySearches} lượt tìm mỗi ngày và xuất được file Excel/CSV` : ''}. Bạn sẽ không phải đăng nhập lại trên thiết bị này.
        </Typography.Paragraph>
      )}
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setError(null);
          onTabChange(key as AuthTab);
        }}
        items={[
          { key: 'login', label: 'Đăng nhập' },
          { key: 'register', label: 'Tạo tài khoản' },
        ]}
      />
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => void submit(v)} autoComplete="on" disabled={busy}>
        <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Nhập email.' }, { type: 'email', message: 'Email không hợp lệ.' }]}>
          <Input prefix={<MailOutlined />} placeholder="ban@example.com" autoComplete="username" inputMode="email" autoFocus />
        </Form.Item>
        <Form.Item
          name="password"
          label="Mật khẩu"
          rules={[{ required: true, message: 'Nhập mật khẩu.' }, ...(tab === 'register' ? [{ min: 8, message: 'Mật khẩu cần ít nhất 8 ký tự.' }] : [])]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder={tab === 'register' ? 'Ít nhất 8 ký tự' : 'Mật khẩu'} autoComplete={tab === 'register' ? 'new-password' : 'current-password'} />
        </Form.Item>
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
        <Button type="primary" htmlType="submit" block loading={busy}>
          {tab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản và đăng nhập'}
        </Button>
      </Form>
    </Modal>
  );
}
