export type AccessResult = {
  allowed: boolean;
  passportStatus: string;
  canAccessDealRoom: boolean;
  canAccessInvestorArea: boolean;
  canInvest: boolean;
  reason: string;
};
