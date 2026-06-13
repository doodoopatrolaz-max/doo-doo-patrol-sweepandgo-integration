import type {
  CreateOnboardingIntakeInput,
  OnboardingIntake,
  OnboardingIntakeStore
} from "./store.ts";

export class InMemoryOnboardingIntakeStore implements OnboardingIntakeStore {
  private readonly intakes = new Map<string, OnboardingIntake>();
  private nextId = 1;

  async createIntake(input: CreateOnboardingIntakeInput): Promise<OnboardingIntake> {
    const now = new Date().toISOString();
    const intake: OnboardingIntake = {
      id: String(this.nextId++),
      webhookEventId: input.webhookEventId,
      eventType: input.eventType,
      triggerEventFingerprint: input.triggerEventFingerprint,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      clientIdentifier: input.clientIdentifier,
      serviceType: input.serviceType,
      status: input.status,
      sourcesChecked: input.sourcesChecked,
      verifiedDetails: input.verifiedDetails,
      missingDetails: input.missingDetails,
      calculationNotes: input.calculationNotes,
      payload: input.payload,
      sweepandgoDetails: input.sweepandgoDetails,
      createdAt: now,
      updatedAt: now
    };

    this.intakes.set(intake.id, intake);
    return intake;
  }

  async listIntakes(limit: number, offset: number): Promise<OnboardingIntake[]> {
    return [...this.intakes.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(offset, offset + limit);
  }

  async getIntake(id: string): Promise<OnboardingIntake | undefined> {
    return this.intakes.get(id);
  }
}
