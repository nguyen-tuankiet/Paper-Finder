import { BookOutlined, DownloadOutlined, SafetyCertificateOutlined, UnlockOutlined } from '@ant-design/icons';
import { Badge, Space, Tag, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { SourcesHealthState } from '../lib/hooks';
import { HeroIllustration } from './HeroIllustration';
import { PageHeader } from './PageHeader';

type Tone = 'success' | 'error' | 'processing';

function SourceTag({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  const tag = (
    <Tag variant="filled" className="pf-pill">
      <Badge status={tone} />
      <span>{children}</span>
    </Tag>
  );
  return title ? <Tooltip title={title}>{tag}</Tooltip> : tag;
}

const FEATURES = [
  { icon: <SafetyCertificateOutlined />, text: 'Tự loại bài trùng' },
  { icon: <UnlockOutlined />, text: 'Lọc bản đọc miễn phí, tải PDF' },
  { icon: <DownloadOutlined />, text: 'Xuất Excel / CSV' },
  { icon: <BookOutlined />, text: 'Trích dẫn IEEE · APA 7 · tự soạn' },
];

export function Header({ health, online }: { health: SourcesHealthState; online: boolean }) {
  const status = (
    <div className="pf-status" aria-label="Trạng thái kết nối nguồn dữ liệu">
      {!online ? (
        <SourceTag tone="error">Mất kết nối mạng</SourceTag>
      ) : health.status === 'unreachable' ? (
        <SourceTag tone="error" title="Không gọi được backend PaperFinder. Hãy chạy backend (npm run dev) hoặc kiểm tra VITE_API_BASE_URL.">
          Không kết nối được máy chủ
        </SourceTag>
      ) : health.status === 'loading' ? (
        <SourceTag tone="processing">Đang kiểm tra nguồn dữ liệu...</SourceTag>
      ) : (
        health.sources.map((source) => (
          <SourceTag key={source.source} tone={source.ok ? 'success' : 'error'} title={source.ok ? `Phản hồi trong ${source.latencyMs ?? '?'} ms` : source.message}>
            {source.label}
          </SourceTag>
        ))
      )}
    </div>
  );

  const hero = (
    <div className="pf-hero-grid">
      <div className="pf-hero-copy">
        <Typography.Title level={1} className="pf-hero-title">
          <span className="pf-nowrap-lg">Tìm bài báo khoa học từ nhiều nguồn,</span> <span className="pf-nowrap-lg">trong <span className="pf-hero-accent">một nơi</span></span>
        </Typography.Title>
        <Typography.Paragraph className="pf-hero-sub">
          Tra cứu đồng thời các nguồn học thuật mở, gom kết quả, lọc theo năm và quyền truy cập, rồi xuất danh sách hoặc sao chép tài liệu tham khảo.
        </Typography.Paragraph>
        <Space size={[8, 8]} wrap className="pf-hero-chips">
          {FEATURES.map((f) => (
            <Tag key={f.text} variant="filled" icon={f.icon} className="pf-feature">
              {f.text}
            </Tag>
          ))}
        </Space>
      </div>
      <HeroIllustration />
    </div>
  );

  return <PageHeader subtitle="Tìm kiếm và quản lý tài liệu khoa học" right={status} hero={hero} />;
}
