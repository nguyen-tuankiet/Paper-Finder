import { CrownFilled, ThunderboltOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useAccount } from '../lib/accountContext';

/** Dải thông tin ngay trên ô tìm kiếm: số lượt còn lại hôm nay hoặc trạng thái Pro. Không hiện khi tính năng tài khoản tắt. */
export function QuotaBar() {
  const account = useAccount();
  if (!account.enabled || !account.ready) return null;
  const { quota, user } = account;

  if (account.isPro) {
    const until = user?.proUntil ? new Date(user.proUntil).toLocaleDateString('vi-VN') : '';
    return (
      <div className="pf-quota pf-quota-pro" role="status">
        <CrownFilled /> <span>Gói Pro — tìm kiếm không giới hạn{until ? `, còn hiệu lực đến ${until}` : ''}</span>
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
        {user ? 'Gói miễn phí' : 'Khách'}: còn <b>{remaining}</b>/{quota.limit} lượt tìm hôm nay
      </span>
      <span className="pf-quota-actions">
        {!user && (
          <Button type="link" size="small" onClick={() => account.openAuth('register')}>
            Đăng nhập để có thêm lượt
          </Button>
        )}
        <Button type="link" size="small" onClick={() => account.openUpgrade()}>
          Nâng cấp Pro
        </Button>
      </span>
    </div>
  );
}
