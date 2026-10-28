import { CheckCircleFilled, CrownFilled } from '@ant-design/icons';
import { Alert, Button, Modal, Radio, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { PlanId, PlanOption } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { startCheckout } from '../lib/api';
import { AUTHOR } from '../lib/author';

export const PRO_BENEFITS = [
  'Tìm kiếm không giới hạn lượt mỗi ngày',
  'Thư viện cá nhân: lưu bài, chia thư mục, dùng trên mọi thiết bị',
  'Lịch sử tìm kiếm, chạy lại bằng một lần bấm',
  'Xuất BibTeX và RIS cho Zotero, Mendeley, EndNote',
];

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;

/** Phần trăm tiết kiệm của gói dài so với mua lẻ gói tháng (làm tròn xuống). */
function savingPercent(plans: PlanOption[], plan: PlanOption): number {
  const month = plans.find((p) => p.id === 'month');
  if (!month || plan.id === 'month') return 0;
  const monthlyEquivalent = (month.priceVnd / month.days) * plan.days;
  return Math.max(0, Math.floor((1 - plan.priceVnd / monthlyEquivalent) * 100));
}

interface Props {
  open: boolean;
  reason?: string;
  onClose: () => void;
  /** Chưa đăng nhập: mở hộp thoại tạo tài khoản. */
  onNeedLogin: () => void;
}

export function UpgradeModal({ open, reason, onClose, onNeedLogin }: Props) {
  const account = useAccount();
  const plans = account.plans?.plans ?? [];
  const billingEnabled = Boolean(account.plans?.billingEnabled);
  const [plan, setPlan] = useState<PlanId>('year');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (!account.user) {
      onClose();
      onNeedLogin();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await startCheckout(plan);
      window.location.assign(checkoutUrl); // chuyển sang trang thanh toán QR của PayOS
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được link thanh toán.');
      setBusy(false);
    }
  };

  const expiry = account.user?.isPro && account.user.proUntil ? new Date(account.user.proUntil).toLocaleDateString('vi-VN') : null;

  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={520} destroyOnHidden title={null}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <CrownFilled style={{ color: '#d4a017' }} /> PaperFinder Pro
      </Typography.Title>
      {reason && <Alert type="info" showIcon title={reason} style={{ marginBottom: 16 }} />}
      {expiry && <Alert type="success" showIcon title={`Gói Pro của bạn còn hiệu lực đến ${expiry}. Mua thêm sẽ được cộng dồn.`} style={{ marginBottom: 16 }} />}

      <ul className="pf-pro-benefits">
        {PRO_BENEFITS.map((b) => (
          <li key={b}>
            <CheckCircleFilled /> {b}
          </li>
        ))}
      </ul>

      {billingEnabled ? (
        <>
          <Radio.Group value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} className="pf-plan-group" disabled={busy}>
            {plans.map((p) => {
              const saving = savingPercent(plans, p);
              return (
                <Radio.Button key={p.id} value={p.id} className="pf-plan">
                  <span className="pf-plan-name">
                    {p.label} {saving > 0 && <Tag color="green" style={{ marginInlineEnd: 0 }}>Tiết kiệm {saving}%</Tag>}
                  </span>
                  <span className="pf-plan-price">{money(p.priceVnd)}</span>
                </Radio.Button>
              );
            })}
          </Radio.Group>
          {error && <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} />}
          <Button type="primary" size="large" block loading={busy} onClick={() => void pay()} style={{ marginTop: 16 }}>
            {account.user ? (expiry ? 'Gia hạn qua PayOS' : 'Thanh toán qua PayOS') : 'Tạo tài khoản để nâng cấp'}
          </Button>
          <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
            Thanh toán bằng chuyển khoản QR ngân hàng qua PayOS. Pro tự kích hoạt sau khi nhận tiền và không tự động gia hạn. Nếu gặp vấn đề, hãy liên hệ{' '}
            <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer">
              {AUTHOR.name}
            </a>
            .
          </Typography.Paragraph>
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          title="Thanh toán trực tuyến chưa được bật"
          description={
            <>
              Hiện chưa thể mua trực tiếp trên trang. Vui lòng liên hệ{' '}
              <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer">
                {AUTHOR.name}
              </a>{' '}
              để được nâng cấp thủ công.
            </>
          }
        />
      )}
    </Modal>
  );
}
