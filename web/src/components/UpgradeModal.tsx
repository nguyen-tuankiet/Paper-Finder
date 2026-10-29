import { CheckCircleFilled, CrownFilled, MinusOutlined } from '@ant-design/icons';
import { Alert, Button, Modal, Segmented, Tag, Typography } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import type { CheckoutResponse, Entitlements, PaidTier, PlanOption, PlanPeriod } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { startCheckout } from '../lib/api';
import { AUTHOR } from '../lib/author';
import { PaymentStep } from './PaymentStep';

const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const money = (value: number) => `${fmt(value)}đ`;

/** Một ô so sánh: true/false hiện dấu tích/dấu gạch, chuỗi hiện nguyên văn. */
type Cell = string | boolean;

interface Row {
  label: string;
  standard: Cell;
  pro: Cell;
}

/** Các hàng so sánh Tiêu chuẩn và Pro, dựng từ quyền lợi do máy chủ công bố (luôn khớp với giới hạn thật). */
function buildRows(standard: Entitlements, pro: Entitlements, journalRankAvailable: boolean): Row[] {
  const searches = (e: Entitlements) => (e.dailySearches === null ? 'Không giới hạn' : `${e.dailySearches} lượt`);
  const rows: Row[] = [
    { label: 'Lượt tìm mỗi ngày', standard: searches(standard), pro: searches(pro) },
    { label: 'Kết quả tối đa mỗi nguồn', standard: String(standard.maxResultsPerSource), pro: String(pro.maxResultsPerSource) },
    {
      label: 'Xuất Excel/CSV',
      standard: standard.exportRows === null ? 'Không giới hạn' : standard.exportRows === 0 ? false : `${standard.exportRows} dòng`,
      pro: pro.exportRows === null ? 'Không giới hạn' : pro.exportRows === 0 ? false : `${pro.exportRows} dòng`,
    },
    { label: 'Sắp xếp, lọc theo số trích dẫn', standard: standard.citationTools, pro: pro.citationTools },
  ];
  if (journalRankAvailable) rows.push({ label: 'Xếp hạng tạp chí Q1–Q4 (SJR)', standard: standard.journalRank, pro: pro.journalRank });
  rows.push(
    { label: 'Xuất tài liệu tham khảo ra Word', standard: standard.wordExport, pro: pro.wordExport },
    { label: 'Dán danh sách DOI lấy tài liệu tham khảo', standard: standard.doiLookupMax > 0 ? `${fmt(standard.doiLookupMax)} DOI/lần` : false, pro: pro.doiLookupMax > 0 ? `${fmt(pro.doiLookupMax)} DOI/lần` : false },
    { label: 'Thư viện cá nhân (lưu bài, chia thư mục)', standard: standard.libraryMax > 0 ? `${fmt(standard.libraryMax)} bài` : false, pro: pro.libraryMax > 0 ? `${fmt(pro.libraryMax)} bài` : false },
    { label: 'Lịch sử tìm kiếm', standard: standard.historyMax > 0 ? `${standard.historyMax} lần gần nhất` : false, pro: pro.historyMax > 0 ? `${pro.historyMax} lần gần nhất` : false },
    { label: 'Xuất BibTeX/RIS (Zotero, Mendeley, EndNote)', standard: standard.referenceExport, pro: pro.referenceExport },
  );
  return rows;
}

function CellView({ value }: { value: Cell }) {
  if (value === true) return <CheckCircleFilled className="pf-cmp-yes" aria-label="Có" />;
  if (value === false) return <MinusOutlined className="pf-cmp-no" aria-label="Không có" />;
  return <>{value}</>;
}

/** Phần trăm tiết kiệm mỗi ngày so với mua lẻ theo tuần (làm tròn xuống). */
function savingPercent(plans: PlanOption[], plan: PlanOption): number {
  const week = plans.find((p) => p.tier === plan.tier && p.period === 'week');
  if (!week || plan.period === 'week') return 0;
  return Math.max(0, Math.floor((1 - plan.priceVnd / plan.days / (week.priceVnd / week.days)) * 100));
}

const PERIOD_LABEL: Record<PlanPeriod, string> = { week: '7 ngày', month: '1 tháng', year: '1 năm' };

interface Props {
  open: boolean;
  reason?: string;
  /** Hạng được gợi ý (vd. Pro khi người dùng bấm xuất BibTeX): cột đó được làm nổi bật. */
  initialTier?: PaidTier;
  onClose: () => void;
  /** Chưa đăng nhập: mở hộp thoại tạo tài khoản. */
  onNeedLogin: () => void;
}

