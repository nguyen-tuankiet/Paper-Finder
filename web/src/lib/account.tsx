import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AccountUser, Entitlements, PaidTier, PlansResponse, QuotaInfo, Tier } from '../../../shared/types';
import { AuthModal, type AuthTab } from '../components/AuthModal';
import { UpgradeModal } from '../components/UpgradeModal';
import { AccountContext, UNRESTRICTED, type AccountApi } from './accountContext';
import { fetchMe, fetchPlans, loginAccount, logoutAccount, registerAccount, resetPasswordWithToken } from './api';

const UNLIMITED: QuotaInfo = { limit: null, used: 0, remaining: null, resetsAt: null };

/** Giữ trạng thái đăng nhập/hạn mức, chứa hộp thoại đăng nhập và nâng cấp. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(false);
  // Liên kết trong email có dạng /?reset=<token>: lấy token rồi xóa khỏi thanh địa chỉ ngay (không để lộ trong lịch sử trình duyệt hay khi chia sẻ).
  const [resetToken, setResetToken] = useState<string | null>(() => {
    try {
      const token = new URLSearchParams(window.location.search).get('reset');
      if (token) window.history.replaceState(null, '', window.location.pathname);
      return token;
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState<AccountUser | null>(null);
  const [tier, setTier] = useState<Tier>('guest');
  const [entitlements, setEntitlements] = useState<Entitlements>(UNRESTRICTED);
  const [quota, setQuota] = useState<QuotaInfo>(UNLIMITED);
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [auth, setAuth] = useState<{ open: boolean; tab: AuthTab }>({ open: false, tab: 'login' });
  const [upgrade, setUpgrade] = useState<{ open: boolean; reason?: string; tier?: PaidTier }>({ open: false });

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setEnabled(me.accountsEnabled);
      setPasswordResetEnabled(me.passwordResetEnabled);
      setUser(me.user);
      setTier(me.tier);
      setEntitlements(me.entitlements);
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

  // Mở liên kết đặt lại mật khẩu: hiện luôn hộp thoại nhập mật khẩu mới.
  const [resetShown, setResetShown] = useState(false);
  useEffect(() => {
    if (ready && enabled && resetToken && !resetShown) {
      setResetShown(true);
      setAuth({ open: true, tab: 'reset' });
    }
  }, [ready, enabled, resetToken, resetShown]);

  const resetPassword = useCallback(
    async (password: string) => {
      if (!resetToken) throw new Error('Liên kết đặt lại mật khẩu không hợp lệ. Hãy yêu cầu liên kết mới.');
      await resetPasswordWithToken(resetToken, password);
      setResetToken(null);
      await refresh();
    },
    [resetToken, refresh],
  );

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
      passwordResetEnabled,
      user,
      tier,
      entitlements,
      quota,
      plans,
      refresh,
      login,
      register,
      resetPassword,
      logout,
      openAuth: (tab = 'login') => setAuth({ open: true, tab }),
      openUpgrade: (reason, wanted) => setUpgrade({ open: true, reason, tier: wanted }),
    }),
    [ready, enabled, passwordResetEnabled, user, tier, entitlements, quota, plans, refresh, login, register, resetPassword, logout],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
      {enabled && (
        <>
          <AuthModal open={auth.open} tab={auth.tab} onTabChange={(tab) => setAuth({ open: true, tab })} onClose={() => setAuth((s) => ({ ...s, open: false }))} />
          <UpgradeModal open={upgrade.open} reason={upgrade.reason} initialTier={upgrade.tier} onClose={() => setUpgrade((s) => ({ ...s, open: false }))} onNeedLogin={() => setAuth({ open: true, tab: 'register' })} />
        </>
      )}
    </AccountContext.Provider>
  );
}
