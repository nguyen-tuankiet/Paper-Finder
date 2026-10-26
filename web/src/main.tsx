import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import './styles.css';

// Chỉ có hai trang nên không cần thư viện router: /admin là trang quản trị, còn lại là trang tìm kiếm.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={viVN}
      theme={{
        token: {
          colorPrimary: '#1f4e79',
          borderRadius: 6,
          colorBgLayout: '#f3f5f9',
          fontFamily: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
        },
        components: {
          Table: { headerBg: '#f3f5f8' },
          Layout: { bodyBg: '#f3f5f9', footerBg: '#ffffff', footerPadding: '28px 16px 18px' },
          Card: { headerFontSize: 15 },
        },
      }}
    >
      {isAdmin ? <AdminPage /> : <App />}
    </ConfigProvider>
  </StrictMode>,
);
