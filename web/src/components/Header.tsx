import { Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { SourcesHealthState } from '../lib/hooks';

function Pill({ tone, children, title }: { tone: 'ok' | 'err' | 'wait'; children: ReactNode; title?: string }) {
  const pill = (
    <span className="pf-pill">
      <span className={`pf-dot pf-dot-${tone}`} aria-hidden="true" />
      {children}
    </span>
  );
  return title ? <Tooltip title={title}>{pill}</Tooltip> : pill;
}

export function Header({ health, online }: { health: SourcesHealthState; online: boolean }) {
  return (
    <header className="pf-header">
      <div className="pf-header-inner">
        <div className="pf-brand">
          <span className="pf-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5h10l6 6v16H9z" />
              <path d="M19 5v6h6M13 17h8M13 22h8" />
            </svg>
          </span>
          <div>
            <Typography.Title level={3} className="pf-brand-title">
              PaperFinder
            </Typography.Title>
            <span className="pf-brand-sub">Tìm kiếm và quản lý tài liệu khoa học</span>
          </div>
        </div>
        <div className="pf-status" aria-label="Trạng thái kết nối nguồn dữ liệu">
          {!online ? (
            <Pill tone="err">Mất kết nối mạng</Pill>
          ) : health.status === 'unreachable' ? (
            <Pill tone="err" title="Không gọi được backend PaperFinder. Hãy chạy backend (npm run dev) hoặc kiểm tra VITE_API_BASE_URL.">
              Không kết nối được máy chủ
            </Pill>
          ) : health.status === 'loading' ? (
            <Pill tone="wait">Đang kiểm tra nguồn dữ liệu...</Pill>
          ) : (
            health.sources.map((source) => (
              <Pill key={source.source} tone={source.ok ? 'ok' : 'err'} title={source.ok ? `Phản hồi trong ${source.latencyMs ?? '?'} ms` : source.message}>
                {source.label}: {source.ok ? 'hoạt động' : 'lỗi'}
              </Pill>
            ))
          )}
        </div>
      </div>
    </header>
  );
}
