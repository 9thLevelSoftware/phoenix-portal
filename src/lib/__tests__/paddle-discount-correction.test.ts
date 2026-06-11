import { describe, expect, it } from "vitest";
import {
	buildDiscountCorrectionPatch,
	parseSubscriptionIds,
	resolvePaddleBaseUrl,
	shouldCorrectSubscription,
	validateCorrectionInputs,
} from "../../../scripts/paddle-correct-beta-discount.mjs";

const DISCOUNT_ID = "dsc_01j00000000000000000000000";
const ANNUAL_PRICE_ID = "pri_01j00000000000000000000000";
const MONTHLY_PRICE_ID = "pri_01j11111111111111111111111";
const SUBSCRIPTION_ID = "sub_01j00000000000000000000000";

describe("paddle beta discount correction script", () => {
	it("builds the Paddle patch that removes the discount and moves the next billing date without immediate billing", () => {
		expect(buildDiscountCorrectionPatch("2026-08-09T00:00:00Z")).toEqual({
			next_billed_at: "2026-08-09T00:00:00.000Z",
			discount: null,
			proration_billing_mode: "do_not_bill",
		});
	});

	it("deduplicates and validates subscription ids from pasted lists", () => {
		expect(
			parseSubscriptionIds(`
				${SUBSCRIPTION_ID}
				${SUBSCRIPTION_ID}, sub_01j22222222222222222222222
			`),
		).toEqual([SUBSCRIPTION_ID, "sub_01j22222222222222222222222"]);

		expect(() => parseSubscriptionIds("txn_not_a_subscription")).toThrow(
			/Invalid Paddle subscription ID/,
		);
	});

	it("only corrects subscriptions that still have the bad discount on an annual price", () => {
		expect(
			shouldCorrectSubscription(
				{
					id: SUBSCRIPTION_ID,
					status: "active",
					discount: { id: DISCOUNT_ID },
					items: [{ price: { id: ANNUAL_PRICE_ID } }],
				},
				{
					discountId: DISCOUNT_ID,
					annualPriceIds: new Set([ANNUAL_PRICE_ID]),
				},
			),
		).toEqual({ correct: true, priceId: ANNUAL_PRICE_ID });

		expect(
			shouldCorrectSubscription(
				{
					id: SUBSCRIPTION_ID,
					status: "active",
					discount: { id: "dsc_01j99999999999999999999999" },
					items: [{ price: { id: ANNUAL_PRICE_ID } }],
				},
				{
					discountId: DISCOUNT_ID,
					annualPriceIds: new Set([ANNUAL_PRICE_ID]),
				},
			),
		).toEqual({
			correct: false,
			reason: "discount_mismatch",
			priceId: ANNUAL_PRICE_ID,
		});

		expect(
			shouldCorrectSubscription(
				{
					id: SUBSCRIPTION_ID,
					status: "active",
					discount: { id: DISCOUNT_ID },
					items: [{ price: { id: MONTHLY_PRICE_ID } }],
				},
				{
					discountId: DISCOUNT_ID,
					annualPriceIds: new Set([ANNUAL_PRICE_ID]),
				},
			),
		).toEqual({
			correct: false,
			reason: "price_not_annual",
			priceId: MONTHLY_PRICE_ID,
		});
	});

	it("requires explicit apply mode before mutating production subscriptions", () => {
		expect(() =>
			validateCorrectionInputs({
				discountId: DISCOUNT_ID,
				annualPriceIds: [ANNUAL_PRICE_ID],
				subscriptionIds: [SUBSCRIPTION_ID],
				nextBilledAt: "2026-08-09T00:00:00Z",
				environment: "production",
				apply: false,
				now: new Date("2026-06-09T00:00:00Z"),
			}),
		).not.toThrow();

		expect(() =>
			validateCorrectionInputs({
				discountId: DISCOUNT_ID,
				annualPriceIds: [ANNUAL_PRICE_ID],
				subscriptionIds: [SUBSCRIPTION_ID],
				nextBilledAt: "2026-05-09T00:00:00Z",
				environment: "production",
				apply: true,
				now: new Date("2026-06-09T00:00:00Z"),
			}),
		).toThrow(/must be in the future/);
	});

	it("routes Paddle API requests to the selected environment", () => {
		expect(resolvePaddleBaseUrl("sandbox")).toBe(
			"https://sandbox-api.paddle.com",
		);
		expect(resolvePaddleBaseUrl("production")).toBe("https://api.paddle.com");
		expect(() => resolvePaddleBaseUrl("prod")).toThrow(
			/Invalid Paddle environment/,
		);
	});
});
