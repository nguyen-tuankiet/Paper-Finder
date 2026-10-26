/**
 * Hình minh họa line-art (chồng sách + tờ báo + kính lúp) cho phần hero. Chỉ là trang trí nên ẩn khỏi trình đọc màn hình.
 * Màu lấy từ `currentColor` (đặt trong CSS), chuyển động nhẹ do CSS điều khiển và tắt khi người dùng chọn giảm chuyển động.
 */
export function HeroIllustration() {
  return (
    <svg className="pf-hero-art" viewBox="0 0 380 220" role="presentation" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {/* chồng sách */}
        <g className="pf-float">
          <g transform="rotate(-1.5 130 168)">
            <rect x="34" y="150" width="212" height="38" rx="5" />
            <path d="M54 150v38M64 150v38M232 156v26M226 156v26M220 156v26" />
            <path d="M34 160h14M34 178h14" />
          </g>
          <g transform="rotate(-4 150 128)">
            <rect x="52" y="112" width="188" height="34" rx="5" />
            <path d="M72 112v34M82 112v34M226 118v22M220 118v22" />
          </g>
          <g transform="rotate(3 150 94)">
            <rect x="44" y="76" width="198" height="32" rx="5" />
            <path d="M64 76v32M74 76v32M228 82v20M222 82v20M216 82v20" />
            <path d="M120 88h56M120 96h38" />
          </g>
          {/* nét phác */}
          <path d="M40 196c40 6 140 6 214 0" strokeDasharray="2 6" opacity="0.5" />
        </g>

        {/* tờ báo + kính lúp */}
        <g className="pf-float pf-float-slow">
          <g transform="rotate(7 282 130)">
            <rect x="252" y="92" width="64" height="86" rx="5" />
            <path d="M264 110h40M264 120h40M264 130h28M264 146h40M264 156h34" opacity="0.8" />
          </g>
          <circle cx="306" cy="84" r="17" stroke="#8fdcff" />
          <path d="M318 97l14 14" stroke="#8fdcff" strokeWidth="3" />
        </g>

        {/* dòng chữ trang trí */}
        <g className="pf-script" stroke="none" fill="#bfe6ff">
          <text x="226" y="40" transform="rotate(-8 226 40)">Better papers,</text>
          <text x="244" y="66" transform="rotate(-8 244 66)">Bigger ideas</text>
        </g>
        <path d="M338 40l8-4M340 52l10-2M336 28l6-6" stroke="#bfe6ff" opacity="0.7" />
      </g>
    </svg>
  );
}
