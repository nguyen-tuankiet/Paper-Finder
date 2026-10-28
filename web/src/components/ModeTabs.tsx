import { LockOutlined, ProfileOutlined, SearchOutlined } from '@ant-design/icons';
import { Segmented, Tag } from 'antd';
import { useAccount } from '../lib/accountContext';

export type SearchMode = 'search' | 'doi';

/** Thanh chuyển giữa "Tìm theo từ khóa" và "Dán danh sách DOI", đặt ngay trên khung tìm kiếm để ai vào trang cũng thấy cả hai cách dùng. */
export function ModeTabs({ value, onChange }: { value: SearchMode; onChange: (mode: SearchMode) => void }) {
  const account = useAccount();
  const locked = account.enabled && account.entitlements.doiLookupMax === 0;

  return (
    <Segmented<SearchMode>
      className="pf-mode"
      size="large"
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'search',
          label: (
            <span className="pf-mode-label">
              <SearchOutlined /> Tìm theo từ khóa
            </span>
          ),
        },
        {
          value: 'doi',
          label: (
            <span className="pf-mode-label">
              <ProfileOutlined /> Dán danh sách DOI
              {locked ? (
                <Tag color="gold" icon={<LockOutlined />} className="pf-mode-tag">
                  <span className="pf-mode-tag-text">Tiêu chuẩn</span>
                </Tag>
              ) : (
                <Tag color="blue" className="pf-mode-tag">
                  Mới
                </Tag>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}
