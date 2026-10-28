import { CrownFilled, ThunderboltOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useAccount } from '../lib/accountContext';

/** Dải thông tin ngay trên ô tìm kiếm: hạng hiện tại và số lượt còn lại hôm nay. Không hiện khi tính năng tài khoản tắt. */
export function QuotaBar() {
  const account = useAccount();
  if (!account.enabled || !account.ready) return null;
  const { quota, user, tier, entitlements } = account;

  if (tier === 'standard' || tier === 'pro') {
    const until = user ? (tier === 'pro' ? user.proUntil : user.standardUntil) : null;
    return (
      <div className="pf-quota pf-quota-pro" role="status">
        <CrownFilled />
        <span>
          Hạng {entitlements.label} — tìm kiếm không giới hạn{until ? `, còn hiệu lực đến ${new Date(until).toLocaleDateString('vi-VN')}` : ''}
        </span>
        {tier === 'standard' && (
          <span className="pf-quota-actions">
            <Button type="link" size="small" onClick={() => account.openUpgrade('Pro có thêm BibTeX/RIS, thư viện lớn hơn và 500 kết quả mỗi nguồn.', 'pro')}>
              Lên Pro
            </Button>
          </span>
        )}
      </div>
    );
  }

  if (quota.limit === null) return null;
  const remaining = quota.remaining ?? 0;
  const low = remaining <= Math.max(1, Math.floor(quota.limit * 0.2));
  return (
    <div className={`pf-quota${low ? ' pf-quota-low' : ''}`} role="status">
      <ThunderboltOutlined />
      <span>
        {entitlements.label}: còn <b>{remaining}</b>/{quota.limit} lượt tìm hôm nay
      </span>
      <span className="pf-quota-actions">
        {!user && (
          <Button type="link" size="small" onClick={() => account.openAuth('register')}>
            Đăng nhập để có thêm tính năng
          </Button>
        )}
        <Button type="link" size="small" onClick={() => account.openUpgrade()}>
          Mua gói để hết giới hạn
        </Button>
      </span>
    </div>
  );
}
