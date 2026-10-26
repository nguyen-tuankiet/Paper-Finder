import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';

interface Props {
  title?: ReactNode;
  /** Ghi chú ngắn bên phải tiêu đề. */
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-live'?: 'polite' | 'assertive' | 'off';
  /** Bỏ đệm của phần thân (dùng khi bên trong là lưới/bảng tự có đệm). */
  flush?: boolean;
}

/** Khung nội dung chung của ứng dụng: Card của Ant Design với kiểu thống nhất. */
export function Panel({ title, extra, children, className, flush, ...aria }: Props) {
  return (
    <Card
      className={`pf-card${className ? ` ${className}` : ''}`}
      variant="borderless"
      title={title}
      extra={extra ? <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>{extra}</Typography.Text> : undefined}
      styles={flush ? { body: { padding: 0 } } : undefined}
      {...aria}
    >
      {children}
    </Card>
  );
}
