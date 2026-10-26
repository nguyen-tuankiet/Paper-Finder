import { ArrowRightOutlined } from '@ant-design/icons';
import { Modal, Typography } from 'antd';
import { useEffect, useState, type CSSProperties } from 'react';
import { OTHER_APPS, type OtherApp } from '../lib/author';

/** Chờ trang ổn định rồi mới hiện popup (800–1200 ms để không bật ra đột ngột). */
const SHOW_DELAY_MS = 1000;
/** Sau khi người dùng đóng, bao lâu thì hiện lại. null = không hiện lại trong cùng phiên làm việc. */
const RESHOW_AFTER_MS: number | null = null;
const STORAGE_KEY = 'pf.productPopup.closedAt';

const ACCENT: Record<OtherApp['key'], string> = { cocoflow: '#1fa3b8', muse: '#2563eb' };

/** Dự phòng khi sessionStorage không dùng được: vẫn không hiện lại khi component mount lại. */
let closedInMemory: number | null = null;

function wasClosedRecently(): boolean {
  let closedAt = closedInMemory;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) closedAt = Math.max(closedAt ?? 0, Number(raw) || 0);
  } catch {
    /* sessionStorage bị chặn: dùng biến trong bộ nhớ */
  }
  if (closedAt === null) return false;
  return RESHOW_AFTER_MS === null || Date.now() - closedAt < RESHOW_AFTER_MS;
}

function markClosed() {
  closedInMemory = Date.now();
  try {
    sessionStorage.setItem(STORAGE_KEY, String(closedInMemory));
  } catch {
    /* không lưu được thì chỉ nhớ trong bộ nhớ */
  }
}

/** Logo lấy từ favicon của từng trang (Cocoflow: web/public/apps/cocoflow.png; Muse Studio: vẽ lại từ favicon SVG của trang). */
function Logo({ appKey }: { appKey: OtherApp['key'] }) {
  if (appKey === 'cocoflow') return <img className="pf-promo-logo" src="/apps/cocoflow.png" alt="" width={48} height={48} draggable={false} />;
  return (
    <svg className="pf-promo-logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#2563eb" />
      <path d="M9 22V10l7 8 7-8v12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Popup giới thiệu các sản phẩm khác của tác giả. Hiện một lần sau SHOW_DELAY_MS khi vào trang;
 * đóng bằng nút ×, phím Esc hoặc bấm nền. Không tự mở tab nào: chỉ mở khi người dùng bấm vào sản phẩm.
 */
export function ProductPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (wasClosedRecently()) return;
    const timer = window.setTimeout(() => {
      if (!wasClosedRecently()) setOpen(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const close = () => {
    markClosed();
    setOpen(false);
  };

  return (
    <Modal open={open} onCancel={close} footer={null} centered width={620} rootClassName="pf-promo" destroyOnHidden aria-label="Khám phá hệ sinh thái của chúng tôi">
      <Typography.Title level={3} className="pf-promo-title">
        Khám phá hệ sinh thái của chúng tôi
      </Typography.Title>
      <p className="pf-promo-lead">Ngoài PaperFinder, hãy khám phá thêm các công cụ hỗ trợ công việc và sáng tạo nội dung.</p>
      <div className="pf-promo-grid">
        {OTHER_APPS.map((app) => (
          <a key={app.key} className="pf-promo-card" href={app.url} target="_blank" rel="noopener noreferrer" style={{ '--accent': ACCENT[app.key] } as CSSProperties}>
            <Logo appKey={app.key} />
            <span className="pf-promo-name">{app.name}</span>
            <span className="pf-promo-desc">{app.description}</span>
            <span className="pf-promo-cta">
              Khám phá {app.name} <ArrowRightOutlined />
            </span>
          </a>
        ))}
      </div>
    </Modal>
  );
}
