import { FileTextOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  subtitle: string;
  /** Phần bên phải thanh đầu trang (trạng thái nguồn, liên kết...). */
  right?: ReactNode;
  /** Khối giới thiệu lớn dưới thanh đầu trang (chỉ trang chính). */
  hero?: ReactNode;
}

/** Thanh đầu trang dùng chung cho trang tìm kiếm và trang quản trị. */
export function PageHeader({ subtitle, right, hero }: Props) {
  return (
    <header className={hero ? 'pf-header pf-header-hero' : 'pf-header'}>
      <div className="pf-header-inner pf-header-row">
        <a className="pf-brand" href="/" aria-label="PaperFinder - về trang chủ">
          <span className="pf-logo" aria-hidden="true">
            <FileTextOutlined style={{ fontSize: 20, color: '#fff' }} />
          </span>
          <span>
            <Typography.Title level={3} className="pf-brand-title">
              PaperFinder
            </Typography.Title>
            <span className="pf-brand-sub">{subtitle}</span>
          </span>
        </a>
        {right}
      </div>
      {hero && <div className="pf-header-inner pf-hero">{hero}</div>}
    </header>
  );
}
