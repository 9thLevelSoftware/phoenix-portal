import { AppRoutes } from "@/app/routes";
import { MotionConfig } from "motion/react";

export default function App() {
	return (
		<MotionConfig reducedMotion="user">
			<AppRoutes />
		</MotionConfig>
	);
}
