import "@testing-library/jest-dom";

// Mock window.matchMedia for components using useIsMobile and responsive queries
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock IntersectionObserver for scroll-aware components and framer-motion viewport
class MockIntersectionObserver implements IntersectionObserver {
	readonly root: Element | null = null;
	readonly rootMargin: string = "";
	readonly thresholds: ReadonlyArray<number> = [];
	observe() {
		return;
	}
	unobserve() {
		return;
	}
	disconnect() {
		return;
	}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}
window.IntersectionObserver = MockIntersectionObserver;

// Mock ResizeObserver for Radix UI components
class MockResizeObserver {
	observe() {
		return;
	}
	unobserve() {
		return;
	}
	disconnect() {
		return;
	}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock canvas for EmberParticles and celebration components
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
	clearRect: vi.fn(),
	createRadialGradient: vi.fn().mockReturnValue({
		addColorStop: vi.fn(),
	}),
	createLinearGradient: vi.fn().mockReturnValue({
		addColorStop: vi.fn(),
	}),
	beginPath: vi.fn(),
	arc: vi.fn(),
	fill: vi.fn(),
	fillRect: vi.fn(),
	save: vi.fn(),
	restore: vi.fn(),
	translate: vi.fn(),
	rotate: vi.fn(),
	scale: vi.fn(),
	moveTo: vi.fn(),
	lineTo: vi.fn(),
	closePath: vi.fn(),
	stroke: vi.fn(),
	setTransform: vi.fn(),
	drawImage: vi.fn(),
	fillStyle: "",
	strokeStyle: "",
	globalAlpha: 1,
	lineWidth: 1,
	canvas: { width: 0, height: 0 },
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Mock requestAnimationFrame / cancelAnimationFrame
if (typeof window.requestAnimationFrame === "undefined") {
	window.requestAnimationFrame = vi
		.fn()
		.mockImplementation((cb: FrameRequestCallback) => {
			return setTimeout(() => cb(Date.now()), 0);
		});
	window.cancelAnimationFrame = vi.fn().mockImplementation((id: number) => {
		clearTimeout(id);
	});
}
