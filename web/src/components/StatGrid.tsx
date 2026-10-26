import { Col, Row, Statistic } from 'antd';
import type { ReactNode } from 'react';

export interface StatItem {
  key: string;
  label: string;
  value: string | number;
  icon?: ReactNode;
  /** Màu nhấn: mặc định là màu chủ đạo. */
  tone?: 'primary' | 'success' | 'warning';
  /** Phần phụ dưới số liệu (vd. nút hành động). */
  extra?: ReactNode;
}

const TONE_COLOR: Record<NonNullable<StatItem['tone']>, string> = {
  primary: '#1f4e79',
  success: '#2f8f4e',
  warning: '#b7791f',
};

/** Lưới số liệu bằng Statistic của Ant Design, tự xuống dòng theo bề rộng màn hình. */
export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <Row gutter={[16, 16]}>
      {items.map((item) => (
        <Col key={item.key} flex="1 1 150px">
          <div className="pf-stat-tile">
            <Statistic
              title={item.label}
              value={item.value}
              prefix={item.icon}
              styles={{ content: { color: TONE_COLOR[item.tone ?? 'primary'], fontSize: 26, fontWeight: 600 } }}
            />
            {item.extra}
          </div>
        </Col>
      ))}
    </Row>
  );
}
