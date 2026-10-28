import { createContext, useContext } from 'react';
import type { AccountUser, PlansResponse, QuotaInfo } from '../../../shared/types';
import type { AuthTab } from '../components/AuthModal';

export interface AccountApi {
  /** Đã tải xong trạng thái từ máy chủ lần đầu. */
  ready: boolean;
  /** Máy chủ có bật tài khoản không. Tắt = ẩn mọi thứ liên quan (đăng nhập, Pro, hạn mức). */
  enabled: boolean;
  user: AccountUser | null;
  isPro: boolean;
  quota: QuotaInfo;
  plans: PlansResponse | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  openAuth: (tab?: AuthTab) => void;
  /** Mở hộp thoại nâng cấp; `reason` là dòng giải thích vì sao (vd. hết lượt, tính năng Pro). */
  openUpgrade: (reason?: string) => void;
}

export const AccountContext = createContext<AccountApi | null>(null);

export function useAccount(): AccountApi {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount phải nằm trong <AccountProvider>.');
  return value;
}

