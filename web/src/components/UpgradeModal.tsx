import { CheckCircleFilled, CrownFilled } from '@ant-design/icons';
import { Alert, Button, Modal, Radio, Segmented, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Entitlements, PaidTier, PlanOption, PlanPeriod } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { startCheckout } from '../lib/api';
import { AUTHOR } from '../lib/author';

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

/** Danh sách quyền lợi của một hạng để hiển thị trong hộp thoại chọn gói. */
export function describeTier(e: Entitlements, options: { journalRankAvailable?: boolean } = {}): string[] {
  const lines = [
    e.dailySearches === null ? 'Tìm kiếm không giới hạn lượt mỗi ngày' : `${e.dailySearches} lượt tìm mỗi ngày`,
    `Lấy tới ${e.maxResultsPerSource} kết quả mỗi nguồn`,
    e.exportRows === null ? 'Xuất Excel/CSV không giới hạn số dòng' : e.exportRows === 0 ? 'Không xuất được file' : `Xuất Excel/CSV tối đa ${e.exportRows} dòng`,
  ];
  if (e.citationTools) lines.push('Sắp xếp và lọc kết quả theo số trích dẫn');
  if (e.journalRank && options.journalRankAvailable) lines.push('Xếp hạng tạp chí Q1–Q4 (SJR) và lọc theo hạng');
  if (e.wordExport) lines.push('Xuất tài liệu tham khảo ra file Word (.docx)');
  if (e.doiLookupMax > 0) lines.push(`Dán danh sách DOI (tới ${fmt(e.doiLookupMax)} DOI mỗi lần) để lấy tài liệu tham khảo chuẩn`);
  if (e.libraryMax > 0) lines.push(`Thư viện cá nhân tới ${fmt(e.libraryMax)} bài, chia thư mục, dùng trên mọi thiết bị`);
  if (e.historyMax > 0) lines.push(`Lịch sử ${e.historyMax} lần tìm gần nhất, chạy lại bằng một lần bấm`);
  if (e.referenceExport) lines.push('Xuất BibTeX và RIS cho Zotero, Mendeley, EndNote');
  return lines;
}

/** Phần trăm tiết kiệm so với mua lẻ theo tuần (tính theo giá mỗi ngày, làm tròn xuống). */
function savingPercent(plans: PlanOption[], plan: PlanOption): number {
  const week = plans.find((p) => p.tier === plan.tier && p.period === 'week');
  if (!week || plan.period === 'week') return 0;
  return Math.max(0, Math.floor((1 - plan.priceVnd / plan.days / (week.priceVnd / week.days)) * 100));
}

interface Props {
  open: boolean;
  reason?: string;
  /** Hạng chọn sẵn khi mở (vd. Pro khi người dùng bấm xuất BibTeX). */
  initialTier?: PaidTier;
  onClose: () => void;
  /** Chưa đăng nhập: mở hộp thoại tạo tài khoản. */
  onNeedLogin: () => void;
}

export function UpgradeModal({ open, reason, initialTier, onClose, onNeedLogin }: Props) {
  const account = useAccount();
  const allPlans = account.plans?.plans ?? [];
  const tiers = account.plans?.tiers ?? [];
  const billingEnabled = Boolean(account.plans?.billingEnabled);
  const [tier, setTier] = useState<PaidTier>(initialTier ?? 'standard');
  const [period, setPeriod] = useState<PlanPeriod>('month');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mỗi lần mở lại thì chọn sẵn hạng được gợi ý (hoặc hạng kế tiếp của người dùng).
  useEffect(() => {
    if (open) {
      setTier(initialTier ?? (account.tier === 'standard' ? 'pro' : 'standard'));
      setError(null);
    }
  }, [open, initialTier, account.tier]);

  const entitlements = tiers.find((t) => t.tier === tier);
  const options = allPlans.filter((p) => p.tier === tier);

  const pay = async () => {
    if (!account.user) {
      onClose();
      onNeedLogin();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { checkoutUrl } = await startCheckout(tier, period);
      window.location.assign(checkoutUrl); // chuyển sang trang thanh toán QR của PayOS
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được link thanh toán.');
      setBusy(false);
    }
  };

  const current = account.user && account.user.tier !== 'free' ? account.user : null;
  const untilOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');
  const currentUntil = current ? untilOf(current.tier === 'pro' ? current.proUntil : current.standardUntil) : '';
  const tierLabel = (t: PaidTier) => tiers.find((x) => x.tier === t)?.label ?? t;

  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={540} destroyOnHidden title={null}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <CrownFilled style={{ color: '#d4a017' }} /> Chọn gói PaperFinder
      </Typography.Title>
      {reason && <Alert type="info" showIcon title={reason} style={{ marginBottom: 16 }} />}
      {current && <Alert type="success" showIcon title={`Bạn đang dùng hạng ${tierLabel(current.tier as PaidTier)}, còn hiệu lực đến ${currentUntil}. Mua thêm sẽ được cộng dồn.`} style={{ marginBottom: 16 }} />}

      <Segmented<PaidTier>
        block
        value={tier}
        onChange={setTier}
        options={[
          { value: 'standard', label: tierLabel('standard') },
          { value: 'pro', label: tierLabel('pro') },
        ]}
        style={{ marginBottom: 14 }}
      />

      <ul className="pf-pro-benefits">
        {entitlements && describeTier(entitlements, { journalRankAvailable: account.plans?.journalRankAvailable }).map((line) => (
          <li key={line}>
            <CheckCircleFilled /> {line}
          </li>
        ))}
      </ul>

      {billingEnabled ? (
        <>
          <Radio.Group value={period} onChange={(e) => setPeriod(e.target.value as PlanPeriod)} className="pf-plan-group" disabled={busy}>
            {options.map((p) => {
              const saving = savingPercent(allPlans, p);
              return (
                <Radio.Button key={p.period} value={p.period} className="pf-plan">
                  <span className="pf-plan-name">
                    {p.label} {saving > 0 && <Tag color="green" style={{ marginInlineEnd: 0 }}>-{saving}%/ngày</Tag>}
                  </span>
                  <span className="pf-plan-price">{money(p.priceVnd)}</span>
                </Radio.Button>
              );
            })}
          </Radio.Group>
          {error && <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} />}
          <Button type="primary" size="large" block loading={busy} onClick={() => void pay()} style={{ marginTop: 16 }}>
            {account.user ? `Thanh toán qua PayOS` : 'Tạo tài khoản để mua'}
          </Button>
          <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
            Thanh toán bằng chuyển khoản QR ngân hàng qua PayOS, tự kích hoạt sau khi nhận tiền, không tự động gia hạn. Mua thêm cùng hạng thì cộng dồn. Mua Pro khi đang có Tiêu chuẩn: Pro dùng ngay, phần Tiêu chuẩn còn lại được giữ và dùng tiếp sau khi Pro hết. Cần hỗ trợ, liên hệ{' '}
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
