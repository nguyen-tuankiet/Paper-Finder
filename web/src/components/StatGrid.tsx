import type { ReactNode } from 'react';

export interface StatItem {
  key: string;
  label: string;
  value: string | number;
  icon?: ReactNode;
  /** Màu nhấn: mặc định là màu chủ đạo. */
  tone?: 'primary' | 'success' | 'warning';
  /** Phần phụ cạnh số liệu (vd. nút hành động ngắn). */
  extra?: ReactNode;
}

/**
 * Lưới số liệu: các ô cùng kích thước, nhãn một dòng và số liệu luôn nằm cùng một hàng ngang.
 * Số cột được CSS chọn theo số ô và bề rộng màn hình (xem `.pf-stats` trong styles.css) để không bị lẻ dòng.
 */
export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="pf-stats" data-n={items.length}>
      {items.map((item) => (
        <div key={item.key} className={`pf-stat-tile pf-stat-${item.tone ?? 'primary'}`}>
          <div className="pf-stat-label" title={item.label}>
            {item.label}
          </div>
          <div className="pf-stat-value">
            {item.icon && (
              <span className="pf-stat-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="pf-stat-num">{item.value}</span>
            {item.extra}
          </div>
        </div>
      ))}
    </div>
  );
}
