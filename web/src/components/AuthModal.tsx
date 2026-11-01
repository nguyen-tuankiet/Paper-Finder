import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Tabs, Typography, message } from 'antd';
import { useState } from 'react';
import { useAccount } from '../lib/accountContext';
import { requestPasswordReset } from '../lib/api';

/** login/register: đăng nhập và tạo tài khoản; forgot: xin liên kết đặt lại mật khẩu; reset: đặt mật khẩu mới từ liên kết trong email. */
export type AuthTab = 'login' | 'register' | 'forgot' | 'reset';

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

const TITLES: Record<AuthTab, string> = {
  login: 'Đăng nhập PaperFinder',
  register: 'Tạo tài khoản PaperFinder',
  forgot: 'Quên mật khẩu',
  reset: 'Đặt mật khẩu mới',
};

/**
 * Đăng nhập / tạo tài khoản chỉ với email + mật khẩu (có nút hiện mật khẩu nên không bắt nhập lại).
 * Tạo xong là đăng nhập luôn, và trình duyệt được nhớ ~6 tháng (tự gia hạn khi còn dùng).
 * Quên mật khẩu: nhập email để nhận liên kết (hiệu lực 1 giờ); mở liên kết thì hộp thoại này hiện ở bước đặt mật khẩu mới.
 */
export function AuthModal({ open, tab, onTabChange, onClose }: Props) {
  const account = useAccount();
  const [form] = Form.useForm<Values>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [messageApi, holder] = message.useMessage();
  const free = account.plans?.tiers.find((t) => t.tier === 'free');
  const mainTab = tab === 'login' || tab === 'register';

  const goTo = (next: AuthTab) => {
    setError(null);
    setSentTo(null);
    onTabChange(next);
  };

  const submit = async (values: Values) => {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') await account.login(values.email, values.password);
      else if (tab === 'register') await account.register(values.email, values.password);
      else if (tab === 'forgot') {
        await requestPasswordReset(values.email);
        setSentTo(values.email);
        return;
      } else {
        await account.resetPassword(values.password);
        void messageApi.success('Đã đặt mật khẩu mới và đăng nhập cho bạn.');
      }
      form.resetFields();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={420}
      destroyOnHidden
      title={null}
      afterClose={() => {
        form.resetFields();
        setError(null);
        setSentTo(null);
      }}
    >
      {holder}
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {TITLES[tab]}
      </Typography.Title>
      {tab === 'register' && (
        <Typography.Paragraph type="secondary">
          Chỉ cần email và mật khẩu. Tạo xong là đăng nhập luôn
          {free?.dailySearches ? `, có ${free.dailySearches} lượt tìm mỗi ngày và xuất được file Excel/CSV` : ''}. Bạn sẽ không phải đăng nhập lại trên thiết bị này.
        </Typography.Paragraph>
      )}
      {tab === 'forgot' && !sentTo && <Typography.Paragraph type="secondary">Nhập email đã đăng ký. Chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu mới (có hiệu lực 1 giờ).</Typography.Paragraph>}
      {tab === 'reset' && <Typography.Paragraph type="secondary">Nhập mật khẩu mới cho tài khoản của bạn. Đặt xong là đăng nhập luôn, các thiết bị khác sẽ phải đăng nhập lại.</Typography.Paragraph>}
      {mainTab && (
        <Tabs
          activeKey={tab}
          onChange={(key) => goTo(key as AuthTab)}
          items={[
            { key: 'login', label: 'Đăng nhập' },
            { key: 'register', label: 'Tạo tài khoản' },
          ]}
        />
      )}

      {tab === 'forgot' && sentTo ? (
        <>
          <Alert
            type="success"
            showIcon
            title="Đã gửi hướng dẫn"
            description={`Nếu ${sentTo} đã đăng ký tài khoản, bạn sẽ nhận được thư chứa liên kết đặt lại mật khẩu trong vài phút. Hãy kiểm tra cả thư mục thư rác. Liên kết có hiệu lực 1 giờ và chỉ dùng được một lần.`}
          />
          <Button block style={{ marginTop: 16 }} onClick={() => goTo('login')}>
            Quay lại đăng nhập
          </Button>
        </>
      ) : (
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => void submit(v)} autoComplete="on" disabled={busy}>
          {tab !== 'reset' && (
            <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Nhập email.' }, { type: 'email', message: 'Email không hợp lệ.' }]}>
              <Input prefix={<MailOutlined />} placeholder="ban@example.com" autoComplete="username" inputMode="email" autoFocus />
            </Form.Item>
          )}
          {tab !== 'forgot' && (
            <Form.Item
              name="password"
              label={tab === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu'}
              rules={[{ required: true, message: 'Nhập mật khẩu.' }, ...(tab !== 'login' ? [{ min: 8, message: 'Mật khẩu cần ít nhất 8 ký tự.' }] : [])]}
              extra={
                tab === 'login' && account.passwordResetEnabled ? (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => goTo('forgot')}>
                    Quên mật khẩu?
                  </Button>
                ) : undefined
              }
            >
              <Input.Password prefix={<LockOutlined />} placeholder={tab === 'login' ? 'Mật khẩu' : 'Ít nhất 8 ký tự'} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} autoFocus={tab === 'reset'} />
            </Form.Item>
          )}
          {tab === 'reset' && (
            <Form.Item
              name="confirm"
              label="Nhập lại mật khẩu mới"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Nhập lại mật khẩu mới.' },
                ({ getFieldValue }) => ({
                  validator: (_rule, value) => (!value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('Hai mật khẩu chưa giống nhau.'))),
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
            </Form.Item>
          )}
          {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
          <Button type="primary" htmlType="submit" block loading={busy}>
            {tab === 'login' ? 'Đăng nhập' : tab === 'register' ? 'Tạo tài khoản và đăng nhập' : tab === 'forgot' ? 'Gửi liên kết đặt lại' : 'Đặt mật khẩu mới'}
          </Button>
          {tab === 'forgot' && (
            <Button type="link" block style={{ marginTop: 8 }} onClick={() => goTo('login')}>
              Quay lại đăng nhập
            </Button>
          )}
        </Form>
      )}
    </Modal>
  );
}
