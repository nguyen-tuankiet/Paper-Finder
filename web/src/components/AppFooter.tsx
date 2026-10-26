import { FileTextOutlined, GithubOutlined } from '@ant-design/icons';
import { Col, Divider, Flex, Layout, Row, Typography } from 'antd';
import { AUTHOR, DATA_SOURCE_LINKS } from '../lib/author';

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Chân trang: giới thiệu, nguồn dữ liệu, tác giả (liên kết GitHub). */
export function AppFooter() {
  return (
    <Layout.Footer className="pf-footer">
      <div className="pf-footer-inner">
        <Row gutter={[32, 24]}>
          <Col xs={24} md={10}>
            <Flex align="center" gap={10} style={{ marginBottom: 8 }}>
              <span className="pf-logo pf-logo-sm" aria-hidden="true">
                <FileTextOutlined style={{ color: '#fff' }} />
              </span>
              <Typography.Text strong style={{ fontSize: 16 }}>
                PaperFinder
              </Typography.Text>
            </Flex>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Công cụ tìm kiếm và quản lý tài liệu khoa học dành cho sinh viên, giảng viên và người làm nghiên cứu. Dữ liệu là metadata công khai, không bao phủ toàn bộ tài liệu khoa học trên thế giới.
            </Typography.Paragraph>
          </Col>

          <Col xs={12} md={7}>
            <Typography.Text strong>Nguồn dữ liệu</Typography.Text>
            <ul className="pf-footer-list">
              {DATA_SOURCE_LINKS.map((s) => (
                <li key={s.name}>
                  <Typography.Link href={s.url} {...external}>
                    {s.name}
                  </Typography.Link>
                </li>
              ))}
            </ul>
          </Col>

          <Col xs={12} md={7}>
            <Typography.Text strong>Tác giả</Typography.Text>
            <ul className="pf-footer-list">
              <li>
                <Typography.Link href={AUTHOR.github} {...external}>
                  <GithubOutlined /> {AUTHOR.name}
                </Typography.Link>
              </li>
              <li>
                <Typography.Text type="secondary">Xem các dự án trên GitHub</Typography.Text>
              </li>
            </ul>
          </Col>
        </Row>

        <Divider style={{ margin: '20px 0 14px' }} />

        <Flex justify="space-between" align="center" wrap gap={8}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            © {new Date().getFullYear()} PaperFinder · Phát triển bởi{' '}
            <Typography.Link href={AUTHOR.github} {...external}>
              {AUTHOR.name}
            </Typography.Link>
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Hãy đối chiếu thông tin với bài gốc trước khi sử dụng trong nghiên cứu.
          </Typography.Text>
        </Flex>
      </div>
    </Layout.Footer>
  );
}
