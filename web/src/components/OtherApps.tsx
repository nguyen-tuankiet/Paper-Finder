import { ArrowRightOutlined, SwapOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { Avatar, Button, Card, Col, Flex, Row, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { AUTHOR, OTHER_APPS, type OtherApp } from '../lib/author';

const ICONS: Record<OtherApp['key'], ReactNode> = {
  cocoflow: <SwapOutlined />,
  muse: <VideoCameraOutlined />,
};
const COLORS: Record<OtherApp['key'], string> = { cocoflow: '#1f7a8c', muse: '#7a3e9d' };

/** Khu giới thiệu các ứng dụng khác của tác giả. Liên kết mở ở tab mới. */
export function OtherApps() {
  return (
    <section className="pf-apps" aria-label="Ứng dụng khác của tác giả">
      <div className="pf-apps-inner">
        <Flex justify="space-between" align="baseline" wrap gap={8} style={{ marginBottom: 14 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Ứng dụng khác của {AUTHOR.name}
          </Typography.Title>
          <Tag variant="filled">Giới thiệu</Tag>
        </Flex>
        <Row gutter={[16, 16]}>
          {OTHER_APPS.map((app) => (
            <Col key={app.key} xs={24} md={12}>
              <Card hoverable className="pf-app-card" variant="borderless" styles={{ body: { padding: 18 } }}>
                <Flex gap={16} align="flex-start">
                  <Avatar shape="square" size={52} icon={ICONS[app.key]} style={{ background: COLORS[app.key], flex: 'none' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      {app.name}
                    </Typography.Title>
                    <Typography.Text strong style={{ color: COLORS[app.key] }}>
                      {app.tagline}
                    </Typography.Text>
                    {app.description && (
                      <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }}>
                        {app.description}
                      </Typography.Paragraph>
                    )}
                    <Space size={[4, 4]} wrap style={{ margin: '10px 0 12px', display: 'flex' }}>
                      {app.tags.map((t) => (
                        <Tag key={t} variant="filled">
                          {t}
                        </Tag>
                      ))}
                    </Space>
                    <Button type="primary" ghost icon={<ArrowRightOutlined />} iconPlacement="end" href={app.url} target="_blank" rel="noopener noreferrer">
                      Mở {app.name}
                    </Button>
                  </div>
                </Flex>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    </section>
  );
}
