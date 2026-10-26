import { ArrowRightOutlined, GithubOutlined, LinkedinOutlined, MailOutlined, TwitterOutlined, YoutubeOutlined } from '@ant-design/icons';
import { Col, Layout, Row } from 'antd';
import { useState, type ReactNode } from 'react';
import { AUTHOR, DATA_SOURCE_LINKS, FOOTER, OTHER_APPS } from '../lib/author';
import { InfoModal, type InfoKind } from './InfoModals';

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

interface Social {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
}

/** Chỉ hiện icon có liên kết thật (xem AUTHOR.socials trong lib/author.ts). */
function socialLinks(): Social[] {
  const s = AUTHOR.socials;
  const all: Social[] = [
    { key: 'github', label: 'GitHub', href: AUTHOR.github, icon: <GithubOutlined /> },
    { key: 'youtube', label: 'YouTube', href: s.youtube, icon: <YoutubeOutlined /> },
    { key: 'linkedin', label: 'LinkedIn', href: s.linkedin, icon: <LinkedinOutlined /> },
    { key: 'x', label: 'X', href: s.x, icon: <TwitterOutlined /> },
    { key: 'email', label: 'Email', href: s.email, icon: <MailOutlined /> },
  ];
  return all.filter((x) => x.href);
}

/** Chân trang nền navy: thương hiệu, nguồn dữ liệu, liên kết nhanh, theo dõi tác giả. */
export function AppFooter() {
  const [info, setInfo] = useState<InfoKind | null>(null);
  const quick: { label: string; onClick?: () => void; href?: string }[] = [
    { label: 'Hướng dẫn sử dụng', onClick: () => setInfo('guide') },
    { label: 'Câu hỏi thường gặp', onClick: () => setInfo('faq') },
    { label: 'Liên hệ', href: AUTHOR.github },
    { label: 'Chính sách bảo mật', onClick: () => setInfo('privacy') },
  ];

  return (
    <Layout.Footer className="pf-footer">
      <div className="pf-footer-inner">
        <Row gutter={[32, 28]}>
          <Col xs={24} md={9}>
            <div className="pf-footer-brand">
              <img className="pf-logo pf-logo-sm" src="/logo.png" alt="" width={44} height={44} draggable={false} />
              <div>
                <div className="pf-footer-name">PaperFinder</div>
                <div className="pf-footer-tagline">{FOOTER.tagline}</div>
              </div>
            </div>
            <p className="pf-footer-desc">{FOOTER.description}</p>
            <div className="pf-footer-social">
              {socialLinks().map((s) => (
                <a key={s.key} href={s.href} aria-label={s.label} title={s.label} {...external}>
                  {s.icon}
                </a>
              ))}
            </div>
          </Col>

          <Col xs={12} md={5}>
            <h3 className="pf-footer-title">Nguồn dữ liệu</h3>
            <ul className="pf-footer-list">
              {DATA_SOURCE_LINKS.map((s) => (
                <li key={s.name}>
                  <a className="pf-flink" href={s.url} {...external}>
                    <span className="pf-tile" style={{ background: s.color }} aria-hidden="true">
                      {s.letter}
                    </span>
                    {s.name}
                  </a>
                </li>
              ))}
            </ul>
          </Col>

          <Col xs={12} md={5}>
            <h3 className="pf-footer-title">Liên kết nhanh</h3>
            <ul className="pf-footer-list">
              {quick.map((q) => (
                <li key={q.label}>
                  {q.href ? (
                    <a className="pf-flink" href={q.href} {...external}>
                      <ArrowRightOutlined /> {q.label}
                    </a>
                  ) : (
                    <button type="button" className="pf-flink" onClick={q.onClick}>
                      <ArrowRightOutlined /> {q.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Col>

          <Col xs={24} md={5}>
            <h3 className="pf-footer-title">Theo dõi chúng tôi</h3>
            <p className="pf-footer-note">Cập nhật tính năng mới và các dự án khác của tác giả.</p>
            <a className="pf-follow" href={AUTHOR.github} {...external}>
              <span>
                <GithubOutlined /> Theo dõi trên GitHub
              </span>
              <span className="pf-follow-go">
                <ArrowRightOutlined />
              </span>
            </a>
            <p className="pf-footer-products">
              Sản phẩm khác:{' '}
              {OTHER_APPS.map((app, i) => (
                <span key={app.key}>
                  {i > 0 && ' · '}
                  <a href={app.url} {...external}>
                    {app.name}
                  </a>
                </span>
              ))}
            </p>
          </Col>
        </Row>

        <div className="pf-footer-bottom">
          <span>
            © {new Date().getFullYear()} PaperFinder. Phát triển bởi{' '}
            <a href={AUTHOR.github} {...external}>
              {AUTHOR.name}
            </a>
          </span>
          <span className="pf-footer-slogan" aria-hidden="true">
            {FOOTER.slogan[0]} <ArrowRightOutlined /> {FOOTER.slogan[1]}
          </span>
        </div>
      </div>
      <InfoModal kind={info} onClose={() => setInfo(null)} />
    </Layout.Footer>
  );
}
