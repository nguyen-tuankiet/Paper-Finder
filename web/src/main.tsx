import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import HistoryPage from './HistoryPage';
import LibraryPage from './LibraryPage';
import { AccountProvider } from './lib/account';
import './styles.css';

// Ít trang nên không cần thư viện router: /admin (quản trị), /thu-vien (thư viện cá nhân), /lich-su (lịch sử tìm kiếm); còn lại là trang tìm kiếm.
const path = window.location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';
const AccountPage = path === '/thu-vien' ? LibraryPage : path === '/lich-su' ? HistoryPage : App;

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
          Layout: { bodyBg: '#f3f5f9', footerBg: '#11335a', footerPadding: '36px 16px 20px' },
          Card: { headerFontSize: 15 },
        },
      }}
    >
      {isAdmin ? (
        <AdminPage />
      ) : (
        <AccountProvider>
          <AccountPage />
        </AccountProvider>
      )}
    </ConfigProvider>
  </StrictMode>,
);
