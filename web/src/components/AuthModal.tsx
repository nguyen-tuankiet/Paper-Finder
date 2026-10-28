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
  confirm?: string;
}

/** Hộp thoại đăng nhập / tạo tài khoản bằng email và mật khẩu. */
export function AuthModal({ open, tab, onTabChange, onClose }: Props) {
  const account = useAccount();
  const [form] = Form.useForm<Values>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = account.plans?.freeDailySearches ?? 0;

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

  const fields = (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => void submit(v)} autoComplete="on" disabled={busy}>
      <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Nhập email.' }, { type: 'email', message: 'Email không hợp lệ.' }]}>
        <Input prefix={<MailOutlined />} placeholder="ban@example.com" autoComplete="email" inputMode="email" />
      </Form.Item>
      <Form.Item
        name="password"
        label="Mật khẩu"
        rules={[{ required: true, message: 'Nhập mật khẩu.' }, ...(tab === 'register' ? [{ min: 8, message: 'Mật khẩu cần ít nhất 8 ký tự.' }] : [])]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder={tab === 'register' ? 'Ít nhất 8 ký tự' : 'Mật khẩu'} autoComplete={tab === 'register' ? 'new-password' : 'current-password'} />
      </Form.Item>
      {tab === 'register' && (
        <Form.Item
          name="confirm"
          label="Nhập lại mật khẩu"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Nhập lại mật khẩu.' },
            ({ getFieldValue }) => ({
              validator: (_rule, value: string) => (!value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('Mật khẩu nhập lại chưa khớp.'))),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
        </Form.Item>
      )}
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Button type="primary" htmlType="submit" block loading={busy}>
        {tab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
      </Button>
    </Form>
  );

  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={420} destroyOnHidden title={null} afterClose={() => { form.resetFields(); setError(null); }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {tab === 'login' ? 'Đăng nhập PaperFinder' : 'Tạo tài khoản PaperFinder'}
      </Typography.Title>
      {tab === 'register' && free > 0 && <Typography.Paragraph type="secondary">Tài khoản miễn phí có {free} lượt tìm mỗi ngày. Nâng cấp Pro bất cứ lúc nào để không giới hạn.</Typography.Paragraph>}
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
      {fields}
    </Modal>
  );
}
