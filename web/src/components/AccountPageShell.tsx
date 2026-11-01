import { LoginOutlined, UserAddOutlined } from '@ant-design/icons';
import { Button, Layout, Result, Spin } from 'antd';
import type { ReactNode } from 'react';
import { useAccount } from '../lib/accountContext';
import { AccountMenu } from './AccountMenu';
import { AppFooter } from './AppFooter';
import { PageHeader } from './PageHeader';
import { Panel } from './Panel';

/** Khung chung của các trang riêng cho tài khoản (Thư viện, Lịch sử): thanh đầu trang có menu tài khoản, nội dung giữa, chân trang. */
export function AccountPageShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <Layout className="pf-layout">
      <PageHeader
        subtitle={subtitle}
        right={
          <a href="/" className="pf-header-link">
            ← Về trang tìm kiếm
          </a>
        }
        account={<AccountMenu />}
      />
      <Layout.Content className="pf-main">{children}</Layout.Content>
      <AppFooter />
    </Layout>
  );
}

interface GateProps {
  /** Quyền lợi cần có: số lượng tối đa của tính năng này phải lớn hơn 0 trong hạng hiện tại. */
  feature: 'library' | 'history';
  title: string;
  /** Mô tả ngắn lợi ích của tính năng, hiện khi người dùng chưa đủ hạng. */
  pitch: string;
  children: ReactNode;
}

/** Chặn nội dung theo trạng thái tài khoản: đang tải, tắt tài khoản, chưa đăng nhập, hoặc chưa đủ hạng (kèm nút mua gói). */
export function FeatureGate({ feature, title, pitch, children }: GateProps) {
  const account = useAccount();
  const max = feature === 'library' ? account.entitlements.libraryMax : account.entitlements.historyMax;

  if (!account.ready) {
    return (
      <Panel>
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      </Panel>
    );
  }
  if (!account.enabled) {
    return (
      <Panel>
        <Result status="info" title="Tính năng tài khoản chưa được bật" subTitle="Máy chủ này chưa bật đăng nhập nên chưa có mục này." extra={<Button href="/">Về trang tìm kiếm</Button>} />
      </Panel>
    );
  }
  if (!account.user) {
    return (
      <Panel>
        <Result
          icon={<LoginOutlined style={{ color: '#1f4e79' }} />}
          title={`Đăng nhập để dùng ${title.toLowerCase()}`}
          subTitle={pitch}
          extra={[
            <Button key="login" type="primary" icon={<LoginOutlined />} onClick={() => account.openAuth('login')}>
              Đăng nhập
            </Button>,
            <Button key="register" icon={<UserAddOutlined />} onClick={() => account.openAuth('register')}>
              Tạo tài khoản
            </Button>,
          ]}
        />
      </Panel>
    );
  }
  if (max === 0) {
    return (
      <Panel>
        <Result
          status="info"
          title={`${title} dành cho hạng Tiêu chuẩn trở lên`}
          subTitle={`${pitch} Dữ liệu đã lưu trước đây được giữ nguyên và xem lại được khi bạn mua lại gói.`}
          extra={[
            <Button key="buy" type="primary" onClick={() => account.openUpgrade(`${title} dành cho hạng Tiêu chuẩn trở lên.`, 'standard')}>
              Xem các gói
            </Button>,
            <Button key="back" href="/">
              Về trang tìm kiếm
            </Button>,
          ]}
        />
      </Panel>
    );
  }
  return <>{children}</>;
}
