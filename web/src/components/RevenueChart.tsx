import type { RevenueDay } from '../../../shared/types';

const W = 900;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 46 };

const fmt = new Intl.NumberFormat('vi-VN');

/** Nhãn trục gọn: 1.500.000 -> 1,5tr; 45.000 -> 45k. */
export function compactMoney(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}tr`.replace('.', ',');
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`.replace('.', ',');
  return String(value);
}

/** Biểu đồ cột doanh thu theo ngày, vẽ bằng SVG thuần (giống UsageChart) để không thêm thư viện. */
export function RevenueChart({ days }: { days: RevenueDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.revenueVnd));
  const top = Math.ceil(max / 4 / 1000) * 4000 || 4000; // trục chia 4 khoảng đều, làm tròn đến nghìn đồng
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(days.length, 1);
  const barW = Math.max(3, Math.min(22, slot * 0.6));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const labelEvery = Math.ceil(days.length / 10);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Biểu đồ doanh thu theo ngày" style={{ display: 'block' }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (top / 4) * i;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="#e3e7ed" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7785">
                {compactMoney(v)}
              </text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={d.date}>
              <title>{`${d.date}\nDoanh thu: ${fmt.format(d.revenueVnd)}đ\nĐơn: ${d.orders}`}</title>
              <rect x={cx - barW / 2} y={y(d.revenueVnd)} width={barW} height={PAD.top + innerH - y(d.revenueVnd)} fill="#2f8f4e" rx="2" />
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7785">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
