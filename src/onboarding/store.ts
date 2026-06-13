export type OnboardingIntakeStatus = "captured" | "ignored" | "needs_review" | "failed";

export type OnboardingIntake = {
  id: string;
  webhookEventId: string;
  eventType: string;
  triggerEventFingerprint: string;
  customerEmail?: string;
  customerName?: string;
  clientIdentifier?: string;
  serviceType?: string;
  status: OnboardingIntakeStatus;
  sourcesChecked: string[];
  verifiedDetails: Record<string, unknown>;
  missingDetails: string[];
  calculationNotes: string[];
  payload: unknown;
  sweepandgoDetails?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CreateOnboardingIntakeInput = {
  webhookEventId: string;
  eventType: string;
  triggerEventFingerprint: string;
  customerEmail?: string;
  customerName?: string;
  clientIdentifier?: string;
  serviceType?: string;
  status: OnboardingIntakeStatus;
  sourcesChecked: string[];
  verifiedDetails: Record<string, unknown>;
  missingDetails: string[];
  calculationNotes: string[];
  payload: unknown;
  sweepandgoDetails?: unknown;
};

export interface OnboardingIntakeStore {
  createIntake(input: CreateOnboardingIntakeInput): Promise<OnboardingIntake>;
  listIntakes(limit: number, offset: number): Promise<OnboardingIntake[]>;
  getIntake(id: string): Promise<OnboardingIntake | undefined>;
}
