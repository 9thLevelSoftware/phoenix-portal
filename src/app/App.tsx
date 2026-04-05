import { MotionConfig } from "motion/react";
import { AppRoutes } from "@/app/routes";

export default function App() {
	return (
		<MotionConfig reducedMotion="user">
			<AppRoutes />
		</MotionConfig>
	);
}
