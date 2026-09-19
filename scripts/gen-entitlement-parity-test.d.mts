export interface EntitlementFixture {
	graceHours: number;
	cases: ReadonlyArray<{
		id: string;
		status: string;
		tier: string;
		periodEndOffsetSeconds: number | null;
		cancelAtPeriodEnd: boolean;
		expectedTier: string;
	}>;
}

export function renderEntitlementParityTest(
	fixture: EntitlementFixture,
): string;
