import { message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccountUser, PlansResponse, QuotaInfo } from '../../../shared/types';
import { AuthModal, type AuthTab } from '../components/AuthModal';
import { UpgradeModal } from '../components/UpgradeModal';
import { AccountContext, type AccountApi } from './accountContext';
import { ApiError, confirmPayment, fetchMe, fetchPlans, loginAccount, logoutAccount, registerAccount } from './api';

const UNLIMITED: QuotaInfo = { limit: null, used: 0, remaining: null, resetsAt: null };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Giữ trạng thái đăng nhập/hạn mức, chứa hộp thoại đăng nhập và nâng cấp, và xử lý khi PayOS đưa người dùng quay lại. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [quota, setQuota] = useState<QuotaInfo>(UNLIMITED);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [auth, setAuth] = useState<{ open: boolean; tab: AuthTab }>({ open: false, tab: 'login' });
  const [upgrade, setUpgrade] = useState<{ open: boolean; reason?: string }>({ open: false });
  const [messageApi, messageHolder] = message.useMessage();
  const handledReturn = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setEnabled(me.accountsEnabled);
      setUser(me.user);
      setQuota(me.quota);
    } catch {
      /* mất mạng hoặc máy chủ lỗi: giữ trạng thái cũ, các phần khác của trang sẽ tự báo lỗi kết nối */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    fetchPlans()
      .then(setPlans)
      .catch(() => undefined);
  }, [refresh]);

  // PayOS đưa người dùng về /?billing=return&orderCode=... hoặc /?billing=cancel
  useEffect(() => {
    if (!ready || handledReturn.current) return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (!billing) return;
    handledReturn.current = true;
    const orderCode = Number(params.get('orderCode'));
    window.history.replaceState(null, '', window.location.pathname);

    if (billing === 'cancel') {
      void messageApi.info('Bạn đã hủy thanh toán. Chưa có khoản nào bị trừ.');
      return;
    }
    if (!enabled || !Number.isSafeInteger(orderCode) || orderCode <= 0) return;
    void (async () => {
      const hide = messageApi.loading('Đang xác nhận thanh toán...', 0);
      try {
        // Webhook của PayOS có thể tới chậm vài giây: hỏi lại vài lần trước khi bỏ cuộc.
        for (let attempt = 0; attempt < 6; attempt++) {
          const result = await confirmPayment(orderCode);
          if (result.status === 'paid') {
            hide();
            await refresh();
            void messageApi.success('Thanh toán thành công. Gói Pro đã được kích hoạt!');
            return;
          }
          if (result.status === 'cancelled' || result.status === 'unknown') break;
          await wait(3000);
        }
        hide();
        void messageApi.warning('Chưa nhận được xác nhận thanh toán. Nếu bạn đã chuyển khoản, Pro sẽ tự kích hoạt trong ít phút; hãy tải lại trang sau đó.', 8);
      } catch (error) {
        hide();
        if (error instanceof ApiError && error.status === 401) {
          setAuth({ open: true, tab: 'login' });
          void messageApi.warning('Hãy đăng nhập lại để hoàn tất kích hoạt gói Pro.', 6);
        } else {
          void messageApi.error('Không kiểm tra được trạng thái thanh toán. Vui lòng tải lại trang sau ít phút.', 6);
        }
      }
    })();
  }, [ready, enabled, refresh, messageApi]);

  const login = useCallback(
    async (email: string, password: string) => {
      await loginAccount(email, password);
      await refresh();
    },
    [refresh],
  );
  const register = useCallback(
    async (email: string, password: string) => {
      await registerAccount(email, password);
      await refresh();
    },
    [refresh],
  );
  const logout = useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo<AccountApi>(
    () => ({
      ready,
      enabled,
      user,
      isPro: Boolean(user?.isPro),
      quota,
      plans,
      refresh,
      login,
      register,
      logout,
      openAuth: (tab = 'login') => setAuth({ open: true, tab }),
      openUpgrade: (reason) => setUpgrade({ open: true, reason }),
    }),
    [ready, enabled, user, quota, plans, refresh, login, register, logout],
  );

  return (
    <AccountContext.Provider value={value}>
      {messageHolder}
      {children}
      {enabled && (
        <>
          <AuthModal open={auth.open} tab={auth.tab} onTabChange={(tab) => setAuth({ open: true, tab })} onClose={() => setAuth((s) => ({ ...s, open: false }))} />
          <UpgradeModal open={upgrade.open} reason={upgrade.reason} onClose={() => setUpgrade((s) => ({ ...s, open: false }))} onNeedLogin={() => setAuth({ open: true, tab: 'register' })} />
        </>
      )}
    </AccountContext.Provider>
  );
}
