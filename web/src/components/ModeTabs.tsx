import { LockOutlined, ProfileOutlined, SearchOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import type { ReactNode } from 'react';
import { useAccount } from '../lib/accountContext';

export type SearchMode = 'search' | 'doi';

/**
 * Hai nút chuyển chế độ đặt ngay trên khung tìm kiếm. Tab đang chọn tô đặc (xanh navy); tab còn lại có viền,
 * nổi lên và đổi màu khi rê chuột để nhìn là biết bấm được.
 */
export function ModeTabs({ value, onChange }: { value: SearchMode; onChange: (mode: SearchMode) => void }) {
  const account = useAccount();
  const locked = account.enabled && account.entitlements.doiLookupMax === 0;

  const tab = (mode: SearchMode, icon: ReactNode, label: string, shortLabel: string, badge?: ReactNode) => {
    const active = value === mode;
    return (
      <button type="button" role="tab" aria-selected={active} className={`pf-mode-tab${active ? ' is-active' : ''}`} onClick={() => onChange(mode)}>
        <span className="pf-mode-icon">{icon}</span>
        <span className="pf-mode-text pf-mode-long">{label}</span>
        <span className="pf-mode-text pf-mode-short">{shortLabel}</span>
        {badge}
      </button>
    );
  };

  return (
    <div className="pf-mode" role="tablist" aria-label="Cách bắt đầu">
      {tab('search', <SearchOutlined />, 'Tìm theo từ khóa', 'Từ khóa')}
      {tab(
        'doi',
        <ProfileOutlined />,
        'Dán danh sách DOI',
        'Dán DOI',
        locked ? (
          <Tag color="gold" icon={<LockOutlined />} className="pf-mode-tag">
            <span className="pf-mode-tag-text">Tiêu chuẩn</span>
          </Tag>
        ) : (
          <Tag color="blue" className="pf-mode-tag">
            Mới
          </Tag>
        ),
      )}
    </div>
  );
}
