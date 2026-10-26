import { ArrowRightOutlined, CloseOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { AUTHOR, OTHER_APPS, type OtherApp } from '../lib/author';

const DISMISS_KEY = 'pf.floatingApps.dismissed';

const ACCENT: Record<OtherApp['key'], string> = { cocoflow: '#1fa3b8', muse: '#2563eb' };

/** Logo lấy từ favicon của từng trang (Cocoflow: web/public/apps/cocoflow.png; Muse Studio: vẽ lại từ favicon SVG của trang). */
function Logo({ appKey }: { appKey: OtherApp['key'] }) {
  if (appKey === 'cocoflow') return <img src="/apps/cocoflow.png" alt="" width={34} height={34} draggable={false} />;
  return (
    <svg viewBox="0 0 32 32" width={34} height={34} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#2563eb" />
      <path d="M9.5 21.5v-11l6.5 7.5 6.5-7.5v11" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Màn hình cảm ứng không có hover: chạm vào thẻ để xem giới thiệu thay vì mở thẳng liên kết. */
function useCanHover(): boolean {
  const [can, setCan] = useState(() => window.matchMedia('(hover: hover)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover)');
    const on = () => setCan(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return can;
}

/**
 * Hai thẻ treo lắc nhẹ ở góc trên bên phải, giới thiệu ứng dụng khác của tác giả.
 * Rê chuột (hoặc chạm trên điện thoại) để xem giới thiệu; có nút × để tắt, nhớ trong phiên làm việc.
 */
export function FloatingApps() {
  const [hidden, setHidden] = useState(readDismissed);
  const [active, setActive] = useState<OtherApp['key'] | null>(null);
  const canHover = useCanHover();

  if (hidden) return null;

  const close = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* không lưu được thì chỉ ẩn trong lần xem này */
    }
  };
  const current = OTHER_APPS.find((a) => a.key === active) ?? null;

  return (
    <aside className="pf-hang" aria-label={`Ứng dụng khác của ${AUTHOR.name}`} onMouseLeave={() => setActive(null)}>
      <div className="pf-hang-rail">
        <span className="pf-hang-nail" aria-hidden="true" />
        <span className="pf-hang-nail" aria-hidden="true" />
        <button type="button" className="pf-hang-close" onClick={close} aria-label="Tắt giới thiệu ứng dụng khác" title="Tắt">
          <CloseOutlined />
        </button>
      </div>

      <div className="pf-hang-items">
        {OTHER_APPS.map((app, i) => {
          const body = (
            <>
              <span className="pf-hang-string" aria-hidden="true" />
              <span className={`pf-hang-tag${active === app.key ? ' is-active' : ''}`} style={{ borderColor: ACCENT[app.key] }}>
                <Logo appKey={app.key} />
              </span>
            </>
          );
          // Trên cảm ứng, sự kiện chuột giả lập sẽ làm thẻ bật rồi tắt ngay, nên chỉ gắn hover khi thiết bị có hover.
          const common = {
            className: `pf-hang-swing pf-hang-swing-${i % 2}`,
            ...(canHover ? { onMouseEnter: () => setActive(app.key), onFocus: () => setActive(app.key) } : {}),
          };
          return canHover ? (
            <a key={app.key} href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`${app.name}: ${app.tagline}`} {...common}>
              {body}
            </a>
          ) : (
            <button key={app.key} type="button" aria-expanded={active === app.key} aria-label={`${app.name}: xem giới thiệu`} onClick={() => setActive(active === app.key ? null : app.key)} {...common}>
              {body}
            </button>
          );
        })}
      </div>

      {current && (
        <a className="pf-hang-info" href={current.url} target="_blank" rel="noopener noreferrer" style={{ borderTopColor: ACCENT[current.key] }}>
          <strong>{current.name}</strong>
          <span className="pf-hang-tagline" style={{ color: ACCENT[current.key] }}>
            {current.tagline}
          </span>
          {current.description && <span className="pf-hang-desc">{current.description}</span>}
          <span className="pf-hang-go">
            Mở {current.name} <ArrowRightOutlined />
          </span>
        </a>
      )}
    </aside>
  );
}
