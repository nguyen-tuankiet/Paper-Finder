import { createContext, useContext } from 'react';
import type { AccountUser, Entitlements, PaidTier, PlansResponse, QuotaInfo, Tier } from '../../../shared/types';
import type { AuthTab } from '../components/AuthModal';

/** Khi chưa tải xong hoặc máy chủ tắt tài khoản: không khóa gì (không nháy khóa lúc mới vào trang). */
export const UNRESTRICTED: Entitlements = {
  tier: 'pro',
  label: 'Đầy đủ',
  dailySearches: null,
  maxResultsPerSource: 500,
  exportRows: null,
  referenceExport: true,
  wordExport: true,
  doiLookupMax: 500,
  citationTools: true,
  journalRank: true,
  libraryMax: 0,
  historyMax: 0,
};

export interface AccountApi {
  /** Đã tải xong trạng thái từ máy chủ lần đầu. */
  ready: boolean;
  /** Máy chủ có bật tài khoản không. Tắt = ẩn mọi thứ liên quan (đăng nhập, gói, hạn mức). */
  enabled: boolean;
  /** Máy chủ gửi được email đặt lại mật khẩu (hiện liên kết "Quên mật khẩu?"). */
  passwordResetEnabled: boolean;
  user: AccountUser | null;
  /** Hạng hiện tại: guest (chưa đăng nhập), free, standard, pro. */
  tier: Tier;
  /** Quyền lợi của hạng hiện tại (do máy chủ quyết định). */
  entitlements: Entitlements;
  quota: QuotaInfo;
  plans: PlansResponse | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  /** Đặt mật khẩu mới bằng liên kết trong email (token lấy từ địa chỉ trang); đặt xong là đăng nhập luôn. */
  resetPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  openAuth: (tab?: AuthTab) => void;
  /** Mở hộp thoại chọn gói; `reason` là dòng giải thích vì sao, `tier` là hạng nên chọn sẵn. */
  openUpgrade: (reason?: string, tier?: PaidTier) => void;
}

export const AccountContext = createContext<AccountApi | null>(null);

export function useAccount(): AccountApi {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount phải nằm trong <AccountProvider>.');
  return value;
}