/** So sánh hai hạng trả phí cạnh nhau: chọn thời hạn một lần, thấy giá và đầy đủ quyền lợi của cả hai, mua ngay từ cột muốn chọn. */
export function UpgradeModal({ open, reason, initialTier, onClose, onNeedLogin }: Props) {
  const account = useAccount();
  const allPlans = account.plans?.plans ?? [];
  const tiers = account.plans?.tiers ?? [];
  const billingEnabled = Boolean(account.plans?.billingEnabled);
  const [period, setPeriod] = useState<PlanPeriod>('month');
  const [busy, setBusy] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<{ checkout: CheckoutResponse; tier: PaidTier; period: PlanPeriod } | null>(null);

  useEffect(() => {
    if (open) setError(null);
    else setOrder(null);
  }, [open]);

  const standard = tiers.find((t) => t.tier === 'standard');
  const pro = tiers.find((t) => t.tier === 'pro');
  const recommended: PaidTier = initialTier ?? (account.tier === 'standard' ? 'pro' : 'standard');
  const rows = standard && pro ? buildRows(standard, pro, Boolean(account.plans?.journalRankAvailable)) : [];

  const pay = async (tier: PaidTier) => {
    if (!account.user) {
      onClose();
      onNeedLogin();
      return;
    }
    setBusy(tier);
    setError(null);
    try {
      const checkout = await startCheckout(tier, period);
      setOrder({ checkout, tier, period });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được đơn thanh toán.');
    } finally {
      setBusy(null);
    }
  };

  const untilOf = (tier: PaidTier) => {
    const iso = account.user ? (tier === 'pro' ? account.user.proUntil : account.user.standardUntil) : null;
    return iso && new Date(iso).getTime() > Date.now() ? new Date(iso).toLocaleDateString('vi-VN') : null;
  };

  const header = (tier: PaidTier): ReactNode => {
    const plan = allPlans.find((p) => p.tier === tier && p.period === period);
    const entitlement = tier === 'pro' ? pro : standard;
    const until = untilOf(tier);
    const saving = plan ? savingPercent(allPlans, plan) : 0;
    return (
      <div className={`pf-cmp-head${recommended === tier ? ' is-recommended' : ''}`}>
        <div className="pf-cmp-name">
          {tier === 'pro' && <CrownFilled style={{ color: '#d4a017' }} />} {entitlement?.label ?? tier}
        </div>
        <div className="pf-cmp-tag">{recommended === tier ? <Tag color="blue">Gợi ý cho bạn</Tag> : <span>&nbsp;</span>}</div>
        {billingEnabled && plan ? (
          <>
            <div className="pf-cmp-price">{money(plan.priceVnd)}</div>
            <div className="pf-cmp-per">
              cho {PERIOD_LABEL[period]} · ~{money(Math.round(plan.priceVnd / plan.days))}/ngày
            </div>
            <div className="pf-cmp-save">{saving > 0 ? <Tag color="green">Rẻ hơn {saving}%/ngày</Tag> : <span>&nbsp;</span>}</div>
            <Button type={recommended === tier ? 'primary' : 'default'} block loading={busy === tier} disabled={busy !== null && busy !== tier} onClick={() => void pay(tier)}>
              {!account.user ? 'Đăng ký để mua' : until ? 'Gia hạn' : `Mua ${entitlement?.label ?? tier}`}
            </Button>
            {until && <div className="pf-cmp-until">Đang dùng đến {until}</div>}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={order ? 'min(760px, calc(100vw - 16px))' : 'min(860px, calc(100vw - 16px))'} destroyOnHidden title={null}>
      {order ? (
        <PaymentStep
          order={order.checkout}
          planLabel={`${(order.tier === 'pro' ? pro : standard)?.label ?? order.tier} · ${PERIOD_LABEL[order.period]}`}
          onBack={() => setOrder(null)}
          onPaid={() => void account.refresh()}
          onClose={onClose}
        />
      ) : (
        <>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            <CrownFilled style={{ color: '#d4a017' }} /> Chọn gói PaperFinder
          </Typography.Title>
          {reason && <Alert type="info" showIcon title={reason} style={{ marginBottom: 12 }} />}

          {billingEnabled && (
            <div className="pf-cmp-period">
              <Typography.Text type="secondary">Thời hạn:</Typography.Text>
              <Segmented<PlanPeriod>
                value={period}
                onChange={setPeriod}
                options={(['week', 'month', 'year'] as const).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
                disabled={busy !== null}
              />
            </div>
          )}

          {standard && pro && (
            <div className="pf-cmp" role="table" aria-label="So sánh hạng Tiêu chuẩn và Pro">
              <div className="pf-cmp-corner" role="columnheader" />
              <div role="columnheader">{header('standard')}</div>
              <div role="columnheader">{header('pro')}</div>
              {rows.map((row) => {
                const differs = row.standard !== row.pro;
                return (
                  <div className="pf-cmp-row" role="row" key={row.label}>
                    <div className="pf-cmp-label" role="rowheader">
                      {row.label}
                    </div>
                    <div className="pf-cmp-cell" role="cell">
                      <CellView value={row.standard} />
                    </div>
                    <div className={`pf-cmp-cell${differs ? ' is-better' : ''}`} role="cell">
                      <CellView value={row.pro} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && <Alert type="error" showIcon title={error} style={{ marginTop: 12 }} />}

          {billingEnabled ? (
            <Typography.Paragraph type="secondary" style={{ margin: '14px 0 0', fontSize: 12.5 }}>
              “Rẻ hơn” là so với giá mỗi ngày khi mua theo tuần. Thanh toán bằng chuyển khoản ngân hàng quét mã QR, tự kích hoạt sau khi nhận tiền (thường dưới 1 phút), không tự động gia hạn. Mua thêm cùng hạng thì cộng dồn. Mua Pro khi đang có Tiêu chuẩn: Pro dùng ngay, phần Tiêu chuẩn còn lại được giữ và dùng tiếp sau khi Pro hết. Cần hỗ trợ, liên hệ{' '}
              <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer">
                {AUTHOR.name}
              </a>
              .
            </Typography.Paragraph>
          ) : (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
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
        </>
      )}
    </Modal>
  );
}
