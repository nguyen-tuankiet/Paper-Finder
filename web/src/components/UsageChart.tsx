import type { UsageDay } from '../../../shared/types';

const W = 900;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 34 };

/** Biểu đồ cột đôi (người dùng, lượt tìm) theo ngày, vẽ bằng SVG thuần để không thêm thư viện. */
export function UsageChart({ days }: { days: UsageDay[] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.visitors, d.searches]));
  const top = Math.ceil(max / 4) * 4 || 4; // trục chia 4 khoảng đều
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(days.length, 1);
  const barW = Math.max(2, Math.min(18, slot / 2.6));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(days.length / 10);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Biểu đồ người dùng và lượt tìm theo ngày" style={{ display: 'block' }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (top / 4) * i;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#e3e7ed" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7785">
                {v}
              </text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={d.date}>
              <title>{`${d.date}\nNgười dùng: ${d.visitors}\nLượt tìm: ${d.searches}`}</title>
              <rect x={cx - barW - 1} y={y(d.visitors)} width={barW} height={PAD.top + innerH - y(d.visitors)} fill="#8fb4d6" rx="2" />
              <rect x={cx + 1} y={y(d.searches)} width={barW} height={PAD.top + innerH - y(d.searches)} fill="#1f4e79" rx="2" />
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7785">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: '#6b7785', marginTop: 4 }}>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#8fb4d6', borderRadius: 2, marginRight: 6 }} />
          Người dùng
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#1f4e79', borderRadius: 2, marginRight: 6 }} />
          Lượt tìm kiếm
        </span>
      </div>
    </div>
  );
}
